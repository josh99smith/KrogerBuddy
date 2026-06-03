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

// Normalize a UPC for comparison by dropping leading zeros (UPC-A 12 vs
// Kroger's 13-digit form, etc).
const normUpc = (u) => (u || '').replace(/^0+/, '');

// Different digit forms Kroger's search might index this code under.
function upcCandidates(upc) {
  const stripped = normUpc(upc);
  const forms = [upc, stripped, stripped.padStart(12, '0'), stripped.padStart(13, '0')];
  return [...new Set(forms)].filter((s) => s.length >= 6);
}

// Search Kroger across candidate UPC forms and return the item whose UPC
// exactly matches (normalized). Only an exact match is trusted.
async function searchExact(upc, locationId, env) {
  for (const term of upcCandidates(upc)) {
    const params = new URLSearchParams({ 'filter.term': term, 'filter.limit': '20' });
    if (locationId) params.set('filter.locationId', locationId);
    const data = await authedGet(`/products?${params}`, env);
    const exact = (data.data || []).find((p) => normUpc(p.upc) === normUpc(upc));
    if (exact) return exact;
  }
  return null;
}

async function handleProduct(upc, searchParams, env) {
  if (!/^\d{6,14}$/.test(upc)) {
    return json({ error: 'That does not look like a valid UPC barcode.' }, 400, env);
  }
  const locationId = (searchParams.get('locationId') || '').trim();

  // First try the selected store (gets pricing). If nothing matches there,
  // retry without a store so we can still identify the item (without price).
  let exact = await searchExact(upc, locationId, env);
  if (!exact && locationId) exact = await searchExact(upc, '', env);

  if (!exact) {
    return json(
      {
        error: `No Kroger product matches UPC ${upc}. Try rescanning or enter the UPC manually.`,
      },
      404,
      env
    );
  }
  return json({ product: normalizeProduct(exact) }, 200, env);
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
