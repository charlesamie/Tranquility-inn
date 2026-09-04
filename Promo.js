const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  label: { type: String, required: true, trim: true },
  // Bounded 1-100: payment.js multiplies baseAmount by this as a percentage,
  // so an out-of-range value would silently produce a nonsense discount.
  discountPct: { type: Number, required: true, min: 1, max: 100 },
  minNights: { type: Number, default: 1, min: 1 },
  validFrom: { type: Date, default: Date.now },
  validTo: { type: Date, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Promo', promoSchema);
