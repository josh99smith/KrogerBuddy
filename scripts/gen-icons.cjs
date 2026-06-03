// Generates PNG app icons (no external deps) for KrogerBuddy PWA installability.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const BLUE = [10, 75, 156, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function renderIcon(N, { rounded, contentScale }) {
  const px = Buffer.alloc(N * N * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  // Background
  const r = N * 0.2; // corner radius
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let inside = true;
      if (rounded) {
        const cx = Math.min(Math.max(x, r), N - r);
        const cy = Math.min(Math.max(y, r), N - r);
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      }
      set(x, y, inside ? BLUE : CLEAR);
    }
  }
  // Transform from 0..100 design space to pixels, scaled around center.
  const k = (N / 100) * contentScale;
  const cx = N / 2, cy = N / 2;
  const TX = (x) => cx + (x - 50) * k;
  const TY = (y) => cy + (y - 50) * k;
  const tns = 6.5 * k; // stroke half-thickness

  function distSeg(px0, py0, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px0 - ax) * dx + (py0 - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px0 - qx, py0 - qy);
  }
  // Cart in design space
  const segs = [
    [30, 34, 88, 34], [88, 34, 76, 66], [76, 66, 40, 66], [40, 66, 30, 34], // basket
    [30, 34, 22, 24], [22, 24, 14, 24], // handle
    [48, 34, 52, 66], [66, 34, 66, 66], // inner bars
    [40, 66, 44, 72], [76, 66, 72, 72], // legs to wheels
  ].map((s) => [TX(s[0]), TY(s[1]), TX(s[2]), TY(s[3])]);
  const wheels = [[46, 78, 6], [72, 78, 6]].map((w) => [TX(w[0]), TY(w[1]), w[2] * k]);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let on = false;
      for (const s of segs) {
        if (distSeg(x, y, s[0], s[1], s[2], s[3]) <= tns) { on = true; break; }
      }
      if (!on) for (const w of wheels) {
        if ((x - w[0]) ** 2 + (y - w[1]) ** 2 <= w[2] * w[2]) { on = true; break; }
      }
      if (on) set(x, y, WHITE);
    }
  }
  return px;
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { rounded: true, contentScale: 1 }],
  ['icon-512.png', 512, { rounded: true, contentScale: 1 }],
  ['icon-maskable-512.png', 512, { rounded: false, contentScale: 0.72 }],
];
for (const [name, N, opts] of jobs) {
  fs.writeFileSync(path.join(outDir, name), encodePNG(N, renderIcon(N, opts)));
  console.log('wrote', name);
}
