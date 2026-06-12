/**
 * Generates build/icon.png (512×512) with zero image dependencies — a minimal
 * PNG encoder over a raw RGBA buffer. Dark space square, cyan circuit ring,
 * red worker sphere, green skill slab: the world, in 512 pixels.
 */
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const S = 512;
const px = new Uint8Array(S * S * 4);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  // simple over-compositing
  const ai = a / 255, ao = px[i + 3] / 255;
  const out = ai + ao * (1 - ai);
  if (out === 0) return;
  px[i] = Math.round((r * ai + px[i] * ao * (1 - ai)) / out);
  px[i + 1] = Math.round((g * ai + px[i + 1] * ao * (1 - ai)) / out);
  px[i + 2] = Math.round((b * ai + px[i + 2] * ao * (1 - ai)) / out);
  px[i + 3] = Math.round(out * 255);
}

function disc(cx, cy, rad, r, g, b, a = 255) {
  for (let y = Math.floor(cy - rad) - 1; y <= cy + rad + 1; y++)
    for (let x = Math.floor(cx - rad) - 1; x <= cx + rad + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad - 0.5) put(x, y, r, g, b, a);
      else if (d <= rad + 0.5) put(x, y, r, g, b, a * (rad + 0.5 - d));
    }
}

function ring(cx, cy, rad, width, r, g, b, a = 255) {
  for (let y = Math.floor(cy - rad - width); y <= cy + rad + width; y++)
    for (let x = Math.floor(cx - rad - width); x <= cx + rad + width; x++) {
      const d = Math.abs(Math.hypot(x - cx, y - cy) - rad);
      if (d <= width / 2 - 0.5) put(x, y, r, g, b, a);
      else if (d <= width / 2 + 0.5) put(x, y, r, g, b, a * (width / 2 + 0.5 - d));
    }
}

function line(x0, y0, x1, y1, width, r, g, b, a = 255) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, r, g, b, a);
  }
}

function rect(cx, cy, w, h, angle, r, g, b, a = 255) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = -h / 2; y <= h / 2; y += 0.5)
    for (let x = -w / 2; x <= w / 2; x += 0.5)
      put(Math.round(cx + x * ca - y * sa), Math.round(cy + x * sa + y * ca), r, g, b, a);
}

// ---- compose -------------------------------------------------------------
// rounded dark background
const RAD = 96;
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const dx = Math.max(RAD - x, x - (S - 1 - RAD), 0);
    const dy = Math.max(RAD - y, y - (S - 1 - RAD), 0);
    if (Math.hypot(dx, dy) <= RAD) {
      const g = 11 + (y / S) * 8;
      put(x, y, 6, g, 18, 255);
    }
  }
// starfield
let seed = 1337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 130; i++) {
  const x = 30 + rnd() * (S - 60), y = 30 + rnd() * (S - 60);
  disc(x, y, 0.8 + rnd() * 1.1, 74, 106, 136, 120 + rnd() * 80);
}
// globe ring (the system boundary)
ring(256, 256, 178, 7, 31, 179, 232, 210);
ring(256, 256, 178, 22, 31, 179, 232, 28);
// circuit path
line(150, 330, 226, 246, 7, 232, 244, 255, 200);
line(226, 246, 318, 290, 7, 232, 244, 255, 200);
line(318, 290, 372, 196, 7, 232, 244, 255, 200);
// blue code rays
line(226, 246, 168, 170, 4, 20, 148, 232, 190);
line(318, 290, 332, 372, 4, 20, 148, 232, 190);
line(372, 196, 300, 138, 4, 20, 148, 232, 190);
// nodes
disc(150, 330, 13, 232, 244, 255, 255);
disc(372, 196, 13, 232, 244, 255, 255);
// skill slabs (green)
rect(180, 158, 56, 24, -0.35, 139, 227, 42, 255);
rect(338, 384, 50, 22, 0.25, 139, 227, 42, 255);
// the worker (red sphere) with glow
disc(226, 246, 34, 255, 39, 66, 60);
disc(226, 246, 24, 255, 39, 66, 255);
disc(218, 238, 8, 255, 130, 145, 220);

// ---- encode PNG -----------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', png);
console.log(`build/icon.png written (${png.length} bytes)`);
