const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewerName: { type: String, required: true, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  source: { type: String, default: 'Website', trim: true },
  // New reviews start pending so a guest can't publish straight to the
  // public site — routes/reviews.js only ever creates them this way.
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);
