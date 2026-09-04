const express = require('express');
const Promo = require('./Promo');
const { requireAdmin } = require('./requireAdmin');

const router = express.Router();

// POST /api/promos/apply  { code, nights }  — public, validates a code
router.post('/apply', async (req, res) => {
  try {
    const { code, nights } = req.body;
    if (!code) return res.status(400).json({ error: 'Promo code is required.' });

    const promo = await Promo.findOne({ code: code.toUpperCase().trim(), active: true });
    if (!promo) return res.status(404).json({ valid: false, error: 'Invalid promo code.' });

    const now = new Date();
    if (now < promo.validFrom || now > promo.validTo) {
      return res.status(400).json({ valid: false, error: 'This promo code has expired.' });
    }
    if (nights && nights < promo.minNights) {
      return res.status(400).json({ valid: false, error: `This code requires a minimum ${promo.minNights}-night stay.` });
    }

    res.json({ valid: true, code: promo.code, discountPct: promo.discountPct, label: promo.label });
  } catch (err) {
    res.status(500).json({ error: 'Could not validate promo code.', detail: err.message });
  }
});

// --- Admin promo management ---

// GET /api/promos — admin, list all
router.get('/', requireAdmin, async (req, res) => {
  const promos = await Promo.find().sort({ createdAt: -1 });
  res.json(promos);
});

// POST /api/promos — admin, create
router.post('/', requireAdmin, async (req, res) => {
  try {
    const promo = await Promo.create(req.body);
    res.status(201).json(promo);
  } catch (err) {
    res.status(400).json({ error: 'Could not create promo.', detail: err.message });
  }
});

// PATCH /api/promos/:id — admin, edit or deactivate
router.patch('/:id', requireAdmin, async (req, res) => {
  const promo = await Promo.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!promo) return res.status(404).json({ error: 'Promo not found.' });
  res.json(promo);
});

module.exports = router;
