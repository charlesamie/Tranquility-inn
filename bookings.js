const express = require('express');
const Booking = require('./Booking');
const Room = require('./Room');
const { requireAdmin } = require('./requireAdmin');

const router = express.Router();

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
router.patch('/:id/cancel', requireAdmin, async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json(booking);
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
