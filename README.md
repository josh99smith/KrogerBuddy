# 🛒 KrogerBuddy

A mobile companion shopping app for your Kroger run. Open it on your phone,
scan items as you put them in the cart, and watch your running total — with
tax — update live.

## What it does

- **Scan barcodes / UPCs** with your phone camera (or type a UPC by hand).
- **Looks up each item** against the official Kroger public API, pulling the
  product name, size, image, and **store-specific price** (including sale
  prices).
- **Keeps a running shopping list** with per-item quantity controls.
- **Tracks your spend with tax** — set your local sales-tax rate and toggle
  individual items as taxable (groceries are tax-exempt in many states).
- **Remembers your cart** across refreshes (saved on your device), so you
  won't lose your list mid-aisle.

## How it's built

```
KrogerBuddy/
├── server.js        Express server: serves the app + proxies the Kroger API
├── src/kroger.js    Kroger API client (OAuth token caching, products, stores)
└── public/          The mobile web app (HTML/CSS/vanilla JS, no build step)
    ├── index.html
    ├── styles.css
    ├── app.js
    └── manifest.json
```

### Why there's a small backend

The browser can't call the Kroger API directly: Kroger blocks cross-origin
browser requests (CORS), and the OAuth **client secret must never ship to the
browser**. So a tiny Node/Express server holds the credentials, manages the
OAuth token, and exposes just two safe JSON endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/locations?zip=45202` | Find nearby Kroger-family stores |
| `GET /api/product/:upc?locationId=...` | Look up an item + its price |

## Running it

```bash
npm install
npm start
# then open http://localhost:3000
```

The Kroger credentials are baked into `src/kroger.js` as defaults so it works
out of the box. You can override them with environment variables if you rotate
keys:

```bash
KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=... npm start
```

### Using it on your phone in the store

The camera scanner needs a **secure context** — that means `https://` (or
`localhost`). To use it on your phone in a store you'll want to deploy it to
any host that gives you HTTPS (Render, Railway, Fly.io, a VPS with a cert,
etc.), then open that URL on your phone and "Add to Home Screen" to use it
like an app.

1. Tap **Pick a store** and search by ZIP so prices match your store.
2. Tap **Scan a barcode** and point the camera at a UPC, or type it in.
3. Adjust quantities, set your tax rate, and the **Total** updates live.

## Deploying for public access (GitHub Pages + Cloudflare Worker)

GitHub Pages serves only static files, so the app is split: the front end runs
on Pages, and the Kroger proxy (which holds the secret) runs on a free
Cloudflare Worker. The browser calls the Worker cross-origin; the Worker adds
CORS headers and talks to Kroger.

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login           # one-time, opens a browser
npx wrangler deploy          # prints your Worker URL
```

Keep the credentials out of the repo by setting them as secrets (they override
the in-code fallbacks):

```bash
npx wrangler secret put KROGER_CLIENT_SECRET
npx wrangler secret put KROGER_CLIENT_ID
```

Optionally lock the Worker to your Pages origin by uncommenting `ALLOW_ORIGIN`
in `worker/wrangler.toml`.

### 2. Point the front end at the Worker

Edit `public/config.js` and set the URL `wrangler deploy` printed:

```js
window.KROGERBUDDY_CONFIG = {
  apiBase: 'https://krogerbuddy-api.YOUR-SUBDOMAIN.workers.dev',
};
```

(Or skip editing and just open the site once with `?api=<worker-url>` — it's
remembered in the browser.)

### 3. Turn on GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source = "GitHub
Actions"**. The included workflow (`.github/workflows/deploy-pages.yml`)
publishes `public/` on every push. Your app will be live at
`https://<your-username>.github.io/<repo>/` — open it on your phone and "Add to
Home Screen".

> **Heads-up on a public, shared deployment:** every visitor's lookups use your
> one set of Kroger credentials and count against your API quota. That's fine
> for personal/family use; if you ever expect heavier traffic, set the
> `ALLOW_ORIGIN` lock and keep an eye on your Kroger developer dashboard.

## Notes & limits

- **Network access:** the server must be able to reach `api.kroger.com`. In
  locked-down/sandboxed environments that host may be blocked by an outbound
  allowlist; run it somewhere with normal internet access.
- **Prices** are returned by Kroger only when a store (`locationId`) is set —
  pick a store first to see them. Not every product is sold at every store.
- Tax is applied to the taxable subtotal at the rate you enter; it's an
  estimate to help you budget, not an official receipt.
