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
// Backfill settings for states saved before this feature existed.
if (!state.settings) state.settings = { avgThreshold: 250, avgAlerts: true };
if (typeof state.settings.avgThreshold !== 'number') state.settings.avgThreshold = 250;
if (typeof state.settings.avgAlerts !== 'boolean') state.settings.avgAlerts = true;

// ---- Debug panel -----------------------------------------------------------
// Turn on by visiting the site with ?debug=1. Logs scans + raw API responses
// on-screen with a Copy button, so issues can be reported precisely.
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLines = [];
function debugLog(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugLines.push(line);
  if (debugLines.length > 200) debugLines.shift();
  const out = document.getElementById('debugOut');
  if (out) {
    out.textContent = debugLines.join('\n');
    out.scrollTop = out.scrollHeight;
  }
  // Also mirror to the console for desktop debugging.
  if (window.console) console.log('[KrogerBuddy]', msg);
}

// ---- Persistence -----------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { cart: [], store: null, taxRate: 0, budget: null, settings: { avgThreshold: 250, avgAlerts: true } };
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

// ---- Saved trips -----------------------------------------------------------
// Completed shopping trips are archived under their own key so the data
// survives and is available for future features (history, reorder, etc.).
const TRIPS_KEY = 'krogerbuddy.trips';
function loadTrips() {
  try {
    const raw = localStorage.getItem(TRIPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}
function saveTrips(trips) {
  try {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  } catch (_) {}
}

// ---- Element refs ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  themeToggle: $('themeToggle'),
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
  budgetWrap: $('budgetWrap'),
  budgetModal: $('budgetModal'),
  budgetInput: $('budgetInput'),
  budgetSave: $('budgetSave'),
  budgetRemove: $('budgetRemove'),
  budgetClose: $('budgetClose'),
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
  finishTripBtn: $('finishTripBtn'),
  tripsBtn: $('tripsBtn'),
  tripCount: $('tripCount'),
  tripsModal: $('tripsModal'),
  tripsList: $('tripsList'),
  closeTripsBtn: $('closeTripsBtn'),
  exportTripsBtn: $('exportTripsBtn'),
  receiptFile: $('receiptFile'),
  scanReceiptBtn: $('scanReceiptBtn'),
  pickReceiptBtn: $('pickReceiptBtn'),
  receiptModal: $('receiptModal'),
  receiptClose: $('receiptClose'),
  rcStore: $('rcStore'),
  rcDate: $('rcDate'),
  rcItems: $('rcItems'),
  rcAddLine: $('rcAddLine'),
  rcSubtotal: $('rcSubtotal'),
  rcTaxRate: $('rcTaxRate'),
  rcTaxAmount: $('rcTaxAmount'),
  rcTotal: $('rcTotal'),
  rcCancel: $('rcCancel'),
  rcSave: $('rcSave'),
  breakdownBtn: $('breakdownBtn'),
  breakdownModal: $('breakdownModal'),
  breakdownTotal: $('breakdownTotal'),
  breakdownSub: $('breakdownSub'),
  breakdownList: $('breakdownList'),
  closeBreakdownBtn: $('closeBreakdownBtn'),
  reportsBtn: $('reportsBtn'),
  reportsModal: $('reportsModal'),
  reportsClose: $('reportsClose'),
  reportSummary: $('reportSummary'),
  reportPeriods: $('reportPeriods'),
  reportCategories: $('reportCategories'),
  reportAvgNote: $('reportAvgNote'),
  segWeek: $('segWeek'),
  segMonth: $('segMonth'),
  settingsBtn: $('settingsBtn'),
  settingsModal: $('settingsModal'),
  settingsClose: $('settingsClose'),
  settingsSave: $('settingsSave'),
  avgThresholdInput: $('avgThresholdInput'),
  avgAlertsToggle: $('avgAlertsToggle'),
  qualifyNote: $('qualifyNote'),
  addItemBtn: $('addItemBtn'),
  addModal: $('addModal'),
  addCards: $('addCards'),
  addOtherRow: $('addOtherRow'),
  addOtherSubmit: $('addOtherSubmit'),
  addName: $('addName'),
  addPrice: $('addPrice'),
  addQty: $('addQty'),
  addCategory: $('addCategory'),
  addTaxable: $('addTaxable'),
  addHint: $('addHint'),
  addCancel: $('addCancel'),
};

// ---- Helpers ---------------------------------------------------------------
const money = (n) => `$${(n || 0).toFixed(2)}`;
const unitPrice = (item) =>
  item.promoPrice != null ? item.promoPrice : item.regularPrice || 0;

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `status ${kind}`;
}

// ---- Icons -----------------------------------------------------------------
// Inline the sprite symbols into <svg data-ic> placeholders so currentColor and
// class-based styling resolve (works for both static and dynamically-built DOM).
const ICONS = {};
function buildIconMap() {
  document.querySelectorAll('#sprite symbol').forEach((s) => {
    ICONS[s.id] = s.innerHTML;
  });
}
function hydrateIcons(root) {
  (root || document).querySelectorAll('svg[data-ic]').forEach((svg) => {
    if (svg.firstChild) return;
    const k = svg.getAttribute('data-ic');
    if (ICONS[k]) svg.innerHTML = ICONS[k];
  });
}
const ic = (id, w) =>
  `<svg class="ico" data-ic="${id}" viewBox="0 0 24 24"${w ? ` style="width:${w}px;height:${w}px"` : ''}></svg>`;

// Department key -> sprite icon for cart thumbnails.
const DEPT_ICON = {
  meat: 'f-beef', produce: 'f-produce', dairy: 'f-cheese', bakery: 'f-bakery',
  deli: 'f-deli', frozen: 'i-bag', beverages: 'i-bag', snacks: 'i-bag',
  pantry: 'i-bag', household: 'i-bag', personal: 'i-bag', other: 'i-barcode',
};
function subIcon(name) {
  const m = { Chicken: 'f-chicken', Beef: 'f-beef', 'Ground Beef': 'f-ground', Pork: 'f-pork', Turkey: 'f-turkey', Seafood: 'f-fish', Shrimp: 'f-shrimp' };
  return m[name];
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
  // Store chip
  els.storeLabel.textContent = state.store ? state.store.name : 'Pick a store';
  els.storeBtn.classList.toggle('is-empty', !state.store);

  // Tax input reflects stored rate
  if (document.activeElement !== els.taxRate) {
    els.taxRate.value = state.taxRate;
  }

  // Cart list
  els.cartList.innerHTML = '';
  const count = state.cart.reduce((n, i) => n + i.qty, 0);
  els.itemCount.textContent = count;
  els.emptyHint.classList.toggle('hidden', state.cart.length > 0);

  for (const item of state.cart) {
    els.cartList.appendChild(renderItem(item, unitPrice(item) * item.qty));
  }
  hydrateIcons(els.cartList);

  const { subtotal, tax, total } = computeTotals();
  els.subtotal.textContent = money(subtotal);
  els.taxAmount.textContent = money(tax);
  els.total.textContent = money(total);
  els.finishTripBtn.disabled = state.cart.length === 0;

  checkAverageAlerts();
  renderBudget(total);
}

// ---- Budget ----------------------------------------------------------------
const BUDGET_WARN_PCT = 90; // warn once spending reaches this share of budget
const LEVEL_ORDER = { none: 0, ok: 1, warn: 2, over: 3 };
let lastBudgetOrder = null; // null until first render establishes a baseline

function budgetInfo(total) {
  const budget = Number(state.budget) || 0;
  if (!budget) return { budget: 0, spent: total, level: 'none' };
  const pct = (total / budget) * 100;
  const level = pct >= 100 ? 'over' : pct >= BUDGET_WARN_PCT ? 'warn' : 'ok';
  return { budget, spent: total, pct, level, remaining: budget - total };
}

function renderBudget(total) {
  const info = budgetInfo(total);
  if (info.level === 'none') {
    els.budgetWrap.className = 'budget-wrap';
    els.budgetWrap.innerHTML = `<button id="budgetSetBtn" class="btn-budget-set" type="button">${ic('i-tag', 16)} Set a trip budget</button>`;
  } else {
    const barPct = Math.min(100, Math.round(info.pct));
    const right =
      info.level === 'over'
        ? `Over by ${money(info.spent - info.budget)}`
        : `${money(info.remaining)} left`;

    // Marker for the user's average trip total (where they usually land).
    const avg = avgTripTotal();
    let marker = '';
    let avgFoot = '';
    if (avg > 0) {
      const mPct = Math.min(100, Math.max(0, (avg / info.budget) * 100));
      marker = `<span class="budget-avg-marker" style="left:${mPct}%"></span>`;
      avgFoot = ` · avg trip ${money(avg)}`;
    }

    els.budgetWrap.className = `budget-wrap budget ${info.level}`;
    els.budgetWrap.innerHTML = `
      <div class="budget-top"><span class="budget-lbl">Budget</span><span class="budget-state">${right}</span></div>
      <div class="budget-bar"><i style="width:${barPct}%"></i>${marker}</div>
      <div class="budget-foot">${money(info.spent)} of ${money(info.budget)} · ${Math.round(info.pct)}%${avgFoot}</div>
    `;
  }
  hydrateIcons(els.budgetWrap);
  maybeBudgetAlert(info);
}

// Average total of the user's qualifying trips (their typical trip spend).
function avgTripTotal() {
  const th = Number(state.settings.avgThreshold) || 0;
  let trips = loadTrips().filter((t) => (t.total || 0) >= th);
  if (!trips.length) trips = loadTrips(); // fall back to all trips if none qualify
  if (!trips.length) return 0;
  return trips.reduce((s, t) => s + (t.total || 0), 0) / trips.length;
}

function maybeBudgetAlert(info) {
  const order = LEVEL_ORDER[info.level];
  if (lastBudgetOrder === null) {
    // First render — set a baseline so we don't alert on initial load.
    lastBudgetOrder = order;
    return;
  }
  if (order > lastBudgetOrder) {
    if (info.level === 'over') {
      setStatus(`Over budget by ${money(info.spent - info.budget)} (${money(info.spent)} of ${money(info.budget)}).`, 'error');
      try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (_) {}
    } else if (info.level === 'warn') {
      setStatus(`Heads up — ${Math.round(info.pct)}% of your ${money(info.budget)} budget, ${money(info.remaining)} left.`, 'warn');
      try { navigator.vibrate && navigator.vibrate(80); } catch (_) {}
    }
  }
  lastBudgetOrder = order;
}

function openBudgetModal() {
  els.budgetInput.value = state.budget ? Number(state.budget).toFixed(2) : '';
  els.budgetRemove.classList.toggle('hidden', !state.budget);
  els.budgetModal.classList.remove('hidden');
  setTimeout(() => els.budgetInput.focus(), 50);
}
function closeBudgetModal() {
  els.budgetModal.classList.add('hidden');
}
function saveBudget() {
  const v = parseFloat(els.budgetInput.value);
  if (isNaN(v) || v <= 0) {
    els.budgetInput.focus();
    return;
  }
  state.budget = Math.round(v * 100) / 100;
  saveState();
  // Allow an immediate alert if already at/over the new budget.
  lastBudgetOrder = LEVEL_ORDER.ok;
  closeBudgetModal();
  render();
  setStatus(`Trip budget set to ${money(state.budget)}.`, 'ok');
}
function removeBudget() {
  state.budget = null;
  lastBudgetOrder = null;
  saveState();
  closeBudgetModal();
  render();
}

// Subtotal, tax (on the taxable portion), and grand total for the current cart.
function computeTotals() {
  let subtotal = 0;
  let taxableBase = 0;
  for (const item of state.cart) {
    const line = unitPrice(item) * item.qty;
    subtotal += line;
    if (item.taxable) taxableBase += line;
  }
  const rate = Number(state.taxRate) || 0;
  const tax = taxableBase * (rate / 100);
  return { subtotal, tax, total: subtotal + tax };
}

// ---- Categorization & spending breakdown -----------------------------------
// Each department maps from Kroger's category text (cat) and, as a fallback,
// keywords in the product name (kw). Sub-categories are derived from the name.
const DEPARTMENTS = [
  {
    key: 'produce', name: 'Produce', icon: '🥬',
    cat: ['produce'],
    kw: ['lettuce', 'banana', 'apple', 'tomato', 'onion', 'potato', 'berry', 'strawberr', 'blueberr', 'spinach', 'avocado', 'pepper', 'carrot', 'broccoli', 'grape', 'orange', 'lemon', 'lime', 'celery', 'cucumber', 'mushroom', 'kale', 'cilantro', 'garlic', 'melon', 'peach', 'pear', 'mango', 'salad', 'squash', 'zucchini', 'corn'],
    subs: [
      { name: 'Fruit', kw: ['banana', 'apple', 'berry', 'strawberr', 'blueberr', 'grape', 'orange', 'lemon', 'lime', 'melon', 'peach', 'pear', 'mango', 'avocado'] },
      { name: 'Vegetables', kw: [] },
    ],
  },
  {
    key: 'meat', name: 'Meat & Seafood', icon: '🥩',
    cat: ['meat', 'seafood'],
    kw: ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'steak', 'ground ', 'fish', 'salmon', 'shrimp', 'tuna', 'tilapia', 'crab', 'ham', 'ribs', 'poultry', 'seafood', 'cod'],
    subs: [
      { name: 'Chicken', kw: ['chicken', 'poultry'] },
      { name: 'Beef', kw: ['beef', 'steak', 'ground beef'] },
      { name: 'Pork', kw: ['pork', 'bacon', 'ham', 'sausage', 'ribs'] },
      { name: 'Turkey', kw: ['turkey'] },
      { name: 'Seafood', kw: ['fish', 'salmon', 'shrimp', 'tuna', 'tilapia', 'crab', 'seafood', 'cod'] },
      { name: 'Other meat', kw: [] },
    ],
  },
  {
    key: 'dairy', name: 'Dairy & Eggs', icon: '🥛',
    cat: ['dairy', 'egg'],
    kw: ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'cottage'],
    subs: [
      { name: 'Milk', kw: ['milk'] },
      { name: 'Cheese', kw: ['cheese'] },
      { name: 'Yogurt', kw: ['yogurt'] },
      { name: 'Eggs', kw: ['egg'] },
      { name: 'Butter & Cream', kw: ['butter', 'cream'] },
      { name: 'Other dairy', kw: [] },
    ],
  },
  { key: 'bakery', name: 'Bakery', icon: '🍞', cat: ['bakery', 'bread'], kw: ['bread', 'bagel', 'bun', 'roll', 'muffin', 'cake', 'donut', 'doughnut', 'tortilla', 'pastry', 'croissant', 'biscuit', 'pita'], subs: [] },
  { key: 'frozen', name: 'Frozen', icon: '🧊', cat: ['frozen'], kw: ['frozen', 'ice cream', 'popsicle'], subs: [] },
  { key: 'beverages', name: 'Beverages', icon: '🥤', cat: ['beverage', 'drink'], kw: ['soda', 'juice', 'water', 'coffee', ' tea', 'cola', 'lemonade', 'seltzer', 'beer', 'wine'], subs: [] },
  { key: 'snacks', name: 'Snacks', icon: '🍿', cat: ['snack', 'candy'], kw: ['chip', 'cracker', 'cookie', 'candy', 'popcorn', 'pretzel', 'nuts', 'granola'], subs: [] },
  { key: 'pantry', name: 'Pantry', icon: '🥫', cat: ['pantry', 'canned', 'pasta', 'grocery'], kw: ['pasta', 'rice', 'sauce', 'soup', 'cereal', ' oil', 'flour', 'sugar', 'beans', 'canned', 'ketchup', 'mustard', 'peanut butter', 'jelly', 'honey', 'broth', 'noodle'], subs: [] },
  { key: 'deli', name: 'Deli', icon: '🧀', cat: ['deli'], kw: ['deli', 'lunch meat', 'hummus'], subs: [] },
  { key: 'household', name: 'Household', icon: '🧻', cat: ['household', 'paper', 'cleaning'], kw: ['paper towel', 'toilet paper', 'detergent', 'dish soap', 'cleaner', 'trash bag', 'tissue', 'napkin', 'foil', 'bleach', 'sponge'], subs: [] },
  { key: 'personal', name: 'Personal Care', icon: '🧴', cat: ['health', 'beauty', 'personal'], kw: ['shampoo', 'conditioner', 'toothpaste', 'deodorant', 'lotion', 'razor', 'body wash', 'vitamin', 'bandage'], subs: [] },
];

function subFor(dept, desc) {
  if (!dept.subs.length) return dept.name;
  const hit = dept.subs.find((s) => s.kw.length && s.kw.some((k) => desc.includes(k)));
  return hit ? hit.name : (dept.subs.find((s) => !s.kw.length) || {}).name || dept.name;
}

function categorize(item) {
  const desc = (item.description || '').toLowerCase();

  // Custom/manual items carry an explicit department chosen by the user.
  if (item.deptKey) {
    if (item.deptKey === 'other') return { key: 'other', dept: 'Other', icon: '🛒', sub: 'Other' };
    const d = DEPARTMENTS.find((x) => x.key === item.deptKey);
    if (d) return { key: d.key, dept: d.name, icon: d.icon, sub: subFor(d, desc) };
  }

  const cats = (item.categories || []).map((c) => String(c).toLowerCase());
  let dept = DEPARTMENTS.find((d) => cats.some((c) => d.cat.some((t) => c.includes(t))));
  if (!dept) dept = DEPARTMENTS.find((d) => d.kw.some((k) => desc.includes(k)));
  if (!dept) return { key: 'other', dept: 'Other', icon: '🛒', sub: 'Other' };
  return { key: dept.key, dept: dept.name, icon: dept.icon, sub: subFor(dept, desc) };
}

// Group the current cart's spending by department and sub-category.
// Group a list of items by department/sub-category. lineOf(item) returns the
// item's line total (so cart items and saved-trip items can both be used).
function breakdownOf(items, lineOf) {
  const map = {};
  let total = 0;
  for (const item of items) {
    const line = lineOf(item);
    total += line;
    const c = categorize(item);
    if (!map[c.key]) map[c.key] = { key: c.key, name: c.dept, icon: c.icon, total: 0, subs: {} };
    map[c.key].total += line;
    map[c.key].subs[c.sub] = (map[c.key].subs[c.sub] || 0) + line;
  }
  const depts = Object.values(map).sort((a, b) => b.total - a.total);
  return { total, depts };
}

function computeBreakdown() {
  return breakdownOf(state.cart, (i) => unitPrice(i) * i.qty);
}

const BD_COLORS = ['#0a4b9c', '#1e8a52', '#e07a3c', '#7b5ea7', '#2aa7b5', '#b9780f', '#8a93a0'];

// Build the breakdown rows as an HTML string. Expansion is handled by a single
// delegated click listener, so this works for both the live cart and saved
// trips. `avgs` (optional) adds the "vs your average" indicator per category.
function breakdownRowsHtml(total, depts, avgs) {
  if (!depts.length || !total) {
    return '<div class="empty-hint">No priced items in this trip.</div>';
  }
  return depts
    .map((d, i) => {
      const color = BD_COLORS[i % BD_COLORS.length];
      const pct = Math.round((d.total / total) * 100);
      const subHtml = Object.entries(d.subs)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amt]) => `<div class="bd-sub-row"><span class="nm">${escapeHtml(name)}</span><span class="vl">${money(amt)}</span></div>`)
        .join('');

      let avgHtml = '';
      const avg = avgs && avgs.byKey[d.key];
      if (avg) {
        const ratio = d.total / avg;
        const apct = Math.round(ratio * 100);
        const lvl = ratio > 1 ? 'over' : ratio >= 0.9 ? 'warn' : 'ok';
        const note =
          lvl === 'over'
            ? `${money(d.total - avg)} over your ${money(avg)} average`
            : `${apct}% of your ${money(avg)} average`;
        avgHtml = `<div class="bd-avg ${lvl}"><div class="bd-avg-bar"><i style="width:${Math.min(100, apct)}%"></i></div><span class="bd-avg-note">${note}</span></div>`;
      }

      return `
        <div class="bd-cat">
          <div class="bd-cat-head">
            <span class="bd-swatch" style="background:${color}"></span>
            <span class="bd-cat-name">${escapeHtml(d.name)}</span>
            <span class="bd-cat-amt">${money(d.total)}</span><span class="bd-cat-pct">${pct}%</span>
            <svg class="ico bd-chev" data-ic="i-chev-right" viewBox="0 0 24 24" style="width:18px;height:18px"></svg>
          </div>
          <div class="bd-bar"><i style="width:${pct}%;background:${color}"></i></div>
          ${avgHtml}
          <div class="bd-sub">${subHtml}</div>
        </div>`;
    })
    .join('');
}

// Toggle a category open/closed wherever a breakdown appears (cart or trips).
document.addEventListener('click', (e) => {
  const head = e.target.closest('.bd-cat-head');
  if (head) head.parentElement.classList.toggle('open');
});

// Average spend per category across qualifying past trips (total >= threshold).
function categoryAverages() {
  const threshold = Number(state.settings.avgThreshold) || 0;
  const trips = loadTrips().filter((t) => (t.total || 0) >= threshold);
  if (!trips.length) return { count: 0, byKey: {}, threshold };
  const sums = {};
  for (const t of trips) {
    const per = {};
    for (const it of t.items || []) {
      const c = categorize(it);
      per[c.key] = (per[c.key] || 0) + (it.unitPrice || 0) * (it.qty || 1);
    }
    for (const k in per) sums[k] = (sums[k] || 0) + per[k];
  }
  const byKey = {};
  for (const k in sums) byKey[k] = sums[k] / trips.length;
  return { count: trips.length, byKey, threshold };
}

function renderBreakdown() {
  const { total, depts } = computeBreakdown();
  const avgs = categoryAverages();
  els.breakdownTotal.textContent = money(total);
  els.breakdownSub.textContent = avgs.count
    ? `Averages from ${avgs.count} trip${avgs.count > 1 ? 's' : ''} of ${money(avgs.threshold)}+`
    : 'Finish a few trips to start tracking your category averages.';
  els.breakdownList.innerHTML =
    !depts.length || !total
      ? '<div class="empty-hint">Add items (with prices) to see the breakdown.</div>'
      : breakdownRowsHtml(total, depts, avgs);
  hydrateIcons(els.breakdownList);
}

// Alert (once per crossing) when a category in the cart exceeds its average.
let overAvgAlerted = new Set();
function checkAverageAlerts() {
  if (!state.settings.avgAlerts) return;
  const avgs = categoryAverages();
  if (!avgs.count) return;
  const { depts } = computeBreakdown();
  const over = new Set();
  for (const d of depts) {
    const avg = avgs.byKey[d.key];
    if (avg && d.total > avg) {
      over.add(d.key);
      if (!overAvgAlerted.has(d.key)) {
        overAvgAlerted.add(d.key);
        setStatus(`${d.name}: ${money(d.total)} — over your usual ${money(avg)} (by ${money(d.total - avg)}).`, 'warn');
        try { navigator.vibrate && navigator.vibrate(70); } catch (_) {}
      }
    }
  }
  for (const k of [...overAvgAlerted]) if (!over.has(k)) overAvgAlerted.delete(k);
}
// Seed the "already over" set at load so we don't alert on a mid-trip refresh.
function primeAverageAlerts() {
  const avgs = categoryAverages();
  if (!avgs.count) return;
  for (const d of computeBreakdown().depts) {
    const avg = avgs.byKey[d.key];
    if (avg && d.total > avg) overAvgAlerted.add(d.key);
  }
}

// ---- Settings --------------------------------------------------------------
function openSettings() {
  els.avgThresholdInput.value = state.settings.avgThreshold ? Number(state.settings.avgThreshold).toFixed(2) : '';
  els.avgAlertsToggle.checked = !!state.settings.avgAlerts;
  updateQualifyNote();
  els.settingsModal.classList.remove('hidden');
}
function closeSettings() {
  els.settingsModal.classList.add('hidden');
}
function updateQualifyNote() {
  const th = parseFloat(els.avgThresholdInput.value) || 0;
  const trips = loadTrips();
  const n = trips.filter((t) => (t.total || 0) >= th).length;
  els.qualifyNote.textContent = trips.length
    ? `${n} of ${trips.length} saved trip${trips.length > 1 ? 's' : ''} count toward your averages (total ≥ ${money(th)}).`
    : 'No saved trips yet — averages build as you finish trips.';
}
function saveSettings() {
  const th = parseFloat(els.avgThresholdInput.value);
  state.settings.avgThreshold = isNaN(th) || th < 0 ? 0 : Math.round(th * 100) / 100;
  state.settings.avgAlerts = els.avgAlertsToggle.checked;
  saveState();
  overAvgAlerted = new Set();
  primeAverageAlerts();
  closeSettings();
  render();
  setStatus('Settings saved.', 'ok');
}

// ---- Reports ---------------------------------------------------------------
let reportMode = 'week';
const deptName = (key) => {
  const d = DEPARTMENTS.find((x) => x.key === key);
  return d ? d.name : key === 'other' ? 'Other' : key;
};

function reportStats() {
  const trips = loadTrips();
  const count = trips.length;
  const totalSpent = trips.reduce((s, t) => s + (t.total || 0), 0);
  const items = trips.reduce((s, t) => s + (t.itemCount || 0), 0);
  const now = new Date();
  const thisMonth = trips
    .filter((t) => {
      const d = new Date(t.savedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((s, t) => s + (t.total || 0), 0);
  return { count, totalSpent, avgTrip: count ? totalSpent / count : 0, thisMonth };
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday
  return x;
}

function spendByPeriod(mode) {
  const groups = new Map();
  for (const t of loadTrips()) {
    const d = new Date(t.savedAt);
    let key, label, sort;
    if (mode === 'week') {
      const s = startOfWeek(d);
      key = s.toISOString().slice(0, 10);
      label = s.toLocaleDateString([], { month: 'short', day: 'numeric' });
      sort = s.getTime();
    } else {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString([], { month: 'short', year: '2-digit' });
      sort = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    const g = groups.get(key) || { label, total: 0, sort };
    g.total += t.total || 0;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.sort - b.sort).slice(-8);
}

function barRows(rows) {
  if (!rows.length) return '<div class="empty-hint">Not enough data yet.</div>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map(
      (r) =>
        `<div class="rb-row"><span class="rb-label">${escapeHtml(r.label)}</span><div class="rb-track"><i style="width:${Math.round((r.value / max) * 100)}%"></i></div><span class="rb-val">${money(r.value)}</span></div>`
    )
    .join('');
}

function renderReports() {
  const trips = loadTrips();
  if (!trips.length) {
    els.reportSummary.innerHTML = '<div class="empty-hint">Finish a few trips to unlock reports.</div>';
    els.reportPeriods.innerHTML = '';
    els.reportCategories.innerHTML = '';
    els.reportAvgNote.textContent = '';
    return;
  }
  const st = reportStats();
  els.reportSummary.innerHTML = [
    ['Trips', String(st.count)],
    ['Total spent', money(st.totalSpent)],
    ['Avg / trip', money(st.avgTrip)],
    ['This month', money(st.thisMonth)],
  ]
    .map(([l, v]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`)
    .join('');

  const periods = spendByPeriod(reportMode).map((p) => ({ label: p.label, value: p.total }));
  els.reportPeriods.innerHTML = barRows(periods);

  const avgs = categoryAverages();
  els.reportAvgNote.textContent = avgs.count
    ? `Per trip across ${avgs.count} trip${avgs.count > 1 ? 's' : ''} of ${money(avgs.threshold)}+`
    : `No trips of ${money(avgs.threshold)}+ yet — lower the threshold in Settings to include smaller trips.`;
  const catRows = Object.entries(avgs.byKey)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: deptName(k), value: v }));
  els.reportCategories.innerHTML = avgs.count ? barRows(catRows) : '';
}

function setReportMode(mode) {
  reportMode = mode;
  els.segWeek.classList.toggle('is-active', mode === 'week');
  els.segMonth.classList.toggle('is-active', mode === 'month');
  renderReports();
}
function openReports() {
  renderReports();
  els.reportsModal.classList.remove('hidden');
}
function closeReports() {
  els.reportsModal.classList.add('hidden');
}

function openBreakdownModal() {
  renderBreakdown();
  els.breakdownModal.classList.remove('hidden');
}
function closeBreakdownModal() {
  els.breakdownModal.classList.add('hidden');
}

// ---- Add custom item (store-weighed meat/deli/produce, or non-scannables) --
// Store-weighted barcodes are UPC-A starting with number-system digit 2 (the
// scanner may report the EAN-13 form "02..."). These aren't in Kroger's
// catalog, so we add them by hand.
function isStoreWeighted(code) {
  if (code.length === 12) return code[0] === '2';
  if (code.length === 13) return code.startsWith('02') || code[0] === '2';
  return false;
}

// Kroger weight/price-embedded barcodes encode the price (in cents) as the 4
// digits just before the final check digit, e.g.
//   2 12433 0 [3923] 0  -> $39.23   (beef tri-tip)
//   ...        [0662] 2 -> $6.62    (chicken)
// Returns the encoded price in dollars, or null if it can't be read.
function extractStorePrice(code) {
  const d = (code || '').replace(/\D/g, '');
  if (!isStoreWeighted(d) || (d.length !== 12 && d.length !== 13)) return null;
  const cents = parseInt(d.slice(d.length - 5, d.length - 1), 10);
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100000) return null;
  return cents / 100;
}

// Tappable common-item cards shown in the quick-add modal. Each sets the item
// name and its department (so it flows into the breakdown). "Other" reveals a
// free-text box.
const QUICK_ITEMS = [
  { label: 'Beef', icon: 'f-beef', deptKey: 'meat' },
  { label: 'Ground Beef', icon: 'f-ground', deptKey: 'meat' },
  { label: 'Steak', icon: 'f-beef', deptKey: 'meat' },
  { label: 'Chicken', icon: 'f-chicken', deptKey: 'meat' },
  { label: 'Pork', icon: 'f-pork', deptKey: 'meat' },
  { label: 'Turkey', icon: 'f-turkey', deptKey: 'meat' },
  { label: 'Seafood', icon: 'f-fish', deptKey: 'meat' },
  { label: 'Shrimp', icon: 'f-shrimp', deptKey: 'meat' },
  { label: 'Deli Meat', icon: 'f-deli', deptKey: 'deli' },
  { label: 'Deli Cheese', icon: 'f-cheese', deptKey: 'deli' },
  { label: 'Bakery', icon: 'f-bakery', deptKey: 'bakery' },
  { label: 'Produce', icon: 'f-produce', deptKey: 'produce' },
  { label: 'Other…', icon: 'f-other', other: true },
];

function populateAddCategory() {
  els.addCategory.innerHTML = '';
  for (const d of DEPARTMENTS) {
    const opt = document.createElement('option');
    opt.value = d.key;
    opt.textContent = `${d.icon} ${d.name}`;
    els.addCategory.appendChild(opt);
  }
  const other = document.createElement('option');
  other.value = 'other';
  other.textContent = '🛒 Other';
  els.addCategory.appendChild(other);
}

function renderAddCards() {
  els.addCards.innerHTML = '';
  for (const it of QUICK_ITEMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qa-card' + (it.other ? ' qa-other' : '');
    b.innerHTML = `<span class="ico-chip">${ic(it.icon)}</span><span class="qa-label">${escapeHtml(it.label)}</span>`;
    b.addEventListener('click', () => onCardTap(it));
    els.addCards.appendChild(b);
  }
  hydrateIcons(els.addCards);
}

const getAddQty = () => Math.max(1, parseInt(els.addQty.value, 10) || 1);

function readAddPrice() {
  const price = parseFloat(els.addPrice.value);
  if (isNaN(price) || price < 0) {
    els.addHint.textContent = 'Enter the price first (it’s on the item’s sticker).';
    els.addPrice.focus();
    return null;
  }
  return price;
}

function onCardTap(item) {
  if (item.other) {
    els.addOtherRow.classList.add('open');
    setTimeout(() => els.addName.focus(), 30);
    return;
  }
  const price = readAddPrice();
  if (price == null) return;
  addCustomItem({ name: item.label, price, qty: getAddQty(), taxable: els.addTaxable.checked, deptKey: item.deptKey });
}

function addCustomItem({ name, price, qty, taxable, deptKey }) {
  state.cart.unshift({
    upc: `custom-${Date.now()}`,
    custom: true,
    description: name,
    brand: '',
    size: '',
    regularPrice: price,
    promoPrice: null,
    imageUrl: null,
    qty,
    taxable,
    deptKey: deptKey || 'other',
    categories: [],
  });
  saveState();
  render();
  closeQuickAdd();
  setStatus(`Added "${name}" — ${money(price)}.`, 'ok');
}

function submitOtherItem() {
  const name = els.addName.value.trim();
  if (!name) {
    els.addName.focus();
    return;
  }
  const price = readAddPrice();
  if (price == null) return;
  addCustomItem({ name, price, qty: getAddQty(), taxable: els.addTaxable.checked, deptKey: els.addCategory.value });
}

function openQuickAdd({ deptKey = '', storeWeighted = false, price = null } = {}) {
  addModalOpen = true;
  if (scanner) {
    try {
      scanner.pause(true);
    } catch (_) {}
  }
  els.addPrice.value = price != null ? price.toFixed(2) : '';
  els.addQty.value = '1';
  els.addTaxable.checked = false;
  els.addName.value = '';
  els.addCategory.value = deptKey || 'other';
  els.addOtherRow.classList.remove('open');
  els.addHint.textContent = storeWeighted
    ? price != null
      ? `Read $${price.toFixed(2)} from the barcode (regular/total price — card or markdown prices may differ). Tap what it is:`
      : 'Store-weighed item. Enter the sticker price, then tap what it is:'
    : 'Enter the price, then tap what it is:';
  els.addModal.classList.remove('hidden');
  if (price == null) setTimeout(() => els.addPrice.focus(), 50);
}

function closeQuickAdd() {
  els.addModal.classList.add('hidden');
  addModalOpen = false;
  lastScan = { code: null, at: 0 };
  if (scanner) {
    try {
      scanner.resume();
    } catch (_) {}
  }
}

// ---- Finish & save a trip --------------------------------------------------
function finishTrip() {
  if (!state.cart.length) {
    setStatus('Cart is empty — nothing to save yet.', '');
    return;
  }
  const { subtotal, tax, total } = computeTotals();
  const itemCount = state.cart.reduce((n, i) => n + i.qty, 0);
  const trip = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    store: state.store ? { ...state.store } : null,
    taxRate: Number(state.taxRate) || 0,
    budget: state.budget || null,
    subtotal,
    tax,
    total,
    itemCount,
    items: state.cart.map((i) => ({
      upc: i.upc,
      description: i.description,
      brand: i.brand,
      size: i.size,
      qty: i.qty,
      regularPrice: i.regularPrice,
      promoPrice: i.promoPrice,
      unitPrice: unitPrice(i),
      taxable: i.taxable,
      deptKey: i.deptKey || null,
      categories: i.categories || [],
    })),
  };

  const trips = loadTrips();
  trips.unshift(trip);
  saveTrips(trips);

  // Start a fresh cart for the next trip, but keep the store and tax rate.
  state.cart = [];
  state.budget = null; // budgets are per-trip
  lastBudgetOrder = null;
  saveState();
  render();
  updateTripBadge();
  setStatus(`Trip saved — ${itemCount} items, ${money(total)}. Cart cleared for your next trip.`, 'ok');
}

function updateTripBadge() {
  const n = loadTrips().length;
  els.tripCount.textContent = n;
  els.tripsBtn.classList.toggle('hidden', n === 0);
}

function renderTrips() {
  const trips = loadTrips();
  els.tripCount.textContent = trips.length;
  els.exportTripsBtn.disabled = trips.length === 0;
  if (!trips.length) {
    els.tripsList.innerHTML = '<div class="empty-hint">No saved trips yet. Finish a trip after shopping, or scan a receipt below.</div>';
    return;
  }
  els.tripsList.innerHTML = '';
  for (const trip of trips) {
    const d = new Date(trip.savedAt);
    const mo = d.toLocaleString([], { month: 'short' });
    const dy = d.getDate();
    const storeName = trip.store ? trip.store.name : 'No store';
    const itemsHtml = trip.items
      .map((it) => `<div class="trip-line"><span class="nm"><b>${escapeHtml(it.description)}</b> ×${it.qty}</span><span class="vl">${money(it.unitPrice * it.qty)}</span></div>`)
      .join('');
    let budgetLine = '';
    if (trip.budget) {
      const over = trip.total > trip.budget;
      const diff = Math.abs(trip.budget - trip.total);
      budgetLine = `<div class="trip-line"><span class="nm">Budget ${money(trip.budget)}</span><span class="vl" style="color:var(--${over ? 'error' : 'success'})">${money(diff)} ${over ? 'over' : 'under'}</span></div>`;
    }
    const wrap = document.createElement('div');
    wrap.className = 'trip';
    const bd = breakdownOf(trip.items, (it) => (it.unitPrice || 0) * (it.qty || 1));
    const tripBdHtml = breakdownRowsHtml(bd.total, bd.depts);
    wrap.innerHTML = `
      <div class="trip-head">
        <span class="trip-cal"><span class="mo">${mo}</span><span class="dy">${dy}</span></span>
        <div class="trip-main"><div class="trip-store">${escapeHtml(storeName)}</div><div class="trip-meta">${trip.itemCount} items · ${trip.taxRate}% tax${trip.budget ? ` · ${money(trip.budget)} budget` : ''}</div></div>
        <span class="trip-total">${money(trip.total)}</span>
        <svg class="ico trip-chev" data-ic="i-chev-right" viewBox="0 0 24 24" style="width:18px;height:18px"></svg>
      </div>
      <div class="trip-body">
        ${itemsHtml}
        <div class="trip-line"><span class="nm">Tax (${trip.taxRate}%)</span><span class="vl">${money(trip.tax)}</span></div>
        ${budgetLine}
        <div class="trip-bd">
          <button type="button" class="trip-bd-toggle">${ic('i-pie', 16)} Category breakdown <svg class="ico trip-bd-chev" data-ic="i-chev-right" viewBox="0 0 24 24" style="width:16px;height:16px"></svg></button>
          <div class="trip-bd-body">${tripBdHtml}</div>
        </div>
        <div class="trip-actions"><button type="button" class="linkbtn danger" data-del="${trip.id}">${ic('i-trash', 16)}Delete trip</button></div>
      </div>
    `;
    wrap.querySelector('.trip-head').addEventListener('click', () => wrap.classList.toggle('open'));
    wrap.querySelector('.trip-bd-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      e.currentTarget.parentElement.classList.toggle('open');
    });
    wrap.querySelector('[data-del]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this saved trip?')) {
        saveTrips(loadTrips().filter((t) => t.id !== trip.id));
        updateTripBadge();
        renderTrips();
      }
    });
    els.tripsList.appendChild(wrap);
  }
  hydrateIcons(els.tripsList);
}

// Download all saved trips as JSON so the data is portable / future-proof.
function exportTrips() {
  const trips = loadTrips();
  if (!trips.length) return;
  const blob = new Blob([JSON.stringify(trips, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `krogerbuddy-trips-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openTripsModal() {
  renderTrips();
  els.tripsModal.classList.remove('hidden');
}
function closeTripsModal() {
  els.tripsModal.classList.add('hidden');
}

// ---- Receipt scanner -------------------------------------------------------
// Photograph a receipt -> OCR on-device (Tesseract.js) -> review/edit -> save
// as a past trip. Never touches state.cart.
let receiptDraft = { items: [], store: '', date: null };
let tesseractPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('init')));
    s.onerror = () => {
      tesseractPromise = null;
      reject(new Error('load'));
    };
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

// Decode the image (handles gallery photos/orientation/large files) and
// downscale to a sane size for faster, more reliable OCR. Falls back to the raw
// file if the browser can't decode it (e.g. HEIC on some platforms).
function prepareImage(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 2000;
        const scale = Math.min(1, max / Math.max(img.width, img.height) || 1);
        const cw = Math.max(1, Math.round(img.width * scale));
        const ch = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        // Grayscale + contrast-stretch so faint thermal text reads better.
        try {
          const d = ctx.getImageData(0, 0, cw, ch);
          const px = d.data;
          let min = 255;
          let max = 0;
          for (let i = 0; i < px.length; i += 4) {
            const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
            px[i] = px[i + 1] = px[i + 2] = g;
            if (g < min) min = g;
            if (g > max) max = g;
          }
          const range = Math.max(1, max - min);
          for (let i = 0; i < px.length; i += 4) {
            const v = Math.min(255, Math.max(0, ((px[i] - min) * 255) / range));
            px[i] = px[i + 1] = px[i + 2] = v;
          }
          ctx.putImageData(d, 0, 0);
        } catch (_) {}
        c.toBlob((blob) => resolve(blob || file), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    } catch (_) {
      resolve(file);
    }
  });
}

let ocrWorker = null;
async function getOcrWorker(Tesseract) {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        setStatus(`Reading your receipt… ${Math.round(m.progress * 100)}%`, 'busy');
      }
    },
  });
  // PSM 4 = a single column of text of variable sizes — best for receipts.
  await ocrWorker.setParameters({ tessedit_pageseg_mode: '4' });
  return ocrWorker;
}

async function runReceiptOcr(file) {
  setStatus('Loading receipt scanner…', 'busy');
  let Tesseract;
  try {
    Tesseract = await loadTesseract();
  } catch (_) {
    setStatus('Couldn’t load the receipt scanner. Check your connection and try again.', 'error');
    return;
  }
  setStatus('Reading your receipt…', 'busy');
  try {
    const input = await prepareImage(file);
    const worker = await getOcrWorker(Tesseract);
    const { data } = await worker.recognize(input);
    const text = data && data.text ? data.text : '';
    const parsed = parseReceiptText(text);
    if (DEBUG) {
      debugLog(`receipt OCR: ${text.length} chars, ${parsed.items.length} items, store=${parsed.store || '?'}\n--- raw ---\n${text.slice(0, 1200)}`);
    }
    if (!parsed.items.length) {
      setStatus('Couldn’t read this receipt. Tip: fill the frame with just the receipt, lay it flat in good light. Or add items below.', 'warn');
    } else {
      setStatus('', '');
    }
    openReceiptModal(parsed);
  } catch (_) {
    setStatus('Couldn’t read that photo. Try again with a flatter, well-lit shot.', 'error');
  }
}

// Pure parser: extract items, totals, and date from OCR text. Imperfect by
// design — the review step is the safety net.
function parseReceiptText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const SKIP =
    /\b(sub\s*total|total|tax|balance|change|cash\b|cashback|credit|debit|visa|master|amex|discover|tend|tender|payment|purchase|savings|saved|coupon|loyalty|points|fuel|reward|account|ref|auth|approval|aid|verified|pin|member|customer|plus|cashier|register|store\s*#|thank|welcome|qty|count|items?\s+sold|sold|order|return|gas|pump|feedback)\b/i;
  // Trailing money: optional $/S, dot or comma decimal, optional 1-2 letter flag.
  const PRICE_RE = /(-?[\$S]?\d{1,4}[.,]\d{2})\s*[A-Za-z]{0,2}\s*$/;
  const toAmount = (s) => parseFloat(String(s).replace(/[\$S]/, '').replace(',', '.'));
  const cleanDesc = (s) =>
    s
      .replace(/\s{2,}/g, ' ')
      .replace(/^\d{6,}\s*/, '')
      .replace(/^\d+\s+(?=[A-Za-z])/, '')
      .replace(/[^A-Za-z0-9%&'./ +-]/g, '')
      .trim();

  // --- Store guess (banner + city) ---
  const BANNERS = /\b(kroger|ralphs|fred\s*meyer|king\s*soopers|fry'?s|smith'?s|dillons|qfc|harris\s*teeter|mariano'?s|pick\s*'?n\s*save|metro\s*market|baker'?s|gerbes|pay\s*less|owen'?s|jay\s*c|food\s*4\s*less|foods\s*co)\b/i;
  const titleCase = (s) =>
    s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  let banner = null;
  let city = null;
  for (const line of lines.slice(0, 14)) {
    if (!banner) {
      const bm = line.match(BANNERS);
      if (bm) banner = /qfc/i.test(bm[1]) ? 'QFC' : titleCase(bm[1].replace(/\s+/g, ' ').trim());
    }
    if (!city) {
      const cm = line.match(/([A-Za-z][A-Za-z .'\-]{2,}),?\s+[A-Z]{2}\s+\d{5}/);
      if (cm) city = titleCase(cm[1].trim());
    }
  }
  let store = banner || null;
  if (banner && city) store = `${banner} — ${city}`;
  else if (!banner && city) store = city;

  const items = [];
  let subtotal = null;
  let tax = null;
  let total = null;
  let date = null;

  let pendingDesc = ''; // a text line whose price may be on the NEXT line
  for (const line of lines) {
    if (!date) {
      const dm = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
      if (dm) {
        let yr = dm[3].length === 2 ? '20' + dm[3] : dm[3];
        const d = new Date(Number(yr), Number(dm[1]) - 1, Number(dm[2]));
        if (!isNaN(d) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) date = d.toISOString();
      }
    }

    const pm = line.match(PRICE_RE);
    if (!pm) {
      // No price: remember it as a possible description for a price-only line.
      pendingDesc = !SKIP.test(line) && /[A-Za-z]{3,}/.test(line) ? cleanDesc(line) : '';
      continue;
    }
    const amount = toAmount(pm[1]);
    if (isNaN(amount)) { pendingDesc = ''; continue; }

    const lower = line.toLowerCase();
    if (/\bsub\s*total\b/.test(lower)) { subtotal = amount; pendingDesc = ''; continue; }
    if (/\btax\b/.test(lower)) { tax = (tax || 0) + amount; pendingDesc = ''; continue; }
    if (/\b(grand\s*)?total\b/.test(lower) && !/sub/.test(lower)) { total = amount; pendingDesc = ''; continue; }

    if (SKIP.test(line) || amount <= 0 || amount > 999) { pendingDesc = ''; continue; }

    let desc = cleanDesc(line.replace(PRICE_RE, ''));
    if (!/[A-Za-z]{3,}/.test(desc)) desc = pendingDesc; // borrow split-line description
    pendingDesc = '';
    if (!/[A-Za-z]{3,}/.test(desc)) continue;

    const taxable = /\s[TF]\s*$/i.test(line) ? /\sT\s*$/i.test(line) : true;
    items.push({ description: desc, price: amount, qty: 1, taxable, deptKey: categorize({ description: desc }).key });
  }

  return { items, subtotal, tax, total, date, store };
}

function deptOptions(selectedKey) {
  const opts = DEPARTMENTS.map(
    (d) => `<option value="${d.key}"${d.key === selectedKey ? ' selected' : ''}>${d.icon} ${escapeHtml(d.name)}</option>`
  );
  opts.push(`<option value="other"${selectedKey === 'other' || !selectedKey ? ' selected' : ''}>🛒 Other</option>`);
  return opts.join('');
}

function openReceiptModal(parsed) {
  receiptDraft.items = (parsed.items || []).map((it) => ({ ...it }));
  receiptDraft.store = parsed.store || (state.store ? state.store.name : '');
  receiptDraft.date = parsed.date || new Date().toISOString();
  let rate = Number(state.taxRate) || 0;
  if (parsed.tax != null && parsed.subtotal && parsed.subtotal > 0) {
    const derived = Math.round((parsed.tax / parsed.subtotal) * 100 * 100) / 100;
    if (derived > 0 && derived <= 15) rate = derived;
  }
  els.rcStore.value = receiptDraft.store;
  els.rcDate.value = receiptDraft.date.slice(0, 10);
  els.rcTaxRate.value = rate;
  renderReceiptItems();
  els.receiptModal.classList.remove('hidden');
}
function closeReceiptModal() {
  els.receiptModal.classList.add('hidden');
}

function renderReceiptItems() {
  els.rcItems.innerHTML = receiptDraft.items
    .map(
      (it, i) => `
      <div class="rc-row" data-i="${i}">
        <input class="input rc-desc" data-i="${i}" value="${escapeHtml(it.description)}" placeholder="Item name" />
        <div class="rc-row2">
          <div class="qa-price"><span class="qa-cur">$</span><input class="input rc-price" data-i="${i}" inputmode="decimal" value="${(Number(it.price) || 0).toFixed(2)}" /></div>
          <div class="stepper rc-qty" data-i="${i}">
            <button type="button" data-act="dec" aria-label="Decrease">${ic('i-minus', 16)}</button>
            <span class="qty">${it.qty}</span>
            <button type="button" data-act="inc" aria-label="Increase">${ic('i-plus', 16)}</button>
          </div>
          <select class="select rc-cat" data-i="${i}">${deptOptions(it.deptKey)}</select>
          <label class="switch rc-tax-toggle"><input type="checkbox" class="rc-tax" data-i="${i}" ${it.taxable ? 'checked' : ''} /><span class="track"></span></label>
          <button type="button" class="remove-btn rc-del" data-i="${i}" aria-label="Remove">${ic('i-trash', 16)}</button>
        </div>
      </div>`
    )
    .join('');
  if (!receiptDraft.items.length) {
    els.rcItems.innerHTML = '<div class="empty-hint">No items yet — tap “Add a line” to enter them.</div>';
  }
  hydrateIcons(els.rcItems);
  recomputeReceiptTotals();
}

function recomputeReceiptTotals() {
  let subtotal = 0;
  let taxable = 0;
  for (const it of receiptDraft.items) {
    const line = (Number(it.price) || 0) * (it.qty || 1);
    subtotal += line;
    if (it.taxable) taxable += line;
  }
  const rate = Number(els.rcTaxRate.value) || 0;
  const tax = taxable * (rate / 100);
  els.rcSubtotal.textContent = money(subtotal);
  els.rcTaxAmount.textContent = money(tax);
  els.rcTotal.textContent = money(subtotal + tax);
  return { subtotal, tax, total: subtotal + tax };
}

function addReceiptLine() {
  receiptDraft.items.push({ description: '', price: 0, qty: 1, taxable: true, deptKey: 'other' });
  renderReceiptItems();
  const inputs = els.rcItems.querySelectorAll('.rc-desc');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function saveReceiptAsTrip() {
  const items = receiptDraft.items.filter((it) => it.description.trim() && (Number(it.price) || 0) >= 0);
  if (!items.length) {
    setStatus('Add at least one item before saving.', 'warn');
    return;
  }
  const { subtotal, tax, total } = recomputeReceiptTotals();
  const rate = Number(els.rcTaxRate.value) || 0;
  const itemCount = items.reduce((n, it) => n + (it.qty || 1), 0);

  let savedAt = new Date().toISOString();
  if (els.rcDate.value) {
    const d = new Date(els.rcDate.value + 'T12:00:00');
    if (!isNaN(d)) savedAt = d.toISOString();
  }

  const storeName = els.rcStore.value.trim();
  const store = storeName
    ? { locationId: state.store && state.store.name === storeName ? state.store.locationId : null, name: storeName }
    : state.store
    ? { ...state.store }
    : null;

  const id = Date.now();
  const trip = {
    id,
    savedAt,
    store,
    taxRate: rate,
    budget: null,
    subtotal,
    tax,
    total,
    itemCount,
    items: items.map((it, idx) => ({
      upc: `receipt-${id}-${idx}`,
      description: it.description.trim(),
      brand: '',
      size: '',
      qty: it.qty || 1,
      regularPrice: Number(it.price) || 0,
      promoPrice: null,
      unitPrice: Number(it.price) || 0,
      taxable: !!it.taxable,
      deptKey: it.deptKey || null,
      categories: [],
    })),
  };

  saveTrips([trip, ...loadTrips()]);
  updateTripBadge();
  renderTrips();
  closeReceiptModal();
  setStatus(`Receipt saved — ${itemCount} items, ${money(total)}.`, 'ok');
}

function renderItem(item, line) {
  const li = document.createElement('li');
  li.className = 'cart-item';

  const unit = unitPrice(item);
  const onSale = item.promoPrice != null && item.regularPrice != null;
  const noPrice = item.regularPrice == null && item.promoPrice == null;

  const cat = categorize(item);
  const thumbIcon = subIcon(cat.sub) || DEPT_ICON[cat.key] || 'i-barcode';
  const thumb = item.imageUrl
    ? `<div class="ci-thumb"><img src="${item.imageUrl}" alt="" loading="lazy" /></div>`
    : `<div class="ci-thumb">${ic(thumbIcon)}</div>`;

  const metaBits = [];
  if (item.brand) metaBits.push(escapeHtml(item.brand));
  if (item.size) metaBits.push(escapeHtml(item.size));
  if (!noPrice) metaBits.push(`${money(unit)} / ea`);
  else metaBits.push(state.store ? 'no price' : 'pick a store');
  const meta = metaBits.join('<span class="dot">·</span>');
  const saleTag = onSale ? `<span class="sale-tag">${ic('i-tag', 11)}SALE</span>` : '';

  const total = onSale
    ? `<span class="ci-sale-old">${money(item.regularPrice * item.qty)}</span>${money(line)}`
    : money(line);

  li.innerHTML = `
    ${thumb}
    <div class="ci-info">
      <div class="ci-name">${escapeHtml(item.description)}</div>
      <div class="ci-meta">${meta}</div>
      ${saleTag}
    </div>
    <div class="ci-total">${total}</div>
    <div class="ci-ctrl">
      <div class="stepper">
        <button type="button" data-act="dec" aria-label="Decrease">${ic('i-minus')}</button>
        <span class="qty">${item.qty}</span>
        <button type="button" data-act="inc" aria-label="Increase">${ic('i-plus')}</button>
      </div>
      <label class="switch tax-toggle"><input type="checkbox" data-act="tax" ${item.taxable ? 'checked' : ''} /><span class="track"></span><span class="switch-label">Tax</span></label>
      <button type="button" class="remove-btn" data-act="remove" aria-label="Remove">${ic('i-trash')}</button>
    </div>
  `;

  li.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').getAttribute('data-act');
    if (act === 'inc') changeQty(item.upc, 1);
    else if (act === 'dec') changeQty(item.upc, -1);
    else if (act === 'remove') removeItem(item.upc);
  });
  li.querySelector('[data-act="tax"]').addEventListener('change', () => toggleTaxable(item.upc));

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
  const loc = state.store ? state.store.locationId : '';
  const params = loc ? `?locationId=${encodeURIComponent(loc)}` : '';
  const url = `${API_BASE}/api/product/${encodeURIComponent(upc)}${params}`;
  try {
    debugLog(`lookup upc=${upc} store=${loc || 'none'}\nGET ${url}`);
    const res = await fetch(url);
    const data = await res.json();
    debugLog(`status ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
    if (DEBUG) await dumpDebugEndpoint(upc, loc);
    if (res.status === 404) {
      // Not in Kroger's catalog — likely a store item; offer manual entry.
      setStatus('Not in Kroger’s catalog — add it manually below.', 'error');
      openQuickAdd({});
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    beep();
    // Don't add anything yet — let the shopper confirm it's the right item.
    showConfirm(data.product);
    setStatus('');
  } catch (err) {
    setStatus(err.message, 'error');
    debugLog(`ERROR ${err.message}`);
  } finally {
    lookupInFlight = false;
  }
}

// In debug mode, also pull the raw Kroger results so we can see exactly what
// the API returns for each UPC variant.
async function dumpDebugEndpoint(upc, loc) {
  try {
    const u = `${API_BASE}/api/debug/${encodeURIComponent(upc)}${loc ? `?locationId=${encodeURIComponent(loc)}` : ''}`;
    const res = await fetch(u);
    const data = await res.json();
    debugLog(`DEBUG ${u}\n${JSON.stringify(data, null, 1)}`);
  } catch (err) {
    debugLog(`DEBUG fetch failed: ${err.message}`);
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
let addModalOpen = false;

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
  const priceHtml = noPrice
    ? `<div class="confirm-price" style="font-size:var(--fs-base);color:var(--text-3)">${state.store ? 'No price at your store' : 'Pick a store to see price'}</div>`
    : onSale
    ? `<div class="confirm-price sale">${money(unit)} <s>${money(p.regularPrice)}</s></div>`
    : `<div class="confirm-price">${money(unit)}</div>`;

  const img = p.imageUrl
    ? `<div class="confirm-img"><img src="${p.imageUrl}" alt="" /></div>`
    : `<div class="confirm-img">${ic('i-barcode')}</div>`;

  els.confirmBody.innerHTML = `
    ${img}
    <div>
      <div class="confirm-name">${escapeHtml(p.description)}</div>
      ${meta ? `<div class="confirm-meta">${escapeHtml(meta)}</div>` : ''}
      ${priceHtml}
      <span class="upc-pill">${ic('i-barcode')}${escapeHtml(p.upc || '')}</span>
    </div>
  `;
  hydrateIcons(els.confirmBody);
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
  // Wide, short scan window matching a barcode's shape — sized to fit the
  // compact camera viewport without dominating the screen.
  qrbox: (vw) => {
    const w = Math.min(Math.round(vw * 0.8), 300);
    const h = Math.min(Math.round(w * 0.42), 120);
    return { width: w, height: h };
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
  // Pick the MAIN rear lens (the one that focuses up close) — avoid the
  // ultrawide/telephoto/depth/macro lenses which often can't focus on barcodes.
  const backs = cameras.filter((c) => /back|rear|environment/i.test(c.label || ''));
  const main = backs.find((c) => !/ultra|wide|tele|depth|macro|mono/i.test(c.label || ''));
  return (main || backs[0] || cameras[cameras.length - 1]).id;
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

  // Enumerate cameras (also prompts for permission on first use).
  let cameras = [];
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch (_) {}
  populateCameraSelect(cameras);

  // Try the main rear camera (facingMode=environment, focuses up close) first,
  // then a specific rear deviceId. Recreate the scanner between attempts so a
  // rejected constraint doesn't leave it in a broken state.
  const targets = [{ facingMode: 'environment' }];
  const camId = chooseCameraId(cameras);
  if (camId) targets.push(camId);

  let ok = false;
  let lastErr = null;
  for (const t of targets) {
    try {
      scanner = new Html5Qrcode('reader');
      await scanner.start(t, scanConfig, onScanSuccess, () => {});
      if (typeof t === 'string') currentCameraId = t;
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      try { await scanner.clear(); } catch (_) {}
      scanner = null;
    }
  }
  if (!ok) {
    showCameraError(lastErr || {});
    els.readerWrap.classList.add('hidden');
    els.scanControls.classList.remove('hidden');
    return;
  }

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

let lastRawLogged = '';
function onScanSuccess(decodedText) {
  // Ignore frames while we're waiting on a lookup or a dialog is open.
  if (awaitingConfirm || addModalOpen || lookupInFlight) return;

  const code = decodedText.replace(/\D/g, '');
  // Log distinct raw decodes so we can see exactly what the scanner reads.
  if (DEBUG && decodedText !== lastRawLogged) {
    lastRawLogged = decodedText;
    debugLog(`decoded raw="${decodedText}" digits="${code}" len=${code.length} validGtin=${isValidGtin(code)}`);
  }
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

  // Store-weighed items (leading "2") aren't in Kroger's catalog — go straight
  // to manual entry instead of a guaranteed-failed lookup.
  if (isStoreWeighted(code)) {
    beep();
    const price = extractStorePrice(code);
    if (DEBUG) debugLog(`store-weighted ${code} -> price ${price != null ? '$' + price.toFixed(2) : 'n/a'}`);
    openQuickAdd({ deptKey: 'meat', storeWeighted: true, price });
    return;
  }
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
    li.className = 'store-row';
    if (state.store && state.store.locationId === loc.locationId) li.classList.add('is-active');
    const addr = loc.address
      ? `${loc.address.addressLine1 || ''}, ${loc.address.city || ''} ${loc.address.state || ''}`.trim()
      : '';
    li.innerHTML = `
      <span class="store-radio"></span>
      <div><div class="store-name">${escapeHtml(loc.name)}</div><div class="store-addr">${escapeHtml(addr)}</div></div>
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

els.budgetWrap.addEventListener('click', openBudgetModal);
els.budgetSave.addEventListener('click', saveBudget);
els.budgetRemove.addEventListener('click', removeBudget);
els.budgetClose.addEventListener('click', closeBudgetModal);
els.budgetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveBudget();
  }
});
els.budgetModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeBudgetModal();
});

els.storeBtn.addEventListener('click', openStoreModal);
els.closeStoreBtn.addEventListener('click', closeStoreModal);
els.storeModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeStoreModal();
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
  if (e.target.classList.contains('scrim')) {
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

els.breakdownBtn.addEventListener('click', openBreakdownModal);
els.closeBreakdownBtn.addEventListener('click', closeBreakdownModal);
els.breakdownModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeBreakdownModal();
});

els.reportsBtn.addEventListener('click', openReports);
els.reportsClose.addEventListener('click', closeReports);
els.reportsModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeReports();
});
els.segWeek.addEventListener('click', () => setReportMode('week'));
els.segMonth.addEventListener('click', () => setReportMode('month'));

els.settingsBtn.addEventListener('click', openSettings);
els.settingsClose.addEventListener('click', closeSettings);
els.settingsSave.addEventListener('click', saveSettings);
els.avgThresholdInput.addEventListener('input', updateQualifyNote);
els.settingsModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeSettings();
});

els.addItemBtn.addEventListener('click', () => openQuickAdd({}));
els.addOtherSubmit.addEventListener('click', submitOtherItem);
els.addName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitOtherItem();
  }
});
els.addCancel.addEventListener('click', closeQuickAdd);
els.addModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeQuickAdd();
});

els.finishTripBtn.addEventListener('click', finishTrip);
els.tripsBtn.addEventListener('click', openTripsModal);
els.closeTripsBtn.addEventListener('click', closeTripsModal);
els.exportTripsBtn.addEventListener('click', exportTrips);
els.tripsModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeTripsModal();
});

// Receipt scanner wiring — "Scan receipt" forces the camera, "From photos"
// lets the user pick an existing image (both share one file input + handler).
els.scanReceiptBtn.addEventListener('click', () => {
  els.receiptFile.setAttribute('capture', 'environment');
  els.receiptFile.click();
});
els.pickReceiptBtn.addEventListener('click', () => {
  els.receiptFile.removeAttribute('capture');
  els.receiptFile.click();
});
els.receiptFile.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file
  if (f) runReceiptOcr(f);
});
els.receiptClose.addEventListener('click', closeReceiptModal);
els.rcCancel.addEventListener('click', closeReceiptModal);
els.rcSave.addEventListener('click', saveReceiptAsTrip);
els.rcAddLine.addEventListener('click', addReceiptLine);
els.rcTaxRate.addEventListener('input', recomputeReceiptTotals);
els.receiptModal.addEventListener('click', (e) => {
  if (e.target.classList.contains('scrim')) closeReceiptModal();
});
// Delegated edits within the receipt item list.
els.rcItems.addEventListener('input', (e) => {
  const t = e.target;
  const i = t.dataset.i;
  if (i == null) return;
  if (t.classList.contains('rc-desc')) receiptDraft.items[i].description = t.value;
  else if (t.classList.contains('rc-price')) {
    receiptDraft.items[i].price = parseFloat(t.value) || 0;
    recomputeReceiptTotals();
  }
});
els.rcItems.addEventListener('change', (e) => {
  const t = e.target;
  const i = t.dataset.i;
  if (i == null) return;
  if (t.classList.contains('rc-cat')) receiptDraft.items[i].deptKey = t.value;
  else if (t.classList.contains('rc-tax')) {
    receiptDraft.items[i].taxable = t.checked;
    recomputeReceiptTotals();
  }
});
els.rcItems.addEventListener('click', (e) => {
  const del = e.target.closest('.rc-del');
  if (del) {
    receiptDraft.items.splice(Number(del.dataset.i), 1);
    renderReceiptItems();
    return;
  }
  const step = e.target.closest('.rc-qty [data-act]');
  if (step) {
    const i = step.closest('.rc-qty').dataset.i;
    const item = receiptDraft.items[i];
    item.qty = Math.max(1, (item.qty || 1) + (step.dataset.act === 'inc' ? 1 : -1));
    step.closest('.rc-qty').querySelector('.qty').textContent = item.qty;
    recomputeReceiptTotals();
  }
});

// Theme toggle (initial theme already applied by the inline <head> script).
els.themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem('krogerbuddy.theme', next);
  } catch (_) {}
});

// ---- Init ------------------------------------------------------------------
buildIconMap();
populateAddCategory();
renderAddCards();
primeAverageAlerts();
render();
hydrateIcons(document);
updateTripBadge();

// Debug panel wiring (only when ?debug=1).
if (DEBUG) {
  const panel = document.getElementById('debugPanel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('debugCopy').addEventListener('click', async () => {
      const text = debugLines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        debugLog('(log copied to clipboard)');
      } catch (_) {
        // Fallback: select the text so it can be copied manually.
        const out = document.getElementById('debugOut');
        const range = document.createRange();
        range.selectNodeContents(out);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    document.getElementById('debugClear').addEventListener('click', () => {
      debugLines.length = 0;
      document.getElementById('debugOut').textContent = '';
    });
  }
  debugLog(`KrogerBuddy debug on. apiBase=${API_BASE || '(same origin)'} store=${state.store ? state.store.locationId : 'none'}`);
}

// On a static host (e.g. GitHub Pages) the app needs to know where its API
// proxy lives. Surface a clear hint instead of letting lookups silently fail.
if (!API_BASE && /github\.io$/.test(location.hostname)) {
  setStatus(
    'Almost there — set your Cloudflare Worker URL in config.js (or add ?api=<worker-url> to the link) so item lookups work.',
    'error'
  );
}

// ---- PWA: service worker + auto-update -------------------------------------
if ('serviceWorker' in navigator) {
  let updateReady = false;
  let refreshing = false;

  // When a newly-installed worker takes control, reload once to pick up the
  // new version. Guarded by updateReady so the first install doesn't reload.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateReady || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        // Re-check for a new version whenever the app returns to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // controller exists => this is an update, not the first install.
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              updateReady = true;
              setStatus('Updating to the latest version…', 'busy');
            }
          });
        });
      })
      .catch(() => {});
  });
}

// Show our own "Install" button when the browser says the app is installable.
let deferredInstallPrompt = null;
const installBtn = document.getElementById('installBtn');
const installBanner = document.getElementById('installBanner');
const bannerInstall = document.getElementById('bannerInstall');
const bannerClose = document.getElementById('bannerClose');
const ibSub = document.getElementById('ibSub');
const DISMISS_KEY = 'krogerbuddy.installDismissed';
const standalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const bannerDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
};

function showInstallBanner() {
  if (!installBanner || standalone || bannerDismissed()) return;
  // Slide in shortly after load so it reads as a deliberate prompt.
  setTimeout(() => installBanner.classList.add('show'), 600);
}
function hideInstallBanner(remember) {
  if (installBanner) installBanner.classList.remove('show');
  if (remember) {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn && !standalone) installBtn.classList.remove('hidden');
  showInstallBanner();
});

async function doInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch (_) {}
  deferredInstallPrompt = null;
  hideInstallBanner(true);
  if (installBtn) installBtn.classList.add('hidden');
}

if (installBtn) installBtn.addEventListener('click', doInstall);
if (bannerInstall) bannerInstall.addEventListener('click', doInstall);
if (bannerClose) bannerClose.addEventListener('click', () => hideInstallBanner(true));

window.addEventListener('appinstalled', () => {
  hideInstallBanner(true);
  if (installBtn) installBtn.classList.add('hidden');
});

// iOS Safari never fires beforeinstallprompt — show the banner with the
// manual Add-to-Home-Screen hint instead of an Install button.
(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone && !bannerDismissed()) {
    if (bannerInstall) bannerInstall.classList.add('hidden');
    if (ibSub) ibSub.textContent = "Tap the Share button, then 'Add to Home Screen'.";
    showInstallBanner();
  }
})();
