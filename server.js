require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');

const bcrypt = require('bcryptjs');
const connectDB = require('./db');
const Booking = require('./Booking');
const Room = require('./Room');
const Promo = require('./Promo');
const Admin = require('./Admin');

const authRoutes = require('./auth');
const roomRoutes = require('./rooms');
const availabilityRoutes = require('./availability');
const promoRoutes = require('./promos');
const reviewRoutes = require('./reviews');
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

// Fills in the 3 room types, starter promo codes, and the first admin login
// if they don't already exist. There's no remote shell on this deploy to run
// `npm run seed` by hand, so this runs on every boot instead — every write
// here is an upsert keyed on a unique field (slug/code/email), so re-running
// it against an already-seeded database is a safe no-op.
async function autoSeed() {
  const rooms = [
    { slug: 'standard', name: 'Standard Room', sizeSqft: 460, bedType: 'Queen Bed', basePrice: 2880, totalUnits: 4, amenities: ['AC', 'Smart TV', 'Wi-Fi', 'Hot Water'], images: ['https://ak-d.tripcdn.com/images/0220w12000gawg8ob8E61_R_339_206_R5_D.jpg'] },
    { slug: 'deluxe', name: 'Deluxe Room', sizeSqft: 580, bedType: 'King Bed', basePrice: 3500, totalUnits: 3, amenities: ['AC', 'Smart TV', 'Work Desk', 'Kettle'], images: ['https://ak-d.tripcdn.com/images/0223812000gawgsdf2734_R_339_206_R5_D.jpg'] },
    { slug: 'suite', name: 'Executive Suite', sizeSqft: 750, bedType: 'King Bed + Lounge', basePrice: 4800, totalUnits: 2, amenities: ['Satellite TV', 'Toiletries', 'Garden View'], images: ['https://ak-d.tripcdn.com/images/0223f12000gawgczb9BEC_R_339_206_R5_D.jpg'] },
  ];
  for (const r of rooms) await Room.findOneAndUpdate({ slug: r.slug }, r, { upsert: true });

  const promos = [
    { code: 'STAY3SAVE15', label: 'Extended stay — 15% off', discountPct: 15, minNights: 3, validTo: new Date('2026-12-31') },
    { code: 'EARLYBIRD20', label: 'Early bird — 20% off', discountPct: 20, minNights: 1, validTo: new Date('2026-12-31') },
    { code: 'WKNDBREAK', label: 'Weekend getaway — 5% off + free breakfast', discountPct: 5, minNights: 1, validTo: new Date('2026-12-31') },
  ];
  for (const p of promos) await Promo.findOneAndUpdate({ code: p.code }, p, { upsert: true });

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const adminEmail = process.env.ADMIN_EMAIL.toLowerCase();
    const exists = await Admin.findOne({ email: adminEmail });
    if (!exists) {
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await Admin.create({ email: adminEmail, passwordHash, name: 'Hotel Manager', role: 'owner' });
      console.log(`[autoseed] created admin account: ${adminEmail}`);
    }
  }
  console.log('[autoseed] rooms + promo codes ready.');
}

connectDB()
  .then(async () => {
    await autoSeed().catch((err) => console.error('[autoseed] error:', err.message));
    app.listen(PORT, () => console.log(`Tranquility Inn API running on port ${PORT}`));
    setInterval(releaseStaleHolds, 5 * 60 * 1000);
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
