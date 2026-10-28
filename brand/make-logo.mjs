// Turns brand/logo-original.webp (logo on a white background) into transparent PNGs for the site.
// Run with:  node brand/make-logo.mjs
//
// How the white is removed:
//  1. Flood-fill from the image edges: near-white pixels connected to the border are background.
//  2. Pixels right next to the background are soft anti-aliased edges (logo color mixed with white).
//     Those get "color to alpha": the white part becomes transparency, the logo color is kept.
//  3. Everything else is the logo itself and stays fully opaque, so light colors like the
//     mint highlight are not faded.
// It uses headless Chrome's canvas, so no image library has to be installed.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SOURCE = 'brand/logo-original.webp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const source = `data:image/webp;base64,${readFileSync(SOURCE).toString('base64')}`;
mkdirSync('public/img', { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${process.env.TEMP}\\taskflow-logo-chrome`, '--remote-debugging-port=9340', 'about:blank']);
let pageWs;
for (let i = 0; i < 40 && !pageWs; i++) {
  await sleep(250);
  try { pageWs = (await (await fetch('http://127.0.0.1:9340/json/list')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(pageWs);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

// Everything below runs inside the browser page
const pageCode = async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, W, H);
  const px = image.data;
  const whiteness = (i) => 255 - Math.min(px[i], px[i + 1], px[i + 2]); // 0 = pure white

  // 1. Background = near-white pixels reachable from the border
  const bg = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (bg[p] || whiteness(p * 4) > 14) continue;
    bg[p] = 1;
    const x = p % W, y = (p - x) / W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }

  // 2 + 3. Background transparent, edge band un-mixed from white, the rest untouched
  const BAND = 3;
  const nearBg = (p) => {
    const x = p % W, y = (p - x) / W;
    for (let dy = -BAND; dy <= BAND; dy++) {
      for (let dx = -BAND; dx <= BAND; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && bg[ny * W + nx]) return true;
      }
    }
    return false;
  };
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (bg[p]) { px[i + 3] = 0; continue; }
    if (nearBg(p)) {
      const a = Math.max(255 - px[i], 255 - px[i + 1], 255 - px[i + 2]) / 255;
      if (a < 0.02) { px[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(Math.min(255, Math.max(0, (px[i + c] - 255 * (1 - a)) / a)));
      px[i + 3] = Math.round(a * 255);
    }
    const x = p % W, y = (p - x) / W;
    if (px[i + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  ctx.putImageData(image, 0, 0);

  // Crop to the logo, square, with a little breathing room
  const size = Math.max(maxX - minX, maxY - minY) * 1.06;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const crop = { x: cx - size / 2, y: cy - size / 2, size };

  const render = async (out, background, pad = 0, radius = 0) => {
    const c = new OffscreenCanvas(out, out);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (background) {
      g.fillStyle = background;
      g.beginPath();
      g.roundRect(0, 0, out, out, radius);
      g.fill();
    }
    const inner = out - pad * 2;
    g.drawImage(canvas, crop.x, crop.y, crop.size, crop.size, pad, pad, inner, inner);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  };

  return JSON.stringify({
    source: [W, H],
    crop: [Math.round(crop.x), Math.round(crop.y), Math.round(crop.size)],
    files: {
      'logo.png': await render(512),                                   // nav, sidebar, footer
      'favicon.png': await render(64),                                 // browser tab
      'apple-touch-icon.png': await render(180, '#0a0a0a', 30, 40),    // phone home screen (needs a solid background)
    },
  });
};

const result = await send('Runtime.evaluate', {
  expression: `(${pageCode.toString()})(${JSON.stringify(source)})`,
  awaitPromise: true,
  returnByValue: true,
});
if (result.result?.exceptionDetails) {
  console.error(result.result.exceptionDetails.exception?.description);
  process.exit(1);
}
const { source: dims, crop, files } = JSON.parse(result.result.result.value);
console.log('source', dims.join('x'), '| crop x,y,size', crop.join(', '));
for (const [name, b64] of Object.entries(files)) {
  writeFileSync(`public/img/${name}`, Buffer.from(b64, 'base64'));
  console.log('wrote public/img/' + name);
}
ws.close();
chrome.kill();
