// KrogerBuddy front-end logic.
//
// State (cart, chosen store, tax rate) lives in localStorage so a refresh or
// accidental navigation while you're walking the aisles won't lose your list.

const STORAGE_KEY = 'krogerbuddy.v1';
const API_BASE_KEY = 'krogerbuddy.apiBase';

// Where the Kroger proxy lives. Same-origin "" works for local `npm start`;
// on GitHub Pages this points at the Cloudflare Worker (set in config.js, or
// overridden once via a ?api=<url> query param).
const API_BASE = resolveApiBase();

function resolveApiBase() {
  try {
    const fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) localStorage.setItem(API_BASE_KEY, fromQuery.replace(/\/$/, ''));
    const stored = localStorage.getItem(API_BASE_KEY);
    const configured =
      (window.KROGERBUDDY_CONFIG && window.KROGERBUDDY_CONFIG.apiBase) || '';
    return (configured || stored || '').replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

const state = loadState();

// ---- Persistence -----------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { cart: [], store: null, taxRate: 0 };
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

// ---- Element refs ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  startScanBtn: $('startScanBtn'),
  stopScanBtn: $('stopScanBtn'),
  readerWrap: $('readerWrap'),
  scanControls: $('scanControls'),
  manualForm: $('manualForm'),
  manualUpc: $('manualUpc'),
  cartList: $('cartList'),
  emptyHint: $('emptyHint'),
  itemCount: $('itemCount'),
  clearBtn: $('clearBtn'),
  subtotal: $('subtotal'),
  taxRate: $('taxRate'),
  taxAmount: $('taxAmount'),
  total: $('total'),
  storeBtn: $('storeBtn'),
  storeLabel: $('storeLabel'),
  storeModal: $('storeModal'),
  storeForm: $('storeForm'),
  zipInput: $('zipInput'),
  storeResults: $('storeResults'),
  closeStoreBtn: $('closeStoreBtn'),
};

// ---- Helpers ---------------------------------------------------------------
const money = (n) => `$${(n || 0).toFixed(2)}`;
const unitPrice = (item) =>
  item.promoPrice != null ? item.promoPrice : item.regularPrice || 0;

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `status ${kind}`;
}

// ---- Cart operations -------------------------------------------------------
function addProductToCart(product) {
  const existing = state.cart.find((i) => i.upc === product.upc);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.unshift({
      ...product,
      qty: 1,
      // Sales tax on groceries varies; let the shopper decide per item.
      taxable: true,
    });
  }
  saveState();
  render();
}

function changeQty(upc, delta) {
  const item = state.cart.find((i) => i.upc === upc);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter((i) => i.upc !== upc);
  }
  saveState();
  render();
}

function toggleTaxable(upc) {
  const item = state.cart.find((i) => i.upc === upc);
  if (!item) return;
  item.taxable = !item.taxable;
  saveState();
  render();
}

function removeItem(upc) {
  state.cart = state.cart.filter((i) => i.upc !== upc);
  saveState();
  render();
}

// ---- Rendering -------------------------------------------------------------
function render() {
  // Store label
  els.storeLabel.textContent = state.store ? state.store.name : 'Pick a store';

  // Tax input reflects stored rate
  if (document.activeElement !== els.taxRate) {
    els.taxRate.value = state.taxRate;
  }

  // Cart list
  els.cartList.innerHTML = '';
  const count = state.cart.reduce((n, i) => n + i.qty, 0);
  els.itemCount.textContent = count;
  els.emptyHint.classList.toggle('hidden', state.cart.length > 0);

  let subtotal = 0;
  let taxableBase = 0;

  for (const item of state.cart) {
    const unit = unitPrice(item);
    const line = unit * item.qty;
    subtotal += line;
    if (item.taxable) taxableBase += line;
    els.cartList.appendChild(renderItem(item, line));
  }

  const rate = Number(state.taxRate) || 0;
  const tax = taxableBase * (rate / 100);

  els.subtotal.textContent = money(subtotal);
  els.taxAmount.textContent = money(tax);
  els.total.textContent = money(subtotal + tax);
}

function renderItem(item, line) {
  const li = document.createElement('li');
  li.className = 'cart-item';

  const unit = unitPrice(item);
  const onSale = item.promoPrice != null && item.regularPrice != null;
  const noPrice = item.regularPrice == null && item.promoPrice == null;

  const meta = [];
  if (item.brand) meta.push(item.brand);
  if (item.size) meta.push(item.size);
  const metaText = meta.join(' · ');

  const priceLine = noPrice
    ? '<span class="promo">no price for this store</span>'
    : onSale
    ? `<span class="promo">SALE ${money(unit)}</span> <s>${money(item.regularPrice)}</s> ea`
    : `${money(unit)} ea`;

  li.innerHTML = `
    ${
      item.imageUrl
        ? `<img src="${item.imageUrl}" alt="" loading="lazy" />`
        : `<div class="noimg">🛒</div>`
    }
    <div class="item-main">
      <div class="item-name">${escapeHtml(item.description)}</div>
      <div class="item-meta">${escapeHtml(metaText)}${metaText ? ' · ' : ''}${priceLine}</div>
    </div>
    <div class="item-right">
      <div class="line-price">${money(line)}</div>
      <div class="qty">
        <button type="button" data-act="dec" aria-label="decrease">−</button>
        <span>${item.qty}</span>
        <button type="button" data-act="inc" aria-label="increase">+</button>
      </div>
    </div>
    <div class="item-extra">
      <label class="taxable-toggle">
        <input type="checkbox" data-act="tax" ${item.taxable ? 'checked' : ''} />
        Taxable
      </label>
      <button type="button" class="remove-btn" data-act="remove">Remove</button>
    </div>
  `;

  li.addEventListener('click', (e) => {
    const act = e.target.getAttribute('data-act');
    if (act === 'inc') changeQty(item.upc, 1);
    else if (act === 'dec') changeQty(item.upc, -1);
    else if (act === 'remove') removeItem(item.upc);
    else if (act === 'tax') toggleTaxable(item.upc);
  });

  return li;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---- Product lookup --------------------------------------------------------
let lookupInFlight = false;

async function lookupUpc(upc) {
  if (lookupInFlight) return;
  lookupInFlight = true;
  setStatus(`Looking up ${upc}…`, 'busy');
  try {
    const params = state.store ? `?locationId=${encodeURIComponent(state.store.locationId)}` : '';
    const res = await fetch(`${API_BASE}/api/product/${encodeURIComponent(upc)}${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    addProductToCart(data.product);
    const p = data.product;
    if (p.regularPrice == null && p.promoPrice == null && !state.store) {
      setStatus(`Added "${p.description}". Pick a store to see prices.`, 'ok');
    } else {
      setStatus(`Added "${p.description}" — ${money(unitPrice(p))}`, 'ok');
    }
    beep();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    lookupInFlight = false;
  }
}

// Small confirmation tone on a successful scan.
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}

// ---- Barcode scanner -------------------------------------------------------
let scanner = null;
let lastScan = { code: null, at: 0 };

async function startScanner() {
  els.readerWrap.classList.remove('hidden');
  els.scanControls.classList.add('hidden');
  setStatus('Point the camera at a barcode…', 'busy');

  scanner = new Html5Qrcode('reader');
  const config = {
    fps: 10,
    qrbox: { width: 250, height: 160 },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
    ],
  };

  try {
    await scanner.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      () => {} // ignore per-frame decode failures
    );
  } catch (err) {
    setStatus(
      'Could not open the camera. Allow camera access, or type the UPC manually.',
      'error'
    );
    await stopScanner();
  }
}

function onScanSuccess(decodedText) {
  const code = decodedText.replace(/\D/g, '');
  if (!code) return;
  // Debounce: ignore the same code within 2.5s so one scan = one add.
  const now = Date.now();
  if (code === lastScan.code && now - lastScan.at < 2500) return;
  lastScan = { code, at: now };
  lookupUpc(code);
}

async function stopScanner() {
  if (scanner) {
    try {
      await scanner.stop();
      await scanner.clear();
    } catch (_) {}
    scanner = null;
  }
  els.readerWrap.classList.add('hidden');
  els.scanControls.classList.remove('hidden');
}

// ---- Store picker ----------------------------------------------------------
function openStoreModal() {
  els.storeModal.classList.remove('hidden');
  els.zipInput.focus();
}
function closeStoreModal() {
  els.storeModal.classList.add('hidden');
}

async function searchStores(zip) {
  els.storeResults.innerHTML = '<li class="empty-hint">Searching…</li>';
  try {
    const res = await fetch(`${API_BASE}/api/locations?zip=${encodeURIComponent(zip)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    renderStoreOptions(data.locations);
  } catch (err) {
    els.storeResults.innerHTML = `<li class="empty-hint">${escapeHtml(err.message)}</li>`;
  }
}

function renderStoreOptions(locations) {
  els.storeResults.innerHTML = '';
  if (!locations.length) {
    els.storeResults.innerHTML = '<li class="empty-hint">No stores found near that ZIP.</li>';
    return;
  }
  for (const loc of locations) {
    const li = document.createElement('li');
    li.className = 'store-option';
    const addr = loc.address
      ? `${loc.address.addressLine1 || ''}, ${loc.address.city || ''} ${loc.address.state || ''}`
      : '';
    li.innerHTML = `
      <div class="s-name">${escapeHtml(loc.name)}</div>
      <div class="s-addr">${escapeHtml(addr)}</div>
    `;
    li.addEventListener('click', () => {
      state.store = { locationId: loc.locationId, name: loc.name };
      saveState();
      closeStoreModal();
      render();
      setStatus(`Store set to ${loc.name}. New scans will show its prices.`, 'ok');
    });
    els.storeResults.appendChild(li);
  }
}

// ---- Wire up events --------------------------------------------------------
els.startScanBtn.addEventListener('click', startScanner);
els.stopScanBtn.addEventListener('click', stopScanner);

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const upc = els.manualUpc.value.replace(/\D/g, '');
  if (upc.length < 6) {
    setStatus('Enter at least 6 digits of the UPC.', 'error');
    return;
  }
  els.manualUpc.value = '';
  lookupUpc(upc);
});

els.clearBtn.addEventListener('click', () => {
  if (state.cart.length && confirm('Clear the whole cart?')) {
    state.cart = [];
    saveState();
    render();
    setStatus('Cart cleared.', '');
  }
});

els.taxRate.addEventListener('input', () => {
  const v = parseFloat(els.taxRate.value);
  state.taxRate = isNaN(v) ? 0 : v;
  saveState();
  render();
});

els.storeBtn.addEventListener('click', openStoreModal);
els.closeStoreBtn.addEventListener('click', closeStoreModal);
els.storeModal.addEventListener('click', (e) => {
  if (e.target === els.storeModal) closeStoreModal();
});
els.storeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const zip = els.zipInput.value.replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) {
    els.storeResults.innerHTML = '<li class="empty-hint">Enter a 5-digit ZIP code.</li>';
    return;
  }
  searchStores(zip);
});

// ---- Init ------------------------------------------------------------------
render();

// On a static host (e.g. GitHub Pages) the app needs to know where its API
// proxy lives. Surface a clear hint instead of letting lookups silently fail.
if (!API_BASE && /github\.io$/.test(location.hostname)) {
  setStatus(
    'Almost there — set your Cloudflare Worker URL in config.js (or add ?api=<worker-url> to the link) so item lookups work.',
    'error'
  );
}
