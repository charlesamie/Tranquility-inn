// Run once after connecting your MongoDB Atlas cluster:  npm run seed
// Creates the 3 room types, starter promo codes, and the first admin login.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./db');
const Room = require('./models/Room');
const Promo = require('./models/Promo');
const Admin = require('./models/Admin');

async function seed() {
  await connectDB();

  const rooms = [
    {
      slug: 'standard', name: 'Standard Room', sizeSqft: 460, bedType: 'Queen Bed',
      basePrice: 2880, totalUnits: 4,
      amenities: ['AC', 'Smart TV', 'Wi-Fi', 'Hot Water'],
      images: ['https://ak-d.tripcdn.com/images/0220w12000gawg8ob8E61_R_339_206_R5_D.jpg'],
    },
    {
      slug: 'deluxe', name: 'Deluxe Room', sizeSqft: 580, bedType: 'King Bed',
      basePrice: 3500, totalUnits: 3,
      amenities: ['AC', 'Smart TV', 'Work Desk', 'Kettle'],
      images: ['https://ak-d.tripcdn.com/images/0223812000gawgsdf2734_R_339_206_R5_D.jpg'],
    },
    {
      slug: 'suite', name: 'Executive Suite', sizeSqft: 750, bedType: 'King Bed + Lounge',
      basePrice: 4800, totalUnits: 2,
      amenities: ['Satellite TV', 'Toiletries', 'Garden View'],
      images: ['https://ak-d.tripcdn.com/images/0223f12000gawgczb9BEC_R_339_206_R5_D.jpg'],
    },
  ];

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
