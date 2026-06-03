// KrogerBuddy API proxy — Cloudflare Worker.
//
// GitHub Pages can only serve static files, so this Worker plays the role the
// Node server plays locally: it holds the Kroger credentials, manages the
// OAuth token, and exposes the two read-only endpoints the front end calls.
// Because the browser hits this from a different origin (github.io), every
// response includes CORS headers.
//
// Deploy with:  cd worker && npx wrangler deploy
// Set secrets:  npx wrangler secret put KROGER_CLIENT_SECRET
//               npx wrangler secret put KROGER_CLIENT_ID   (optional)

const KROGER_BASE = 'https://api.kroger.com/v1';

// Fallback credentials so it works without extra setup. Prefer setting these
// as Worker secrets (see above) so they aren't stored in the repo.
const DEFAULT_CLIENT_ID = '***REMOVED***';
const DEFAULT_CLIENT_SECRET = '***REMOVED***';

// Token cache lives on the module scope; it survives between requests handled
// by the same warm isolate, so we mint far fewer tokens than requests.
let tokenCache = { accessToken: null, expiresAt: 0 };

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOW_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

async function getAccessToken(env) {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = (env && env.KROGER_CLIENT_ID) || DEFAULT_CLIENT_ID;
  const clientSecret = (env && env.KROGER_CLIENT_SECRET) || DEFAULT_CLIENT_SECRET;
  const basic = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(`${KROGER_BASE}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=product.compact',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, `Kroger auth failed (${res.status}). ${text}`.trim());
  }

  const data = await res.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in - 30) * 1000,
  };
  return tokenCache.accessToken;
}

async function authedGet(path, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`${KROGER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) tokenCache = { accessToken: null, expiresAt: 0 };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, `Kroger API error (${res.status}). ${text}`.trim());
  }
  return res.json();
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizeProduct(p) {
  const item = (p.items && p.items[0]) || {};
  const price = item.price || {};
  const img = (p.images || []).find((i) => i.featured) || (p.images || [])[0] || {};
  const size =
    (img.sizes && (img.sizes.find((s) => s.size === 'medium') || img.sizes[0])) || {};
  return {
    productId: p.productId,
    upc: p.upc,
    description: p.description || 'Unknown item',
    brand: p.brand || '',
    size: item.size || '',
    regularPrice: typeof price.regular === 'number' ? price.regular : null,
    promoPrice: typeof price.promo === 'number' && price.promo > 0 ? price.promo : null,
    imageUrl: size.url || null,
  };
}

async function handleLocations(searchParams, env) {
  const zip = (searchParams.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return json({ error: 'Please provide a valid 5-digit ZIP code.' }, 400, env);
  }
  const params = new URLSearchParams({
    'filter.zipCode.near': zip,
    'filter.limit': '8',
  });
  const data = await authedGet(`/locations?${params}`, env);
  const locations = (data.data || []).map((loc) => ({
    locationId: loc.locationId,
    name: loc.name,
    chain: loc.chain,
    address: loc.address,
    phone: loc.phone,
  }));
  return json({ locations }, 200, env);
}

// --- UPC normalization & matching ------------------------------------------
// Scanners read the printed barcode (a valid GTIN), but Kroger sometimes stores
// products under a non-standard internal UPC whose leading (number-system) and
// trailing (check) digits differ. The reliable common ground is the "core":
// the manufacturer+product digits with leading zeros and the check digit
// removed. We search and match on that.
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

// Digit forms Kroger's search might index a code under (full, zero-stripped,
// padded, and check-digit-stripped variants).
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

// Kroger productIds are 13-digit numbers (= the upc). Build the likely IDs from
// a scanned barcode: the full GTIN zero-padded, and the core (number-system and
// check digit removed) zero-padded — which is how Kroger stores most items,
// e.g. scanned 011110029287 -> productId 0001111002928.
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

// Exact lookup by productId (the correct way to find a specific item — unlike
// filter.term, which is a fuzzy keyword search).
async function lookupByProductId(upc, locationId, env) {
  const ids = productIdCandidates(upc);
  if (!ids.length) return null;
  const params = new URLSearchParams({
    'filter.productId': ids.join(','),
    'filter.limit': '50',
  });
  if (locationId) params.set('filter.locationId', locationId);
  const data = await authedGet(`/products?${params}`, env);
  const items = data.data || [];
  return items.find((p) => upcMatches(p.upc, upc)) || items[0] || null;
}

// Last-resort fuzzy search by term, kept only as a fallback.
async function searchExact(upc, locationId, env) {
  for (const term of upcCandidates(upc)) {
    const params = new URLSearchParams({ 'filter.term': term, 'filter.limit': '30' });
    if (locationId) params.set('filter.locationId', locationId);
    const data = await authedGet(`/products?${params}`, env);
    const match = (data.data || []).find((p) => upcMatches(p.upc, upc));
    if (match) return match;
  }
  return null;
}

async function handleProduct(upc, searchParams, env) {
  if (!/^\d{6,14}$/.test(upc)) {
    return json({ error: 'That does not look like a valid UPC barcode.' }, 400, env);
  }
  const locationId = (searchParams.get('locationId') || '').trim();

  // Exact productId lookup first (with store for pricing, then without), then
  // fall back to the fuzzy term search.
  let match =
    (await lookupByProductId(upc, locationId, env)) ||
    (locationId && (await lookupByProductId(upc, '', env))) ||
    (await searchExact(upc, locationId, env)) ||
    (locationId && (await searchExact(upc, '', env)));

  if (!match) {
    return json(
      {
        error: `No Kroger product matches UPC ${upc}. Try rescanning or enter the UPC manually.`,
      },
      404,
      env
    );
  }
  return json({ product: normalizeProduct(match) }, 200, env);
}

// Diagnostic: show exactly what Kroger returns for each candidate UPC form.
// Safe to expose (no secrets). Visit /api/debug/<upc>[?locationId=...].
async function handleDebug(upc, searchParams, env) {
  const locationId = (searchParams.get('locationId') || '').trim();

  // The exact productId lookup (the real fix).
  const ids = productIdCandidates(upc);
  let productIdLookup = { ids };
  try {
    const params = new URLSearchParams({ 'filter.productId': ids.join(','), 'filter.limit': '50' });
    if (locationId) params.set('filter.locationId', locationId);
    const data = await authedGet(`/products?${params}`, env);
    const items = data.data || [];
    productIdLookup.count = items.length;
    productIdLookup.items = items.slice(0, 8).map((p) => ({
      upc: p.upc,
      productId: p.productId,
      description: p.description,
      matches: upcMatches(p.upc, upc),
    }));
  } catch (err) {
    productIdLookup.error = err.message;
  }

  // The fuzzy term search (fallback) for comparison.
  const results = [];
  for (const term of upcCandidates(upc)) {
    const params = new URLSearchParams({ 'filter.term': term, 'filter.limit': '20' });
    if (locationId) params.set('filter.locationId', locationId);
    try {
      const data = await authedGet(`/products?${params}`, env);
      const items = data.data || [];
      results.push({
        term,
        count: items.length,
        sample: items.slice(0, 5).map((p) => ({ upc: p.upc, description: p.description })),
      });
    } catch (err) {
      results.push({ term, error: err.message });
    }
  }
  return json({ scanned: upc, locationId: locationId || null, productIdLookup, termResults: results }, 200, env);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    try {
      if (pathname === '/api/health') return json({ ok: true }, 200, env);
      if (pathname === '/api/locations') return await handleLocations(searchParams, env);
      if (pathname.startsWith('/api/debug/')) {
        const upc = decodeURIComponent(pathname.slice('/api/debug/'.length)).trim();
        return await handleDebug(upc, searchParams, env);
      }
      if (pathname.startsWith('/api/product/')) {
        const upc = decodeURIComponent(pathname.slice('/api/product/'.length)).trim();
        return await handleProduct(upc, searchParams, env);
      }
      return json({ error: 'Not found' }, 404, env);
    } catch (err) {
      const status = err instanceof ApiError ? err.status || 502 : 500;
      return json({ error: err.message || 'Unexpected error' }, status, env);
    }
  },
};
