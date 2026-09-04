const mongoose = require('mongoose');

// Field names match exactly what routes/rooms.js, routes/availability.js,
// routes/payment.js and seed.js already read/write — do not rename fields
// without updating those files too.
const roomSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  sizeSqft: { type: Number, required: true, min: 0 },
  bedType: { type: String, required: true, trim: true },
  basePrice: { type: Number, required: true, min: 0 },
  totalUnits: { type: Number, required: true, min: 1 },
  amenities: { type: [String], default: [] },
  images: { type: [String], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
