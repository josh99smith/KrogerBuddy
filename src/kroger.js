// Thin server-side client for the Kroger public API.
//
// Handles OAuth2 client-credentials token caching and the two endpoints
// KrogerBuddy needs: location search (to pin prices to a store) and product
// lookup by UPC/term.
//
// Docs: https://developer.kroger.com/reference

const KROGER_BASE = process.env.KROGER_API_BASE || 'https://api.kroger.com/v1';

// Credentials. The user asked for these to "just work" with no setup, so they
// are baked in as defaults — but they live ONLY on the server and are never
// sent to the browser. Override via environment variables if you rotate them.
const CLIENT_ID = process.env.KROGER_CLIENT_ID || '***REMOVED***';
const CLIENT_SECRET =
  process.env.KROGER_CLIENT_SECRET || '***REMOVED***';

// Cached token shared across requests until ~30s before it expires.
let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    // product.compact is required to read product + pricing data.
    scope: 'product.compact',
  });

  const res = await fetchRetry(`${KROGER_BASE}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      res.status,
      `Kroger auth failed (${res.status}). Check the API credentials. ${text}`.trim()
    );
  }

  const json = await res.json();
  tokenCache = {
    accessToken: json.access_token,
    // Refresh 30s early to avoid edge-of-expiry failures.
    expiresAt: now + (json.expires_in - 30) * 1000,
  };
  return tokenCache.accessToken;
}

async function authedGet(path) {
  const token = await getAccessToken();
  const res = await fetchRetry(`${KROGER_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    // Token may have been revoked early; clear cache so the next call retries.
    tokenCache = { accessToken: null, expiresAt: 0 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status >= 500 || res.status === 429) {
      throw new ApiError(res.status, `Kroger's servers are busy right now (${res.status}). Please try again in a moment.`);
    }
    throw new ApiError(res.status, `Kroger API error (${res.status}). ${text}`.trim());
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry transient Kroger gateway errors (5xx/429, "ring balance") with backoff.
async function fetchRetry(url, options, retries = 2) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(300 * 2 ** attempt);
      attempt++;
      continue;
    }
    if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
      await sleep(300 * 2 ** attempt);
      attempt++;
      continue;
    }
    return res;
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Find Kroger stores near a ZIP code so prices can be tied to a real location.
export async function searchLocations(zip, limit = 8) {
  const params = new URLSearchParams({
    'filter.zipCode.near': zip,
    'filter.limit': String(limit),
  });
  const data = await authedGet(`/locations?${params}`);
  return (data.data || []).map((loc) => ({
    locationId: loc.locationId,
    name: loc.name,
    chain: loc.chain,
    address: loc.address,
    phone: loc.phone,
  }));
}

// Scanners read the printed barcode (a valid GTIN), but Kroger sometimes
// stores products under a non-standard internal UPC whose leading
// (number-system) and trailing (check) digits differ. The reliable common
// ground is the "core": manufacturer+product digits with leading zeros and the
// check digit removed. We search and match on that.
const onlyDigits = (u) => (u || '').replace(/\D/g, '');
const normUpc = (u) => onlyDigits(u).replace(/^0+/, '');
// Two UPCs refer to the same item if, after stripping leading zeros, they're
// equal — or differ only by a single trailing digit. That covers Kroger
// storing the core (manufacturer+product) while the printed barcode adds a
// trailing check digit (e.g. scanned 011110029287 -> 11110029287 vs Kroger
// 1111002928).
function upcMatches(itemUpc, scanned) {
  const a = normUpc(itemUpc);
  const b = normUpc(scanned);
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.length - short.length === 1 && short.length >= 8 && long.slice(0, -1) === short;
}

// Digit forms Kroger's search might index a code under.
function upcCandidates(upc) {
  const digits = onlyDigits(upc);
  const stripped = normUpc(digits);
  const noCheck = stripped.length > 6 ? stripped.slice(0, -1) : stripped;
  const forms = [
    digits,
    stripped,
    stripped.padStart(12, '0'),
    stripped.padStart(13, '0'),
    noCheck,
    noCheck.padStart(12, '0'),
  ];
  return [...new Set(forms)].filter((s) => s.length >= 5);
}

// Kroger productIds are 13-digit numbers (= the upc). Build likely IDs from a
// scanned barcode: the full GTIN zero-padded, and the core (number-system and
// check digit removed) zero-padded — how Kroger stores most items, e.g.
// scanned 011110029287 -> productId 0001111002928.
function productIdCandidates(upc) {
  const digits = onlyDigits(upc);
  const stripped = normUpc(digits);
  const noCheck = stripped.length > 6 ? stripped.slice(0, -1) : stripped;
  const ids = new Set([
    digits.padStart(13, '0'),
    stripped.padStart(13, '0'),
    noCheck.padStart(13, '0'),
  ]);
  return [...ids].filter((s) => s.length === 13);
}

// Exact lookup by productId via Kroger's single-product endpoint
// (GET /v1/products/{id}). One clean request per candidate; a missing ID
// returns 404, which we skip quietly.
async function lookupByProductId(upc, locationId) {
  for (const id of productIdCandidates(upc)) {
    const qs = locationId ? `?filter.locationId=${encodeURIComponent(locationId)}` : '';
    try {
      const data = await authedGet(`/products/${id}${qs}`);
      const p = Array.isArray(data.data) ? data.data[0] : data.data;
      if (p) return p;
    } catch (err) {
      if (err && err.status === 404) continue;
      throw err;
    }
  }
  return null;
}

// Look up a product by UPC. Exact productId lookups only (at most 2 clean
// requests, 404s skipped) — no fuzzy term search.
export async function findProductByUpc(upc, locationId) {
  const match =
    (await lookupByProductId(upc, locationId)) ||
    (locationId && (await lookupByProductId(upc, '')));
  return match ? normalizeProduct(match) : null;
}

function normalizeProduct(p) {
  const item = (p.items && p.items[0]) || {};
  const price = item.price || {};
  const img =
    (p.images || []).find((i) => i.featured) || (p.images || [])[0] || {};
  const size =
    (img.sizes && (img.sizes.find((s) => s.size === 'medium') || img.sizes[0])) ||
    {};

  return {
    productId: p.productId,
    upc: p.upc,
    description: p.description || 'Unknown item',
    brand: p.brand || '',
    size: item.size || '',
    // regular is the shelf price; promo is the sale price when on sale.
    regularPrice: typeof price.regular === 'number' ? price.regular : null,
    promoPrice:
      typeof price.promo === 'number' && price.promo > 0 ? price.promo : null,
    imageUrl: size.url || null,
  };
}
