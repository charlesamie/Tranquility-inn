const express = require('express');
const Review = require('./Review');
const { requireAdmin } = require('./requireAdmin');

const router = express.Router();

// GET /api/reviews — public, approved only
router.get('/', async (req, res) => {
  const reviews = await Review.find({ status: 'approved' }).sort({ createdAt: -1 }).limit(30);
  const agg = await Review.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const summary = agg[0] ? { average: Math.round(agg[0].avg * 10) / 10, count: agg[0].count } : { average: 0, count: 0 };
  res.json({ summary, reviews });
});

// POST /api/reviews — public, guests submit a review (goes to 'pending' for moderation)
router.post('/', async (req, res) => {
  try {
    const { reviewerName, rating, text, source } = req.body;
    if (!reviewerName || !rating || !text) {
      return res.status(400).json({ error: 'Name, rating and review text are required.' });
    }
    const review = await Review.create({ reviewerName, rating, text, source: source || 'Website' });
    res.status(201).json({ message: 'Thanks — your review is pending moderation.', reviewId: review._id });
  } catch (err) {
    res.status(400).json({ error: 'Could not submit review.', detail: err.message });
  }
});

// --- Admin moderation ---

// GET /api/reviews/all — admin, every status
router.get('/all', requireAdmin, async (req, res) => {
  const reviews = await Review.find().sort({ createdAt: -1 });
  res.json(reviews);
});

// PATCH /api/reviews/:id — admin, approve/reject
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, approved or rejected.' });
  }
  const review = await Review.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  res.json(review);
});

module.exports = router;
