// Generates KrogerBuddy PWA icons with @napi-rs/canvas.
//   npm install @napi-rs/canvas && node scripts/gen-icons.cjs
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

GlobalFonts.registerFromPath('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'LibSans');

const BLUE_1 = '#1257b0';
const BLUE_2 = '#073a7d';
const WHITE = '#ffffff';
const ACCENT = '#f08a3c';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw a clean shopping cart centered at (cx, cy) scaled by s (design ~100 wide).
function drawCart(ctx, cx, cy, s) {
  const X = (x) => cx + (x - 50) * s;
  const Y = (y) => cy + (y - 40) * s;
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = 7 * s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // handle + basket top rail
  ctx.beginPath();
  ctx.moveTo(X(14), Y(20));
  ctx.lineTo(X(24), Y(20));
  ctx.lineTo(X(30), Y(34));
  ctx.lineTo(X(88), Y(34));
  ctx.lineTo(X(78), Y(62));
  ctx.lineTo(X(40), Y(62));
  ctx.lineTo(X(30), Y(34));
  ctx.stroke();
  // inner bars
  ctx.beginPath();
  ctx.moveTo(X(50), Y(34)); ctx.lineTo(X(53), Y(62));
  ctx.moveTo(X(67), Y(34)); ctx.lineTo(X(66), Y(62));
  ctx.stroke();
  // wheels
  ctx.beginPath(); ctx.arc(X(46), Y(74), 6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(X(71), Y(74), 6 * s, 0, Math.PI * 2); ctx.fill();
}

function renderIcon(N, { maskable }) {
  const canvas = createCanvas(N, N);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, N, N);

  // Background tile (gradient). Maskable = full bleed; otherwise rounded.
  const grad = ctx.createLinearGradient(0, 0, 0, N);
  grad.addColorStop(0, BLUE_1);
  grad.addColorStop(1, BLUE_2);
  ctx.fillStyle = grad;
  if (maskable) {
    ctx.fillRect(0, 0, N, N);
  } else {
    roundRect(ctx, 0, 0, N, N, N * 0.205);
    ctx.fill();
  }

  // Content scales smaller for maskable so it sits inside the safe zone.
  const scale = maskable ? 0.78 : 1;
  const cx = N / 2;
  const u = (N / 100) * scale; // design unit

  // Cart, upper area.
  drawCart(ctx, cx, N * (maskable ? 0.40 : 0.34), u * 0.6);

  // Wordmark, lower area: "Kroger" + "Buddy" stacked, centered.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = N * 0.165 * scale;
  ctx.font = `${big}px LibSans`;
  ctx.fillStyle = WHITE;
  ctx.fillText('Kroger', cx, N * 0.66);
  ctx.fillStyle = ACCENT;
  ctx.fillText('Buddy', cx, N * 0.66 + big * 1.02);

  return canvas.toBuffer('image/png');
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, N, opts] of jobs) {
  fs.writeFileSync(path.join(outDir, name), renderIcon(N, opts));
  console.log('wrote', name);
}
