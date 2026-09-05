const express = require('express');
const router = express.Router();

// GET /api/google-reviews — public. Proxies your Google Business Profile's
// reviews via the Places API, so the API key never has to sit in
// browser-facing code (see index.html).
//
// Setup:
//   1. Google Cloud Console → enable "Places API" (same project as Maps Embed).
//   2. Create an API key, restrict it to "Places API" only — no HTTP referrer
//      restriction needed, since this call happens server-side, not from the browser.
//   3. Find your Place ID: https://developers.google.com/maps/documentation/places/web-service/place-id
//   4. Add to this host's environment variables (and .env locally, alongside
//      MONGO_URI etc.):
//        GOOGLE_PLACES_API_KEY=...
//        GOOGLE_PLACE_ID=...
//
// Google's Places API caps this at a MAXIMUM of 5 reviews per location —
// that's a Google limit, not something this route can change.

let cache = null;
let cacheTime = 0;
const CACHE_MS = 24 * 60 * 60 * 1000; // 24h — reviews barely change; avoids burning Google's quota

router.get('/', async (req, res) => {
  try {
    if (cache && Date.now() - cacheTime < CACHE_MS) {
      return res.json(cache);
    }

    const { GOOGLE_PLACES_API_KEY, GOOGLE_PLACE_ID } = process.env;
    if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) {
      return res.status(503).json({ error: 'Google reviews not configured yet.' });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${GOOGLE_PLACE_ID}` +
      `&fields=rating,user_ratings_total,reviews` +
      `&key=${GOOGLE_PLACES_API_KEY}`;

    const r = await fetch(url); // Node 18+ has fetch built in (matches package.json engines)
    const data = await r.json();
    if (data.status !== 'OK') throw new Error(data.status || 'Places API error');

    const result = {
      rating: data.result.rating,
      userRatingsTotal: data.result.user_ratings_total,
      reviews: (data.result.reviews || []).map((rv) => ({
        author_name: rv.author_name,
        rating: rv.rating,
        text: rv.text,
        relative_time_description: rv.relative_time_description,
        profile_photo_url: rv.profile_photo_url,
      })),
    };

    cache = result;
    cacheTime = Date.now();
    res.json(result);
  } catch (err) {
    console.error('[google-reviews] fetch failed:', err.message);
    res.status(502).json({ error: 'Could not load Google reviews.' });
  }
});

module.exports = router;
