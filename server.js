require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');

const connectDB = require('./db');
const Booking = require('./Booking');

const authRoutes = require('./auth');
const roomRoutes = require('./rooms');
const availabilityRoutes = require('./availability');
const promoRoutes = require('./promos');
const reviewRoutes = require('./reviews');
const googleReviewRoutes = require('./google-reviews');
const bookingRoutes = require('./bookings');
const paymentRoutes = require('./payment');
const webhookRoutes = require('./webhook');

const app = express();

// --- Security & platform middleware ---
app.set('trust proxy', 1); // needed on Render/Vercel for correct rate-limit IPs
app.use(helmet({
  // Allow the public site's Razorpay checkout script + Google Fonts, which
  // helmet's default CSP would otherwise block.
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
      'frame-src': ["'self'", 'https://api.razorpay.com', 'https://www.google.com'],
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
app.use('/api/google-reviews', googleReviewRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payment', paymentRoutes);

// Everything lives flat next to server.js in this deploy (no /admin or /public
// folders), so each public file is served through an explicit route instead of
// express.static(__dirname) — that would also hand out server.js, the models,
// and every route file as downloadable text, which we don't want.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'sitemap.xml')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/logo-main.webp', (req, res) => res.sendFile(path.join(__dirname, 'logo-main.webp')));
app.get('/logo-restobar.jpg', (req, res) => res.sendFile(path.join(__dirname, 'logo-restobar.jpg')));
app.get('/standard-room.jpg', (req, res) => res.sendFile(path.join(__dirname, 'standard-room.jpg')));
app.get('/family-room.jpg', (req, res) => res.sendFile(path.join(__dirname, 'family-room.jpg')));
app.get('/premium-room.jpg', (req, res) => res.sendFile(path.join(__dirname, 'premium-room.jpg')));
app.get('/penthouse-1.jpg', (req, res) => res.sendFile(path.join(__dirname, 'penthouse-1.jpg')));
app.get('/penthouse-2.jpg', (req, res) => res.sendFile(path.join(__dirname, 'penthouse-2.jpg')));
app.get('/penthouse-3.jpg', (req, res) => res.sendFile(path.join(__dirname, 'penthouse-3.jpg')));
app.get('/gallery-lounge.jpg', (req, res) => res.sendFile(path.join(__dirname, 'gallery-lounge.jpg')));
app.get('/gallery-bathroom.jpg', (req, res) => res.sendFile(path.join(__dirname, 'gallery-bathroom.jpg')));
app.get('/lobby-1.jpg', (req, res) => res.sendFile(path.join(__dirname, 'lobby-1.jpg')));
app.get('/lobby-2.jpg', (req, res) => res.sendFile(path.join(__dirname, 'lobby-2.jpg')));

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
