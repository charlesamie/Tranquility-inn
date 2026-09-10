const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: 'Admin' },
  role: { type: String, enum: ['owner', 'manager'], default: 'manager' },

  // Set by POST /api/auth/forgot-password, cleared on successful reset or
  // once expired. Only the SHA-256 hash of the token is stored — never the
  // raw token itself — so a database read alone can't be used to reset a
  // password; select: false keeps it out of default query results too.
  resetPasswordToken: { type: String, default: null, select: false },
  resetPasswordExpires: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);
