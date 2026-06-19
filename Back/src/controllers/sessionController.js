const Session = require('../models/Session');
const Workspace = require('../models/Workspace');
const DisconnectionLog = require('../models/DisconnectionLog');

// Obtener sesiones de un workspace
exports.getSessions = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.workspaceId);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    // Verificar acceso
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a este workspace.'
      });
    }

    const sessions = await Session.find({ workspace: req.params.workspaceId });

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener sesiones.',
      error: error.message
    });
  }
};

// Crear nueva sesión
exports.createSession = async (req, res) => {
  try {
    const { name } = req.body;
    const workspace = await Workspace.findById(req.params.workspaceId);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    // Verificar acceso
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a este workspace.'
      });
    }

    // Verificar límite de sesiones
    const sessionCount = await Session.countDocuments({ workspace: workspace._id });
    if (sessionCount >= workspace.maxSessions) {
      return res.status(400).json({
        success: false,
        message: `Has alcanzado el límite de ${workspace.maxSessions} sesiones para este workspace.`
      });
    }

    const session = await Session.create({
      name,
      workspace: workspace._id,
      status: 'disconnected'
    });

    res.status(201).json({
      success: true,
      session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al crear sesión.',
      error: error.message
    });
  }
};

// Obtener una sesión
exports.getSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).populate('workspace');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sesión no encontrada.'
      });
    }

    const workspace = session.workspace;
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a esta sesión.'
      });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener sesión.',
      error: error.message
    });
  }
};

// Actualizar sesión
exports.updateSession = async (req, res) => {
  try {
    const { name } = req.body;
    let session = await Session.findById(req.params.id).populate('workspace');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sesión no encontrada.'
      });
    }

    const workspace = session.workspace;
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a esta sesión.'
      });
    }

    session = await Session.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al actualizar sesión.',
      error: error.message
    });
  }
};

// Eliminar sesión
exports.deleteSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).populate('workspace');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sesión no encontrada.'
      });
    }

    const workspace = session.workspace;
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a esta sesión.'
      });
    }

    // Purga completa: mata Chrome, limpia maps en memoria y borra LocalAuth
    // (al eliminar la sesión no vamos a reutilizar los datos de emparejamiento).
    const whatsappService = req.app.get('whatsappService');
    await whatsappService.purgeSessionArtifacts(session._id.toString());

    await session.deleteOne();

    res.json({
      success: true,
      message: 'Sesión eliminada correctamente.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar sesión.',
      error: error.message
    });
  }
};

// Obtener chats de una sesión
exports.getChats = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).populate('workspace');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sesión no encontrada.'
      });
    }

    const workspace = session.workspace;
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a esta sesión.'
      });
    }

    const whatsappService = req.app.get('whatsappService');
    const chats = await whatsappService.getChats(session._id.toString());

    res.json({
      success: true,
      chats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener chats.',
      error: error.message
    });
  }
};

// Obtener historial de desconexiones de un workspace
exports.getDisconnectionLogs = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.workspaceId);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    // Verificar acceso
    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a este workspace.'
      });
    }

    // Obtener parámetros de paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Obtener logs ordenados por fecha descendente
    const logs = await DisconnectionLog.find({ workspace: req.params.workspaceId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('session', 'name phoneNumber');

    const total = await DisconnectionLog.countDocuments({ workspace: req.params.workspaceId });

    res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de desconexiones.',
      error: error.message
    });
  }
};

// Marcar una desconexión como reconectada
exports.markAsReconnected = async (req, res) => {
  try {
    const log = await DisconnectionLog.findById(req.params.logId).populate({
      path: 'session',
      populate: { path: 'workspace' }
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Log de desconexión no encontrado.'
      });
    }

    const workspace = log.session?.workspace;
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    const hasAccess = workspace.owner.toString() === req.user.id ||
      workspace.members.includes(req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No tienes acceso a este registro.'
      });
    }

    log.wasReconnected = true;
    log.reconnectedAt = new Date();
    await log.save();

    res.json({
      success: true,
      log
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al actualizar registro.',
      error: error.message
    });
  }
};

// Eliminar historial de desconexiones antiguo
exports.clearOldDisconnectionLogs = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.workspaceId);

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: 'Workspace no encontrado.'
      });
    }

    // Solo el owner puede limpiar historial
    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Solo el propietario puede limpiar el historial.'
      });
    }

    // Eliminar logs de más de 30 días (o los que se especifiquen)
    const daysOld = parseInt(req.query.days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await DisconnectionLog.deleteMany({
      workspace: req.params.workspaceId,
      createdAt: { $lt: cutoffDate }
    });

    res.json({
      success: true,
      message: `Se eliminaron ${result.deletedCount} registros de más de ${daysOld} días.`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al limpiar historial.',
      error: error.message
    });
  }
};
