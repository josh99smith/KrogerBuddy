// KrogerBuddy backend.
//
// Serves the mobile web app from /public and exposes a tiny JSON API that
// proxies the Kroger API. The proxy exists for two reasons:
//   1. The Kroger API does not allow cross-origin browser requests (CORS).
//   2. The OAuth client secret must never be exposed to the browser.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchLocations, findProductByUpc, ApiError } from './src/kroger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wrap async handlers so thrown errors become clean JSON responses.
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    const status = err instanceof ApiError ? err.status || 502 : 500;
    console.error('[KrogerBuddy]', err.message);
    res.status(status).json({ error: err.message || 'Unexpected server error' });
  });
};

// GET /api/locations?zip=45202  -> nearby Kroger stores
app.get(
  '/api/locations',
  wrap(async (req, res) => {
    const zip = (req.query.zip || '').toString().trim();
    if (!/^\d{5}$/.test(zip)) {
      return res.status(400).json({ error: 'Please provide a valid 5-digit ZIP code.' });
    }
    const locations = await searchLocations(zip);
    res.json({ locations });
  })
);

// GET /api/product/:upc?locationId=... -> single product with price
app.get(
  '/api/product/:upc',
  wrap(async (req, res) => {
    const upc = (req.params.upc || '').toString().trim();
    const locationId = (req.query.locationId || '').toString().trim() || undefined;
    if (!/^\d{6,14}$/.test(upc)) {
      return res.status(400).json({ error: 'That does not look like a valid UPC barcode.' });
    }
    const product = await findProductByUpc(upc, locationId);
    if (!product) {
      return res.status(404).json({ error: `No Kroger product found for UPC ${upc}.` });
    }
    res.json({ product });
  })
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`KrogerBuddy running at http://localhost:${PORT}`);
});
