const Message = require('../models/Message');
const Session = require('../models/Session');
const Workspace = require('../models/Workspace');

// Obtener mensajes de una sesión
exports.getMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { chatId, page = 1, limit = 50 } = req.query;

    const session = await Session.findById(sessionId).populate('workspace');

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

    const query = { session: sessionId };
    if (chatId) {
      query.chatId = chatId;
    }

    const total = await Message.countDocuments(query);
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      messages: messages.reverse(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener mensajes.',
      error: error.message
    });
  }
};

// Obtener solo mensajes eliminados
exports.getDeletedMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const session = await Session.findById(sessionId).populate('workspace');

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

    const query = { session: sessionId, isDeleted: true };

    const total = await Message.countDocuments(query);
    const messages = await Message.find(query)
      .sort({ deletedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener mensajes eliminados.',
      error: error.message
    });
  }
};

// Obtener chats únicos con último mensaje
exports.getChatList = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId).populate('workspace');

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

    // Obtener chats únicos con último mensaje y conteo de eliminados
    const chats = await Message.aggregate([
      { $match: { session: session._id } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$chatId',
          chatName: { $first: '$chatName' },
          isGroup: { $first: '$isGroup' },
          lastMessage: { $first: '$body' },
          lastMessageType: { $first: '$type' },
          lastTimestamp: { $first: '$timestamp' },
          totalMessages: { $sum: 1 },
          deletedMessages: {
            $sum: { $cond: ['$isDeleted', 1, 0] }
          }
        }
      },
      { $sort: { lastTimestamp: -1 } }
    ]);

    res.json({
      success: true,
      chats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener lista de chats.',
      error: error.message
    });
  }
};

// Obtener estadísticas de mensajes
exports.getStats = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId).populate('workspace');

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

    const totalMessages = await Message.countDocuments({ session: sessionId });
    const deletedMessages = await Message.countDocuments({ session: sessionId, isDeleted: true });
    const mediaMessages = await Message.countDocuments({
      session: sessionId,
      type: { $in: ['image', 'video', 'audio', 'document'] }
    });

    // Mensajes por tipo
    const messagesByType = await Message.aggregate([
      { $match: { session: session._id } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalMessages,
        deletedMessages,
        mediaMessages,
        messagesByType: messagesByType.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas.',
      error: error.message
    });
  }
};
