const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  pushname: {
    type: String,
    default: ''
  },
  profilePicPath: {
    type: String,
    default: null
  },
  isGroup: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

contactSchema.index({ session: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
