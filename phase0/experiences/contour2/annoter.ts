// Helper used to annotate the real scans (verite-reelles.json): refines hand-placed rough corners by fitting each
// side on the strongest edge within +-R px of the rough side, then draws zoomed crops of the 4 corners to check.
// Usage (from phase0/): node experiences/contour2/annoter.ts <photo> '<rough corners json>' <out prefix> [R]
import sharp from "sharp";
import type { Point } from "../../vision.ts";

const [photo, json, sortie, rArg] = process.argv.slice(2);
const R = Number(rArg ?? 25);
const rough: Point[] = JSON.parse(json);
const { data, info } = await sharp(photo).rotate().removeAlpha().blur(1.5).raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height;
const px = (x: number, y: number, c: number) => data[3 * (Math.round(y) * w + Math.round(x)) + c];

type L = { a: number; b: number; c: number };
const inter = (p: L, q: L): Point => { const d = p.a * q.b - q.a * p.b; return [(p.c * q.b - q.c * p.b) / d, (p.a * q.c - q.a * p.c) / d]; };
const cx = rough.reduce((s, p) => s + p[0], 0) / 4, cy = rough.reduce((s, p) => s + p[1], 0) / 4;
const cotes: L[] = [];
for (let k = 0; k < 4; k++) {
  const p = rough[k], q = rough[(k + 1) % 4];
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  let a = -(q[1] - p[1]) / l, b = (q[0] - p[0]) / l;
  if (a * (cx - p[0]) + b * (cy - p[1]) > 0) { a = -a; b = -b; } // normal points outward
  const pts: Point[] = [];
  for (let t = 0.12; t <= 0.88; t += 0.01) {
    const x0 = p[0] + (q[0] - p[0]) * t, y0 = p[1] + (q[1] - p[1]) * t;
    let best = 0, bd = 0;
    for (let d = -R; d <= R; d++) {
      const x1 = x0 + (d - 2) * a, y1 = y0 + (d - 2) * b, x2 = x0 + (d + 2) * a, y2 = y0 + (d + 2) * b;
      if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= w || x2 >= w || y1 >= h || y2 >= h) continue;
      let g = 0;
      for (let c = 0; c < 3; c++) g = Math.max(g, Math.abs(px(x2, y2, c) - px(x1, y1, c)));
      if (g > best) { best = g; bd = d; }
    }
    pts.push([x0 + bd * a, y0 + bd * b]);
  }
  // Robust fit: least squares, then refit on the half closest to the line, twice.
  let sel = pts, line: L = { a, b, c: a * p[0] + b * p[1] };
  for (let it = 0; it < 3; it++) {
    const mx = sel.reduce((s, v) => s + v[0], 0) / sel.length, my = sel.reduce((s, v) => s + v[1], 0) / sel.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of sel) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the line
    let na = -Math.sin(th), nb = Math.cos(th);
    if (na * a + nb * b < 0) { na = -na; nb = -nb; }
    line = { a: na, b: nb, c: na * mx + nb * my };
    const res = pts.map((v) => Math.abs(line.a * v[0] + line.b * v[1] - line.c)).sort((x, y) => x - y);
    const lim = res[Math.floor(res.length * 0.6)] + 1;
    sel = pts.filter((v) => Math.abs(line.a * v[0] + line.b * v[1] - line.c) <= lim);
  }
  cotes.push(line);
}
const coins = cotes.map((d, k) => inter(cotes[(k + 3) % 4], d));
console.log(JSON.stringify(coins.map(([x, y]) => [Math.round(x), Math.round(y)])));
// Crops: 240 px around each corner, x3, with the fitted sides and a 10 px grid, tiled 2 x 2 (TL TR / BL BR).
const tuiles: Buffer[] = [];
const brut = await sharp(photo).rotate().removeAlpha().toBuffer();
for (let k = 0; k < 4; k++) {
  const [x, y] = coins[k];
  const S = 240, x0 = Math.max(0, Math.min(w - S, Math.round(x - S / 2))), y0 = Math.max(0, Math.min(h - S, Math.round(y - S / 2)));
  let s = "";
  for (let g = 0; g <= S; g += 10) {
    const gx = Math.ceil(x0 / 10) * 10 + g - x0, gy = Math.ceil(y0 / 10) * 10 + g - y0;
    s += `<line x1="${gx * 3}" y1="0" x2="${gx * 3}" y2="${S * 3}" stroke="#0f0" stroke-width="${(gx + x0) % 50 ? 0.5 : 1.5}" opacity="0.5"/>`;
    s += `<line x1="0" y1="${gy * 3}" x2="${S * 3}" y2="${gy * 3}" stroke="#0f0" stroke-width="${(gy + y0) % 50 ? 0.5 : 1.5}" opacity="0.5"/>`;
  }
  for (const d of [cotes[(k + 3) % 4], cotes[k]]) {
    const ux = -d.b, uy = d.a, [px0, py0] = [d.c * d.a, d.c * d.b];
    const t = (x - px0) * ux + (y - py0) * uy;
    const p1 = [px0 + (t - 400) * ux - x0, py0 + (t - 400) * uy - y0], p2 = [px0 + (t + 400) * ux - x0, py0 + (t + 400) * uy - y0];
    s += `<line x1="${p1[0] * 3}" y1="${p1[1] * 3}" x2="${p2[0] * 3}" y2="${p2[1] * 3}" stroke="#f00" stroke-width="2" opacity="0.9"/>`;
  }
  s += `<text x="5" y="20" font-size="18" fill="#ff0">${x0},${y0}</text>`;
  const crop = await sharp(brut).extract({ left: x0, top: y0, width: S, height: S }).resize(S * 3, S * 3, { kernel: "nearest" }).toBuffer();
  tuiles.push(await sharp(crop).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S * 3}" height="${S * 3}">${s}</svg>`) }]).png().toBuffer().then((b) => sharp(b).resize(480).png().toBuffer()));
}
await sharp({ create: { width: 960, height: 960, channels: 3, background: "#000" } }).composite([[0, 0], [480, 0], [480, 480], [0, 480]].map(([left, top], k) => ({ input: tuiles[k], left, top }))).jpeg({ quality: 90 }).toFile(`${sortie}.jpg`);
