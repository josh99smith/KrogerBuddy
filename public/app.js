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
  confirmModal: $('confirmModal'),
  confirmBody: $('confirmBody'),
  confirmYes: $('confirmYes'),
  confirmNo: $('confirmNo'),
  cameraSelect: $('cameraSelect'),
  zoomWrap: $('zoomWrap'),
  zoomRange: $('zoomRange'),
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

    beep();
    // Don't add anything yet — let the shopper confirm it's the right item.
    showConfirm(data.product);
    setStatus('');
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

// ---- Confirm-before-add ----------------------------------------------------
let pendingProduct = null;
let awaitingConfirm = false;

function showConfirm(product) {
  pendingProduct = product;
  awaitingConfirm = true;
  // Freeze the camera while the shopper decides.
  if (scanner) {
    try {
      scanner.pause(true);
    } catch (_) {}
  }

  const p = product;
  const onSale = p.promoPrice != null && p.regularPrice != null;
  const noPrice = p.regularPrice == null && p.promoPrice == null;
  const unit = unitPrice(p);
  const meta = [p.brand, p.size].filter(Boolean).join(' · ');
  const priceText = noPrice
    ? state.store
      ? 'No price at your store'
      : 'Pick a store to see price'
    : onSale
    ? `SALE ${money(unit)} (reg ${money(p.regularPrice)})`
    : money(unit);

  els.confirmBody.innerHTML = `
    ${
      p.imageUrl
        ? `<img src="${p.imageUrl}" alt="" />`
        : `<div class="noimg">🛒</div>`
    }
    <div class="confirm-info">
      <div class="confirm-name">${escapeHtml(p.description)}</div>
      ${meta ? `<div class="confirm-meta">${escapeHtml(meta)}</div>` : ''}
      <div class="confirm-price">${priceText}</div>
      <div class="confirm-upc">UPC ${escapeHtml(p.upc || '')}</div>
    </div>
  `;
  els.confirmModal.classList.remove('hidden');
}

function closeConfirm(resumeScanning) {
  els.confirmModal.classList.add('hidden');
  awaitingConfirm = false;
  pendingProduct = null;
  recentReads = {};
  if (resumeScanning && scanner) {
    try {
      scanner.resume();
    } catch (_) {}
  }
}

// ---- Barcode scanner -------------------------------------------------------
let scanner = null;
let lastScan = { code: null, at: 0 };
// Tracks how many times each code has been read recently. We only trust a code
// after it's decoded the same way twice, which filters out blurry misreads.
let recentReads = {};

const CAMERA_ID_KEY = 'krogerbuddy.cameraId';
let currentCameraId = null;

const scanConfig = {
  fps: 15,
  // Wide, short scan window sized to the viewport — matches a barcode's shape.
  qrbox: (vw) => {
    const w = Math.min(Math.round(vw * 0.85), 340);
    return { width: w, height: Math.round(w * 0.5) };
  },
  // Only retail barcode symbologies — dropping CODE_128 avoids false hits.
  formatsToSupport: [
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
  ],
  // Use the device's native, hardware-accelerated detector when present.
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
};

function showCameraError(err) {
  const e = err || {};
  const name = e.name ? ` (${e.name})` : '';
  const permission = e.name === 'NotAllowedError' || e.name === 'SecurityError';
  const busy = e.name === 'NotReadableError' || e.name === 'TrackStartError';
  setStatus(
    permission
      ? `Camera permission is blocked${name}. Enable it for this site, or type the UPC manually.`
      : busy
      ? `The camera is in use by another app${name}. Close other camera apps and try again.`
      : `Could not open the camera${name}. Type the UPC manually, or try again.`,
    'error'
  );
}

// Pick which camera to open: a saved preference, else a back/rear lens, else
// the last camera (on multi-lens phones the main rear cam is often last).
function chooseCameraId(cameras) {
  if (!cameras || !cameras.length) return null;
  const saved = localStorage.getItem(CAMERA_ID_KEY);
  if (saved && cameras.some((c) => c.id === saved)) return saved;
  const back = cameras.find((c) => /back|rear|environment/i.test(c.label || ''));
  return (back || cameras[cameras.length - 1]).id;
}

function populateCameraSelect(cameras) {
  if (!cameras || cameras.length < 2) {
    els.cameraSelect.classList.add('hidden');
    return;
  }
  els.cameraSelect.innerHTML = '';
  cameras.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label || `Camera ${i + 1}`;
    els.cameraSelect.appendChild(opt);
  });
  const chosen = chooseCameraId(cameras);
  if (chosen) els.cameraSelect.value = chosen;
  els.cameraSelect.classList.remove('hidden');
}

async function startWithCamera(target) {
  try {
    await scanner.start(target, scanConfig, onScanSuccess, () => {});
    if (typeof target === 'string') currentCameraId = target;
    return true;
  } catch (err) {
    // If a specific camera id failed, fall back to a generic rear camera.
    if (typeof target === 'string') {
      try {
        await scanner.start({ facingMode: 'environment' }, scanConfig, onScanSuccess, () => {});
        return true;
      } catch (err2) {
        err = err2;
      }
    }
    showCameraError(err);
    await stopScanner();
    return false;
  }
}

// Wire up the zoom slider from the live camera's capabilities. Zoom lets you
// hold the phone farther back (where it can focus) while the barcode still
// fills the frame — the key fix for close-up focus trouble.
async function setupZoom() {
  try {
    const caps = scanner.getRunningTrackCapabilities();
    if (caps && caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min || 1)) {
      const min = caps.zoom.min || 1;
      const max = caps.zoom.max;
      els.zoomRange.min = min;
      els.zoomRange.max = max;
      els.zoomRange.step = caps.zoom.step || 0.1;
      // Start a little zoomed in to help with close barcodes.
      const initial = Math.min(max, Math.max(min, 2));
      els.zoomRange.value = initial;
      await applyZoom(initial);
      els.zoomWrap.classList.remove('hidden');
    } else {
      els.zoomWrap.classList.add('hidden');
    }
  } catch (_) {
    els.zoomWrap.classList.add('hidden');
  }
}

async function applyZoom(z) {
  try {
    await scanner.applyVideoConstraints({ advanced: [{ zoom: Number(z) }] });
  } catch (_) {}
}

async function startScanner() {
  els.readerWrap.classList.remove('hidden');
  els.scanControls.classList.add('hidden');
  setStatus('Starting camera…', 'busy');

  scanner = new Html5Qrcode('reader');

  // Enumerate cameras (also prompts for permission on first use).
  let cameras = [];
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch (_) {}
  populateCameraSelect(cameras);

  const camId = chooseCameraId(cameras);
  const ok = await startWithCamera(camId || { facingMode: 'environment' });
  if (!ok) return; // error already shown

  setStatus('Fill the box with the barcode. Use zoom if it won’t focus.', 'busy');

  // Best-effort: continuous autofocus, then enable the zoom slider.
  try {
    await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch (_) {}
  await setupZoom();
}

// Validate the GTIN check digit for standard 12/13/14-digit barcodes. This
// rejects a large share of garbled reads before we ever hit the API. (Shorter
// codes like UPC-E/EAN-8 use different schemes, so we pass those through and
// rely on the double-read + confirm step instead.)
function isValidGtin(code) {
  if (!/^\d{6,14}$/.test(code)) return false;
  if (![12, 13, 14].includes(code.length)) return true;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function onScanSuccess(decodedText) {
  // Ignore frames while we're waiting on a lookup or the confirm dialog.
  if (awaitingConfirm || lookupInFlight) return;

  const code = decodedText.replace(/\D/g, '');
  if (!code || !isValidGtin(code)) return;

  const now = Date.now();
  // Don't immediately re-fire on the item we just handled.
  if (code === lastScan.code && now - lastScan.at < 3000) return;

  // Require two matching reads within 1.5s before trusting the result.
  const prev = recentReads[code];
  const count = prev && now - prev.at < 1500 ? prev.count + 1 : 1;
  recentReads[code] = { count, at: now };
  if (count < 2) return;

  lastScan = { code, at: now };
  recentReads = {};
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

els.confirmYes.addEventListener('click', () => {
  if (pendingProduct) {
    const p = pendingProduct;
    addProductToCart(p);
    setStatus(`Added "${p.description}".`, 'ok');
  }
  closeConfirm(true);
});
els.confirmNo.addEventListener('click', () => {
  // Let the same item be re-scanned right away after a rejection.
  lastScan = { code: null, at: 0 };
  setStatus('Skipped — scan again when ready.', '');
  closeConfirm(true);
});
els.confirmModal.addEventListener('click', (e) => {
  if (e.target === els.confirmModal) {
    lastScan = { code: null, at: 0 };
    closeConfirm(true);
  }
});

// Switch lenses on demand — lets you pick a macro/close-focus camera.
els.cameraSelect.addEventListener('change', async () => {
  const id = els.cameraSelect.value;
  localStorage.setItem(CAMERA_ID_KEY, id);
  if (!scanner) return;
  setStatus('Switching camera…', 'busy');
  try {
    await scanner.stop();
  } catch (_) {}
  els.zoomWrap.classList.add('hidden');
  const ok = await startWithCamera(id);
  if (ok) {
    setStatus('Fill the box with the barcode. Use zoom if it won’t focus.', 'busy');
    try {
      await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (_) {}
    await setupZoom();
  }
});

els.zoomRange.addEventListener('input', () => applyZoom(els.zoomRange.value));

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
