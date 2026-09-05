// Run once after connecting your MongoDB Atlas cluster:  npm run seed
// Creates the 3 room types, starter promo codes, and the first admin login.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./db');
const Room = require('./Room');
const Promo = require('./Promo');
const Admin = require('./Admin');

async function seed() {
  await connectDB();

  const rooms = [
    {
      slug: 'standard', name: 'Standard Room', sizeSqft: 460, bedType: 'Queen Bed',
      basePrice: 2880, totalUnits: 4,
      amenities: ['AC', 'Smart TV', 'Wi-Fi', 'Hot Water'],
      images: ['standard-room.jpg'],
    },
    {
      slug: 'family', name: 'Family Room', sizeSqft: 620, bedType: '2 King Beds',
      basePrice: 5000, totalUnits: 2,
      amenities: ['AC', 'Smart TV', 'Wi-Fi', '2 King Beds'],
      images: ['family-room.jpg'],
    },
    {
      slug: 'premium', name: 'Premium Room', sizeSqft: 540, bedType: 'King Bed',
      basePrice: 3000, // = single-occupancy rate; see occupancyPricing for the rest
      occupancyPricing: { single: 3000, double: 3500, triple: 4000 },
      totalUnits: 3,
      amenities: ['AC', 'Smart TV', 'Wi-Fi', 'Premium Interiors'],
      images: ['premium-room.jpg'],
    },
    {
      slug: 'penthouse', name: 'Pent House', sizeSqft: 1200, bedType: 'Private Rooftop',
      basePrice: 10000, totalUnits: 1,
      amenities: ['Private Rooftop', 'Seating for 30', 'Get-together Ready'],
      images: ['penthouse-1.jpg', 'penthouse-2.jpg', 'penthouse-3.jpg'],
    },
  ];

  // Drop the old room types entirely — they're being replaced, not kept alongside.
  await Room.deleteMany({ slug: { $in: ['deluxe', 'suite'] } });

  for (const r of rooms) {
    await Room.findOneAndUpdate({ slug: r.slug }, r, { upsert: true, new: true });
  }
  console.log(`Seeded ${rooms.length} room types.`);

  const promos = [
    { code: 'STAY3SAVE15', label: 'Extended stay — 15% off', discountPct: 15, minNights: 3, validTo: new Date('2026-12-31') },
    { code: 'EARLYBIRD20', label: 'Early bird — 20% off', discountPct: 20, minNights: 1, validTo: new Date('2026-12-31') },
    { code: 'WKNDBREAK', label: 'Weekend getaway — 5% off + free breakfast', discountPct: 5, minNights: 1, validTo: new Date('2026-12-31') },
  ];
  for (const p of promos) {
    await Promo.findOneAndUpdate({ code: p.code }, p, { upsert: true, new: true });
  }
  console.log(`Seeded ${promos.length} promo codes.`);

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@tranquilityinn-chennai.com').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('ADMIN_PASSWORD not set in .env — skipping admin account creation.');
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await Admin.findOneAndUpdate(
      { email: adminEmail },
      { email: adminEmail, passwordHash, name: 'Hotel Manager', role: 'owner' },
      { upsert: true, new: true }
    );
    console.log(`Seeded admin account: ${adminEmail}`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
