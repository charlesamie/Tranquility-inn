const express = require('express');
const Razorpay = require('razorpay');
const Booking = require('./Booking');
const Room = require('./Room');
const { requireAdmin } = require('./requireAdmin');
const { sendCancellationNotice } = require('./notify');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// GET /api/bookings — admin, list with optional filters
// ?status=confirmed&paymentStatus=paid&from=2026-01-01&to=2026-02-01
router.get('/', requireAdmin, async (req, res) => {
  const { status, paymentStatus, from, to } = req.query;
  const query = {};
  if (status) query.status = status;
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (from || to) {
    query.checkIn = {};
    if (from) query.checkIn.$gte = new Date(from);
    if (to) query.checkIn.$lte = new Date(to);
  }
  const bookings = await Booking.find(query).sort({ createdAt: -1 }).limit(500);
  res.json(bookings);
});

// PATCH /api/bookings/:id/cancel — admin
// Cancellation policy (matches what's published on the site): full refund
// if cancelled 24+ hours before check-in; no refund otherwise (late
// cancellations / no-shows are non-refundable). Only attempts a refund if
// the booking was actually paid — nothing to refund on a pending/failed one.
router.patch('/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking is already cancelled.' });
    }

    const hoursUntilCheckIn = (booking.checkIn.getTime() - Date.now()) / (1000 * 60 * 60);
    const eligibleForRefund = hoursUntilCheckIn >= 24;

    let refund = null;
    if (eligibleForRefund && booking.paymentStatus === 'paid' && booking.razorpayPaymentId) {
      refund = await razorpay.payments.refund(booking.razorpayPaymentId, {
        amount: booking.totalAmount * 100, // paise — full refund per policy
        speed: 'normal',
        notes: { reason: 'Admin cancellation — 24hr+ before check-in, full refund per policy.' },
      });
    }

    booking.status = 'cancelled';
    if (refund) {
      booking.refundId = refund.id;
      booking.refundStatus = refund.status; // Razorpay: 'pending' | 'processed'
      booking.refundAmount = refund.amount / 100;
    } else if (booking.paymentStatus === 'paid') {
      // Was paid, but too close to check-in to qualify — explicitly recorded
      // as not eligible rather than left blank, so this isn't mistaken for
      // "refund never attempted" when someone reviews it later.
      booking.refundStatus = 'not_eligible';
      booking.refundAmount = 0;
    }
    await booking.save();

    // Don't make the admin wait on email/SMS providers — respond first,
    // notify after. Same pattern as the confirmation flow in payment.js.
    sendCancellationNotice(booking).then((result) => {
      console.log(`[bookings] ${booking.bookingRef} cancellation notice — email: ${result.email.sent}, sms: ${result.sms.sent}`);
    });

    res.json(booking);
  } catch (err) {
    console.error('[bookings] cancel error:', err.message);
    res.status(400).json({ error: 'Could not cancel booking.', detail: err.message });
  }
});

// GET /api/bookings/analytics — admin dashboard summary
router.get('/analytics', requireAdmin, async (req, res) => {
  const [revenueAgg, occupancyByRoom, recentTrend] = await Promise.all([
    Booking.aggregate([
      { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, totalBookings: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { status: 'confirmed', paymentStatus: 'paid' } },
      { $group: { _id: '$roomName', bookings: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      { $sort: { revenue: -1 } },
    ]),
    Booking.aggregate([
      { $match: { paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          bookings: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
      } },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
  ]);

  const totalRooms = await Room.aggregate([{ $match: { active: true } }, { $group: { _id: null, total: { $sum: '$totalUnits' } } }]);

  res.json({
    totalRevenue: revenueAgg[0]?.totalRevenue || 0,
    totalBookings: revenueAgg[0]?.totalBookings || 0,
    totalRoomUnits: totalRooms[0]?.total || 0,
    occupancyByRoom,
    dailyTrend: recentTrend.reverse(),
  });
});

module.exports = router;
