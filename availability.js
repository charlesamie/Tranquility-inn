const express = require('express');
const Room = require('./Room');
const Booking = require('./Booking');
const { getRoomRate } = require('./pricing');

const router = express.Router();

// GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=2+Adults
// Returns each active room with how many units are free for that date range.
// `guests` is optional — only affects the displayed price for rooms with
// occupancy-tiered pricing (see pricing.js); defaults to double-occupancy rate.
router.get('/', async (req, res) => {
  try {
    const { checkIn, checkOut, guests } = req.query;
    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'checkIn and checkOut are required (YYYY-MM-DD).' });
    }
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.status(400).json({ error: 'checkOut must be a valid date after checkIn.' });
    }

    const nights = Math.round((end - start) / (1000 * 60 * 60 * 24));
    const rooms = await Room.find({ active: true });

    const results = await Promise.all(rooms.map(async (room) => {
      // Overlap rule: an existing booking blocks a unit if it starts before our
      // checkout and ends after our checkin.
      const overlapping = await Booking.countDocuments({
        room: room._id,
        status: 'confirmed',
        checkIn: { $lt: end },
        checkOut: { $gt: start },
      });
      const unitsFree = Math.max(0, room.totalUnits - overlapping);

      return {
        roomId: room._id,
        slug: room.slug,
        name: room.name,
        sizeSqft: room.sizeSqft,
        bedType: room.bedType,
        basePrice: getRoomRate(room, guests),
        occupancyPricing: room.occupancyPricing,
        amenities: room.amenities,
        images: room.images,
        unitsFree,
        available: unitsFree > 0,
        nights,
      };
    }));

    res.json({ nights, checkIn, checkOut, rooms: results });
  } catch (err) {
    res.status(500).json({ error: 'Could not check availability.', detail: err.message });
  }
});

module.exports = router;
