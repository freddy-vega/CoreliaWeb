const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre de la sesión es requerido'],
    trim: true
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  phoneNumber: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['disconnected', 'connecting', 'connected', 'qr_pending', 'reconnecting'],
    default: 'disconnected'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Session', sessionSchema);
