const express = require('express');
const Room = require('./Room');
const { requireAdmin } = require('./requireAdmin');

const router = express.Router();

// GET /api/rooms — public, active rooms only
router.get('/', async (req, res) => {
  const rooms = await Room.find({ active: true }).sort({ basePrice: 1 });
  res.json(rooms);
});

// GET /api/rooms/all — admin, includes inactive
router.get('/all', requireAdmin, async (req, res) => {
  const rooms = await Room.find().sort({ basePrice: 1 });
  res.json(rooms);
});

// PATCH /api/rooms/:id — admin, edit price/availability
router.patch('/:id', requireAdmin, async (req, res) => {
  const { basePrice, totalUnits, active } = req.body;
  const update = {};
  if (basePrice !== undefined) update.basePrice = basePrice;
  if (totalUnits !== undefined) update.totalUnits = totalUnits;
  if (active !== undefined) update.active = active;

  const room = await Room.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  res.json(room);
});

module.exports = router;
