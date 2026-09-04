require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');

const connectDB = require('./db');
const Booking = require('./models/Booking');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const availabilityRoutes = require('./routes/availability');
const promoRoutes = require('./routes/promos');
const reviewRoutes = require('./routes/reviews');
const bookingRoutes = require('./routes/bookings');
const paymentRoutes = require('./routes/payment');
const webhookRoutes = require('./routes/webhook');

const app = express();

// --- Security & platform middleware ---
app.set('trust proxy', 1); // needed on Render/Vercel for correct rate-limit IPs
app.use(helmet({
  // Allow the public site's Razorpay checkout script + Google Fonts, which
  // helmet's default CSP would otherwise block.
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'https://checkout.razorpay.com'],
      'frame-src': ["'self'", 'https://api.razorpay.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },
}));
app.use(cors({
  origin: process.env.CLIENT_ORIGIN?.split(',') || '*',
  credentials: true,
}));

// Razorpay's webhook needs the raw, unparsed body to verify its signature,
// so it must be mounted before the global JSON parser below.
app.use('/api/payment/webhook', webhookRoutes);

app.use(express.json({ limit: '100kb' }));
// Strips any request key starting with '$' or containing '.' — blocks
// NoSQL-injection payloads (e.g. { "email": { "$gt": "" } }) from reaching
// Mongoose queries built directly from req.body/req.query.
app.use(mongoSanitize());
app.use(morgan('tiny'));

// General API rate limit (separate, stricter limit is applied on /api/auth/login)
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// --- Routes ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payment', paymentRoutes);

// Serve the admin dashboard (static files) at /admin
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Serve the public guest-facing site at /
app.use(express.static(path.join(__dirname, 'public')));

// 404 for unmatched API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 5000;

// Releases room holds that were never paid for. A booking is created with
// status 'confirmed' + paymentStatus 'pending' the moment checkout starts
// (see routes/payment.js) so the room can't be double-sold mid-payment —
// this job cleans up ones that were abandoned rather than completed, so
// they stop blocking availability for other guests.
const STALE_HOLD_MINUTES = 20;
function releaseStaleHolds() {
  const cutoff = new Date(Date.now() - STALE_HOLD_MINUTES * 60 * 1000);
  Booking.updateMany(
    { status: 'confirmed', paymentStatus: 'pending', createdAt: { $lt: cutoff } },
    { status: 'expired' }
  )
    .then((result) => {
      if (result.modifiedCount) {
        console.log(`[cleanup] released ${result.modifiedCount} stale pending booking(s).`);
      }
    })
    .catch((err) => console.error('[cleanup] error:', err.message));
}

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Tranquility Inn API running on port ${PORT}`));
    setInterval(releaseStaleHolds, 5 * 60 * 1000);
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
