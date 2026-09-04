const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: 'Admin' },
  role: { type: String, enum: ['owner', 'manager'], default: 'manager' },
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);
