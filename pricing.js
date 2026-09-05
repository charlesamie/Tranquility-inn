// Shared by routes/availability.js and routes/payment.js so the displayed
// price, the availability-check price, and the actual charged price can
// never drift apart from each other.
//
// Only rooms with `occupancyPricing` set (currently: Premium Room) use
// tiered pricing. Every other room just charges `basePrice` regardless of
// the guests value.

function occupancyTierFromGuests(guests) {
  const g = String(guests || '').toLowerCase();
  if (g.includes('1 adult') && !g.includes('2') && !g.includes('3')) return 'single';
  if (g.includes('child') || g.includes('3 adult')) return 'triple'; // extra cot territory
  return 'double'; // default / "2 Adults"
}

function getRoomRate(room, guests) {
  if (!room.occupancyPricing) return room.basePrice;
  const tier = occupancyTierFromGuests(guests);
  return room.occupancyPricing[tier] || room.basePrice;
}

module.exports = { occupancyTierFromGuests, getRoomRate };
