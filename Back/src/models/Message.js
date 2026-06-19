const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  messageId: {
    type: String,
    required: true
  },
  from: {
    type: String,
    required: true
  },
  fromName: {
    type: String,
    default: ''
  },
  to: {
    type: String,
    required: true
  },
  body: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  },
  mediaPath: {
    type: String,
    default: null
  },
  mediaUrl: {
    type: String,
    default: null
  },
  mediaMimetype: {
    type: String,
    default: null
  },
  mediaFilename: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    required: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  isFromMe: {
    type: Boolean,
    default: false
  },
  chatId: {
    type: String,
    required: true
  },
  chatName: {
    type: String,
    default: ''
  },
  isGroup: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Índices para búsquedas eficientes
messageSchema.index({ session: 1, chatId: 1 });
messageSchema.index({ session: 1, isDeleted: 1 });
messageSchema.index({ messageId: 1 });
// Índice compuesto para la deduplicación que corre en cada mensaje recibido.
// Evita scan lineal del collection en Message.findOne({session, messageId}).
messageSchema.index({ session: 1, messageId: 1 });

module.exports = mongoose.model('Message', messageSchema);
