# Tranquility Inn

Booking site + admin dashboard for Tranquility Inn (Manapakkam, Chennai).
Node/Express API + MongoDB, Razorpay payments, and two static front ends
(guest-facing site and admin panel) served by the same backend.

```
├── server.js              Express app entry point
├── db.js                  MongoDB connection
├── seed.js                One-time script: rooms, promo codes, first admin
├── models/                Mongoose schemas (Admin, Room, Booking, Review, Promo)
├── routes/                API routes (auth, rooms, availability, bookings, payment, webhook, reviews, promos)
├── middleware/auth.js     JWT check for admin-only routes
├── utils/captcha.js       Login CAPTCHA
├── services/notify.js     Booking confirmation email (SendGrid) + SMS (Twilio)
├── public/                Guest-facing site — served at /
└── admin/                 Admin dashboard — served at /admin
```

## 1. Local setup

Requires Node 18+ and a MongoDB Atlas connection string (the free tier works).

```bash
npm install
cp .env.example .env
# fill in .env — at minimum: MONGO_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed     # creates the 3 room types, 3 starter promo codes, and your admin login
npm run dev      # http://localhost:5000  (public site: /, admin: /admin)
```

After seeding once, remove `ADMIN_PASSWORD` from `.env` (or at least change it) so the
plaintext password isn't sitting in a file longer than it needs to.

## 2. Razorpay setup

1. Create a Razorpay account, get your test-mode `Key ID` / `Key Secret`, put them in `.env`.
2. In the Razorpay Dashboard → **Settings → Webhooks**, add a webhook once you're
   deployed (step 3): `https://YOUR-BACKEND-URL/api/payment/webhook`, subscribed to
   `payment.captured` and `payment.failed`. Copy the webhook secret into
   `RAZORPAY_WEBHOOK_SECRET`.
   - This webhook is what actually confirms a booking's payment server-to-server —
     the browser-side `/api/payment/verify` call is a fast path for the guest's UI,
     but the webhook is the source of truth if their connection drops after paying.
3. Switch to live keys before taking real payments.

## 3. Deploying

This is one Node service — deploy it as a single web service (e.g. **Render**,
**Railway**, or **Fly.io**) and it serves everything: `/api/*`, the public site at
`/`, and the admin dashboard at `/admin`.

1. Push this folder to a Git repo, connect it to your host.
2. Build command: `npm install`. Start command: `npm start`.
3. Set every variable from `.env.example` in the host's environment settings.
4. Run `npm run seed` once against the production database (most hosts let you run
   a one-off command/shell against the deployed service — Render calls this a "Shell").
5. Point your domain's DNS at the host (an A/ALIAS or CNAME record, per your host's
   instructions), then set `CLIENT_ORIGIN` to match.

**Domain naming note:** the code has a couple of `tranquilityinn-chennai.com`
references left over as defaults (`SENDGRID_FROM_EMAIL` in `.env.example`, the admin
login placeholder text) from before the `tranquility-inn.com` domain was registered —
update those to your real domain/email if you want a consistent brand, though they're
cosmetic and won't break anything.

## 4. What's already handled

- Bcrypt password hashing, JWT admin sessions, rate-limited login, stateless signed CAPTCHA
- Server-side price computation (never trusts a total from the browser)
- Razorpay signature verification + webhook, both idempotent against each other
- NoSQL-injection sanitization (`express-mongo-sanitize`) and a locked-down CSP (`helmet`)
- Stale-booking cleanup (unpaid holds auto-expire after 20 minutes so they stop
  blocking room availability)
- SEO: meta description, Open Graph/Twitter cards, canonical URL, `LodgingBusiness`
  JSON-LD, `robots.txt`, `sitemap.xml`

## 5. Worth doing before/soon after launch

- **Aadhaar/ID numbers**: `Booking.idProofNumber` is marked `select: false` so it's
  excluded from normal queries, but it's still stored in plaintext. For real ID
  numbers, encrypt this field at rest (e.g. `mongoose-encryption`, or application-level
  AES before save) given India's DPDP Act.
- **Admin roles**: the schema has `owner`/`manager` roles but every admin route
  currently just checks "is logged in," not which role. Add a role check to
  anything you want owner-only (e.g. deactivating rooms).
- **Refunds**: cancelling a paid booking in the admin panel doesn't trigger a
  Razorpay refund — that's still a manual step in the Razorpay dashboard today.
- **Legal pages**: the footer's Privacy/Terms links are placeholders (`#`) — there's
  no policy content yet, since that's a legal-content decision for you to make, not
  something to auto-generate.
- **Audit log**: no record of which admin cancelled a booking or approved a review.
