const Workspace = require('../models/Workspace');
const Session = require('../models/Session');

// Obtener todos los workspaces del usuario
exports.getWorkspaces = async (req, res) => {
  try {
    const workspaces = await Workspace.find({
      $or: [
        { owner: req.user.id },
        { members: req.user.id }
      ]
    }).populate('owner', 'name email').populate('members', 'name email');

    // Obtener conteo de sesiones para cada workspace
    const workspacesWithSessions = await Promise.all(
      workspaces.map(async (workspace) => {
        const sessionCount = await Session.countDocuments({ workspace: workspace._id });
        const connectedCount = await Session.countDocuments({
          workspace: workspace._id,
          status: 'connected'
        });
        return {
          ...workspace.toObject(),
          sessionCount,
          connectedCount
        };
      })
    );

    res.json({
      success: true,
      workspaces: workspacesWithSessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener workspaces.',
      error: error.message
    });
  }
};

// Obtener un workspace por ID
exports.getWorkspace = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('members', 'name email');

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    // Verificar acceso
    const hasAccess = workspace.owner._id.toString() === req.user.id ||
      workspace.members.some(m => m._id.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a este workspace.'
      });
    }

    // Obtener sesiones del workspace
    const sessions = await Session.find({ workspace: workspace._id });

    res.json({
      success: true,
      workspace: {
        ...workspace.toObject(),
        sessions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener workspace.',
      error: error.message
    });
  }
};

// Crear workspace
exports.createWorkspace = async (req, res) => {
  try {
    const { name, description } = req.body;

    const workspace = await Workspace.create({
      name,
      description,
      owner: req.user.id
    });

    await workspace.populate('owner', 'name email');

    res.status(201).json({
      success: true,
      workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al crear workspace.',
      error: error.message
    });
  }
};

// Actualizar workspace
exports.updateWorkspace = async (req, res) => {
  try {
    const { name, description } = req.body;

    let workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Solo el propietario puede editar el workspace.'
      });
    }

    workspace = await Workspace.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true, runValidators: true }
    ).populate('owner', 'name email').populate('members', 'name email');

    res.json({
      success: true,
      workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al actualizar workspace.',
      error: error.message
    });
  }
};

// Eliminar workspace
exports.deleteWorkspace = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Solo el propietario puede eliminar el workspace.'
      });
    }

    // Purgar TODO el estado de las sesiones ANTES de borrarlas de la DB:
    // mata Chrome (main + renderers), limpia maps en memoria y borra LocalAuth.
    // Sin esto, los procesos Chrome quedan huérfanos corriendo en el VPS.
    const whatsappService = req.app.get('whatsappService');
    const purgedCount = await whatsappService.purgeSessionsOfWorkspace(workspace._id);
    console.log(`[Workspace Delete] Purgadas ${purgedCount} sesiones del workspace ${workspace._id}`);

    // Ahora sí: borrar sesiones de la DB y el workspace
    await Session.deleteMany({ workspace: workspace._id });
    await workspace.deleteOne();

    res.json({
      success: true,
      message: 'Workspace eliminado correctamente.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar workspace.',
      error: error.message
    });
  }
};

// Agregar miembro al workspace
exports.addMember = async (req, res) => {
  try {
    const { userId } = req.body;
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Solo el propietario puede agregar miembros.'
      });
    }

    if (workspace.members.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'El usuario ya es miembro del workspace.'
      });
    }

    workspace.members.push(userId);
    await workspace.save();

    await workspace.populate('owner', 'name email');
    await workspace.populate('members', 'name email');

    res.json({
      success: true,
      workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al agregar miembro.',
      error: error.message
    });
  }
};

// Remover miembro del workspace
exports.removeMember = async (req, res) => {
  try {
    const { userId } = req.body;
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Solo el propietario puede remover miembros.'
      });
    }

    workspace.members = workspace.members.filter(m => m.toString() !== userId);
    await workspace.save();

    await workspace.populate('owner', 'name email');
    await workspace.populate('members', 'name email');

    res.json({
      success: true,
      workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al remover miembro.',
      error: error.message
    });
  }
};
