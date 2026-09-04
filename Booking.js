const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // TI-<year>-<6 hex chars>, generated in routes/payment.js. Unique + a
  // retry-on-collision in payment.js keeps this safe even though the
  // space is small.
  bookingRef: { type: String, required: true, unique: true },

  room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  // Denormalized so admin lists/analytics don't need a populate() on every read.
  roomName: { type: String, required: true },

  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  nights: { type: Number, required: true, min: 1 },
  guests: { type: String, default: '2 Adults' },

  guestFirstName: { type: String, required: true, trim: true },
  guestLastName: { type: String, required: true, trim: true },
  guestEmail: { type: String, required: true, trim: true, lowercase: true },
  guestPhone: { type: String, required: true, trim: true },

  idProofType: { type: String, default: 'Aadhaar Card' },
  // select: false — this is sensitive government-ID data (PII under India's
  // DPDP Act). It's never displayed anywhere in the admin UI, so keeping it
  // out of default query results limits accidental exposure. Fetch it
  // explicitly with .select('+idProofNumber') only where a legitimate need
  // exists (e.g. front-desk check-in lookup), and see README for the note
  // on encrypting this field at rest.
  idProofNumber: { type: String, default: 'N/A', select: false },

  roomRate: { type: Number, required: true },
  baseAmount: { type: Number, required: true },
  taxAmount: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  promoCode: { type: String, default: null },
  totalAmount: { type: Number, required: true },

  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  // 'confirmed' also covers an unpaid hold placed while checkout is in
  // progress — see the cleanup job in server.js, which flips stale
  // pending-payment holds to 'expired' so they stop blocking availability.
  status: { type: String, enum: ['confirmed', 'cancelled', 'expired'], default: 'confirmed' },

  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: { type: String },
}, { timestamps: true });

// Speeds up the overlap check in routes/payment.js and routes/availability.js,
// which is run on every quote/availability lookup.
bookingSchema.index({ room: 1, status: 1, checkIn: 1, checkOut: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
