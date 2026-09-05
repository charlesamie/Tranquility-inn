const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const validator = require('validator');
const Room = require('./Room');
const Booking = require('./Booking');
const Promo = require('./Promo');
const { getRoomRate } = require('./pricing');
const { sendBookingConfirmations, whatsappLink, instagramLink } = require('./notify');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function makeBookingRef() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TI-${year}-${rand}`;
}

// Server-side price computation — never trust a total sent from the browser.
async function computeQuote({ roomId, checkIn, checkOut, guests, promoCode }) {
  const room = await Room.findById(roomId);
  if (!room || !room.active) throw new Error('Room not found or unavailable.');

  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (isNaN(start) || isNaN(end) || end <= start) throw new Error('Invalid check-in/check-out dates.');
  const nights = Math.round((end - start) / (1000 * 60 * 60 * 24));

  const overlapping = await Booking.countDocuments({
    room: room._id, status: 'confirmed',
    checkIn: { $lt: end }, checkOut: { $gt: start },
  });
  if (overlapping >= room.totalUnits) throw new Error('This room type is fully booked for those dates.');

  const roomRate = getRoomRate(room, guests);
  const baseAmount = roomRate * nights;
  const taxAmount = Math.round(baseAmount * 0.18);

  let discountAmount = 0;
  let appliedCode = null;
  if (promoCode) {
    const promo = await Promo.findOne({ code: promoCode.toUpperCase().trim(), active: true });
    const now = new Date();
    if (promo && now >= promo.validFrom && now <= promo.validTo && nights >= promo.minNights) {
      discountAmount = Math.round(baseAmount * promo.discountPct / 100);
      appliedCode = promo.code;
    }
  }

  const totalAmount = baseAmount + taxAmount - discountAmount;
  return { room, roomRate, nights, baseAmount, taxAmount, discountAmount, totalAmount, appliedCode };
}

// POST /api/payment/quote — public, price preview before payment (no DB writes)
router.post('/quote', async (req, res) => {
  try {
    const quote = await computeQuote(req.body);
    res.json({
      roomName: quote.room.name,
      nights: quote.nights,
      roomRate: quote.roomRate,
      baseAmount: quote.baseAmount,
      taxAmount: quote.taxAmount,
      discountAmount: quote.discountAmount,
      totalAmount: quote.totalAmount,
      appliedCode: quote.appliedCode,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/payment/create-order
// Creates a 'pending' booking + a matching Razorpay order. Frontend opens
// Razorpay Checkout with the returned order_id.
router.post('/create-order', async (req, res) => {
  try {
    const {
      roomId, checkIn, checkOut, guests, promoCode,
      guestFirstName, guestLastName, guestEmail, guestPhone,
      idProofType, idProofNumber,
    } = req.body;

    if (!guestFirstName || !guestLastName || !guestEmail || !guestPhone) {
      return res.status(400).json({ error: 'Guest name, email and phone are required.' });
    }
    if (!validator.isEmail(guestEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const quote = await computeQuote({ roomId, checkIn, checkOut, guests, promoCode });

    const order = await razorpay.orders.create({
      amount: quote.totalAmount * 100, // paise
      currency: 'INR',
      receipt: makeBookingRef(),
      notes: { hotel: 'Tranquility Inn Chennai', room: quote.room.name },
    });

    const booking = await Booking.create({
      bookingRef: order.receipt,
      room: quote.room._id,
      roomName: quote.room.name,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      nights: quote.nights,
      guests: guests || '2 Adults',
      guestFirstName, guestLastName, guestEmail, guestPhone,
      idProofType: idProofType || 'Aadhaar Card',
      idProofNumber: idProofNumber || 'N/A',
      roomRate: quote.roomRate,
      baseAmount: quote.baseAmount,
      taxAmount: quote.taxAmount,
      discountAmount: quote.discountAmount,
      promoCode: quote.appliedCode,
      totalAmount: quote.totalAmount,
      paymentStatus: 'pending',
      razorpayOrderId: order.id,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      bookingRef: booking.bookingRef,
      totalAmount: quote.totalAmount,
    });
  } catch (err) {
    res.status(400).json({ error: 'Could not create order.', detail: err.message });
  }
});

// POST /api/payment/verify
// Verifies the Razorpay signature server-side (never trust the client alone)
// then marks the matching booking as paid.
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      await Booking.findOneAndUpdate({ razorpayOrderId: razorpay_order_id }, { paymentStatus: 'failed' });
      return res.status(400).json({ verified: false, error: 'Payment signature mismatch.' });
    }

    // The paymentStatus !== 'paid' guard makes this idempotent against the
    // /api/payment/webhook route (see routes/webhook.js): whichever one
    // reaches Mongo first "wins" and the second becomes a no-op, so the
    // guest never gets two confirmation emails/SMS for one booking.
    const booking = await Booking.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id, paymentStatus: { $ne: 'paid' } },
      { paymentStatus: 'paid', razorpayPaymentId: razorpay_payment_id },
      { new: true }
    );

    if (!booking) {
      // Either the order truly doesn't exist, or the webhook already paid
      // and confirmed it — treat the latter as a success from the guest's
      // point of view instead of showing them an error.
      const existing = await Booking.findOne({ razorpayOrderId: razorpay_order_id });
      if (existing && existing.paymentStatus === 'paid') {
        return res.json({
          verified: true,
          bookingRef: existing.bookingRef,
          totalAmount: existing.totalAmount,
          whatsapp: whatsappLink(existing),
          instagram: instagramLink(),
        });
      }
      return res.status(404).json({ error: 'Booking not found for this order.' });
    }

    // Don't make the guest wait on email/SMS providers — respond first, notify after.
    sendBookingConfirmations(booking).then((result) => {
      console.log(`[notify] ${booking.bookingRef} — email: ${result.email.sent}, sms: ${result.sms.sent}`);
    });

    res.json({
      verified: true,
      bookingRef: booking.bookingRef,
      totalAmount: booking.totalAmount,
      whatsapp: whatsappLink(booking),
      instagram: instagramLink(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed.', detail: err.message });
  }
});

module.exports = router;
