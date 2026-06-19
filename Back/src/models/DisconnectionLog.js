const mongoose = require('mongoose');

const disconnectionLogSchema = new mongoose.Schema({
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
  sessionName: {
    type: String,
    default: 'Sesión'
  },
  phoneNumber: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    required: true,
    enum: ['LOGOUT', 'CONFLICT', 'UNPAIRED', 'UNPAIRED_IDLE', 'REPLACED', 'MANUAL_WEB', 'UNKNOWN']
  },
  reasonDescription: {
    type: String,
    default: ''
  },
  // Si fue reconectado después
  wasReconnected: {
    type: Boolean,
    default: false
  },
  reconnectedAt: {
    type: Date,
    default: null
  },
  // Metadata adicional
  userAgent: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Índices para búsquedas eficientes
disconnectionLogSchema.index({ workspace: 1, createdAt: -1 });
disconnectionLogSchema.index({ session: 1, createdAt: -1 });

module.exports = mongoose.model('DisconnectionLog', disconnectionLogSchema);
