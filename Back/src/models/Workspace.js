const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del workspace es requerido'],
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  maxSessions: {
    type: Number,
    default: 4
  }
}, {
  timestamps: true
});

// Virtual para obtener las sesiones del workspace
workspaceSchema.virtual('sessions', {
  ref: 'Session',
  localField: '_id',
  foreignField: 'workspace'
});

workspaceSchema.set('toJSON', { virtuals: true });
workspaceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Workspace', workspaceSchema);
