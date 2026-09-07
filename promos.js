// public/js/promos.js
//
// Refreshes the "Valid until ..." text on each promo card using live
// data from /api/promos, so the displayed date always matches what's
// in MongoDB.
//
// REQUIRES two small markup tweaks in your promo card HTML (see below).

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/promos');
    if (!res.ok) return;
    const promos = await res.json();

    promos.forEach((promo) => {
      const card = document.querySelector(`[data-promo-code="${promo.code}"]`);
      if (!card) return;

      const validEl = card.querySelector('[data-promo-valid]');
      if (validEl) {
        validEl.textContent = `Valid until ${promo.validToFormatted}`;
      }
    });
  } catch (err) {
    console.error('Could not refresh promo validity dates:', err);
  }
});
