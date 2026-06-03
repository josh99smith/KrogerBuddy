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

  const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
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
  const res = await fetch(`${KROGER_BASE}${path}`, {
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
    throw new ApiError(res.status, `Kroger API error (${res.status}). ${text}`.trim());
  }
  return res.json();
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

// Look up a product by UPC (or any search term). When locationId is provided,
// Kroger returns store-specific pricing.
export async function findProductByUpc(upc, locationId) {
  const params = new URLSearchParams({
    'filter.term': upc,
    'filter.limit': '5',
  });
  if (locationId) params.set('filter.locationId', locationId);

  const data = await authedGet(`/products?${params}`);
  const items = data.data || [];

  // Only return an EXACT UPC match. Kroger's term search falls back to
  // loosely-related products, so taking the first result would surface the
  // wrong item. Normalize leading zeros (UPC-A 12 vs Kroger's 13-digit form).
  const norm = (u) => (u || '').replace(/^0+/, '');
  const exact = items.find((p) => norm(p.upc) === norm(upc));
  return exact ? normalizeProduct(exact) : null;
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
