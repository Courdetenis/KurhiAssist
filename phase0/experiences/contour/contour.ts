// Card outline in a counter photo (OpenCV.js, CPU, no model), about 100 ms.
// 1. Straight lines: Hough on a colour Canny of the photo shrunk to 640 px.
// 2. Every quadrilateral made of two roughly parallel pairs of lines is scored: edge strength along its 4
//    sides, card ratio, size, centre, table colour just outside each side, same card border just inside.
// 3. The winner's sides are pushed outward onto a fainter parallel edge when the colour beyond it is the
//    table's (white card on a white table: the inner frame was taken for the card), then refitted on the
//    gradient averaged along each half of the side.
// Corners are where the sides meet, so rounded corners, corners out of the frame and a card partly hidden
// by another one all work. A sleeve's edge usually wins over the card's own edge inside it.
import sharp from "sharp";
import { opencv, type Point } from "../../vision.ts";

const TAILLE = 640; // working size, long side
const RATIO = 63 / 88;
const NB_DROITES = 60; // longest lines kept
const CONTRASTE = 60; // Sobel 3x3 response counted as a full edge
const DELTA = 4; // px between a side and the colour samples beside it
const SIGMA_EXT = 30, SIGMA_INT = 40; // RGB distances that halve the score

type Ligne = { a: number; b: number; c: number }; // a x + b y = c, (a, b) unit normal
// Along the line (point = c n + t u, u = (-b, a), index = t + t0), prefix sums of: edge strength (force),
// in-frame samples (dedans), colour DELTA px on the +n then -n side (couleur), samples where both are in frame (compte).
type Droite = Ligne & { t0: number; force: Float32Array; dedans: Int32Array; couleur: Float32Array; compte: Int32Array };
type Candidat = { q: Point[]; cotes: Droite[]; score: number };

export async function trouverCarte(photo: Buffer): Promise<{ coins: Point[] | null; ms: number }> {
  const t0 = performance.now();
  const { cv } = await opencv();
  const meta = await sharp(photo).metadata();
  const largeur = (meta.orientation ?? 1) >= 5 ? meta.height! : meta.width!;
  const { data, info } = await sharp(photo).rotate().resize(TAILLE, TAILLE, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const mats: any[] = [];
  const m = <T>(x: T) => (mats.push(x), x);
  try {
    const flou = m(cv.matFromArray(h, w, cv.CV_8UC3, data));
    cv.GaussianBlur(flou, flou, new cv.Size(5, 5), 0);
    const rgb = new Uint8Array(flou.data); // copy: views on the WASM heap go stale when it grows
    // Canny on 3 channels keeps, per pixel, the strongest channel: yellow on brown wood still has an edge.
    const bords = m(new cv.Mat());
    cv.Canny(flou, bords, 20, 60);
    // Same for the gradient used to score and refit: per pixel, the channel with the largest Sobel response.
    const sx = m(new cv.Mat()), sy = m(new cv.Mat());
    cv.Sobel(flou, sx, cv.CV_16S, 1, 0, 3);
    cv.Sobel(flou, sy, cv.CV_16S, 0, 1, 3);
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    const x3 = sx.data16S as Int16Array, y3 = sy.data16S as Int16Array;
    for (let i = 0; i < w * h; i++) {
      let best = -1;
      for (let c = 3 * i; c < 3 * i + 3; c++) {
        const n = x3[c] * x3[c] + y3[c] * y3[c];
        if (n > best) { best = n; gx[i] = x3[c]; gy[i] = y3[c]; }
      }
    }
    // Table colour: median of a ring along the frame's border; its grain: median distance to that colour.
    const anneau: number[][] = [];
    for (let i = 0; i < 2 * (w + h); i += 2) {
      const [x, y] = i < w ? [i, 3] : i < 2 * w ? [i - w, h - 4] : i < 2 * w + h ? [3, i - 2 * w] : [w - 4, i - 2 * w - h];
      anneau.push([0, 1, 2].map((c) => rgb[3 * (y * w + x) + c]));
    }
    const mediane = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
    const table = [0, 1, 2].map((c) => mediane(anneau.map((p) => p[c])));
    const grain = mediane(anneau.map((p) => distance(p, table)));

    const segs = m(new cv.Mat());
    cv.HoughLinesP(bords, segs, 1, Math.PI / 180, 30, 0.06 * Math.max(w, h), 4);
    const seuilTable = Math.max(25, 3 * grain);
    const droites = regrouper(segs.data32S as Int32Array, rgb, table, seuilTable, w, h).slice(0, NB_DROITES).map((dr) => profil(dr, gx, gy, rgb, w, h));

    const paires: [Droite, Droite][] = [];
    for (let i = 0; i < droites.length; i++) for (let j = i + 1; j < droites.length; j++) {
      if (Math.abs(droites[i].a * droites[j].a + droites[i].b * droites[j].b) > Math.cos((30 * Math.PI) / 180)) paires.push([droites[i], droites[j]]);
    }
    let meilleur: Candidat | null = null;
    for (let i = 0; i < paires.length; i++) for (let j = i + 1; j < paires.length; j++) {
      const [d1, d2] = paires[i], [d3, d4] = paires[j];
      if (Math.abs(d1.a * d3.a + d1.b * d3.b) > Math.cos((50 * Math.PI) / 180)) continue;
      const cand = noter([d1, d4, d2, d3], table, w, h, meilleur?.score ?? 0);
      if (cand) meilleur = cand;
    }
    if (!meilleur) return { coins: null, ms: performance.now() - t0 };

    let cotes: Ligne[] = elargir(meilleur.cotes, gx, gy, rgb, table, grain, w, h);
    const q0 = coinsDe(cotes);
    if (q0.some((p) => !p) || forme(q0 as Point[], w, h) === 0) cotes = meilleur.cotes; // widening broke the shape
    cotes = affiner(cotes, gx, gy, w, h);
    const q = cotes.map((dr, k) => inter(cotes[(k + 3) % 4], dr) ?? meilleur.q[k]);
    const k = largeur / w;
    return { coins: ordonner(q).map(([x, y]) => [x * k, y * k] as Point), ms: performance.now() - t0 };
  } finally {
    for (const x of mats) x.delete?.();
  }
}

const long = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const distance = (x: number[], y: number[]) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
const dans = (x: number, y: number, w: number, h: number) => x >= 3 && y >= 3 && x < w - 3 && y < h - 3;

function inter(p: Ligne, q: Ligne): Point | null {
  const det = p.a * q.b - q.a * p.b;
  if (Math.abs(det) < 1e-6) return null;
  return [(p.c * q.b - q.c * p.b) / det, (p.a * q.c - q.a * p.c) / det];
}

// Corner k is where side k - 1 meets side k.
const coinsDe = (cotes: Ligne[]) => cotes.map((dr, k) => inter(cotes[(k + 3) % 4], dr));

// Hough segments -> lines: collinear segments (same angle within 2 deg, within 3 px) add their lengths.
// A segment counts fully where it has the table on one side only: wood grain or a mat's stripes (table on
// both sides) would otherwise crowd the card's sides out of the longest lines.
function regrouper(s: Int32Array, rgb: Uint8Array, table: number[], seuil: number, w: number, h: number): Ligne[] {
  const segs = Array.from({ length: s.length / 4 }, (_, i) => [s[4 * i], s[4 * i + 1], s[4 * i + 2], s[4 * i + 3]])
    .map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, l: Math.hypot(x2 - x1, y2 - y1) }))
    .sort((p, q) => q.l - p.l);
  const estTable = (x: number, y: number) => {
    const j = 3 * (Math.round(y) * w + Math.round(x));
    return distance([rgb[j], rgb[j + 1], rgb[j + 2]], table) < seuil;
  };
  const ds: (Ligne & { long: number })[] = [];
  for (const { x1, y1, x2, y2, l } of segs) {
    const a = -(y2 - y1) / l, b = (x2 - x1) / l;
    let bord = 0, n = 0;
    for (let t = 0; t <= 1; t += 2 / l) {
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (!dans(x + DELTA * a, y + DELTA * b, w, h) || !dans(x - DELTA * a, y - DELTA * b, w, h)) continue;
      n++;
      if (estTable(x + DELTA * a, y + DELTA * b) !== estTable(x - DELTA * a, y - DELTA * b)) bord++;
    }
    const utile = l * (0.25 + (0.75 * bord) / Math.max(1, n));
    const dr = ds.find((d) => Math.abs(d.a * a + d.b * b) > 0.9994 && Math.abs(d.a * x1 + d.b * y1 - d.c) < 3 && Math.abs(d.a * x2 + d.b * y2 - d.c) < 3);
    if (dr) dr.long += utile;
    else ds.push({ a, b, c: a * x1 + b * y1, long: utile });
  }
  return ds.sort((p, q) => q.long - p.long);
}

function profil(dr: Ligne, gx: Float32Array, gy: Float32Array, rgb: Uint8Array, w: number, h: number): Droite {
  const T = Math.ceil(1.7 * Math.hypot(w, h));
  const force = new Float32Array(2 * T + 2), dedans = new Int32Array(2 * T + 2);
  const couleur = new Float32Array(6 * (2 * T + 2)), compte = new Int32Array(2 * T + 2);
  for (let i = 0; i <= 2 * T; i++) {
    const t = i - T;
    const x = dr.c * dr.a - t * dr.b, y = dr.c * dr.b + t * dr.a;
    const ok = dans(x, y, w, h);
    dedans[i + 1] = dedans[i] + Number(ok);
    // Gradient across the line, best of +-2 px along the normal (tolerates a slightly tilted line).
    let g = 0;
    for (let o = -2; ok && o <= 2; o++) {
      const j = Math.round(y + o * dr.b) * w + Math.round(x + o * dr.a);
      g = Math.max(g, Math.abs(gx[j] * dr.a + gy[j] * dr.b));
    }
    force[i + 1] = force[i] + Math.min(1, g / CONTRASTE);
    const xp = x + DELTA * dr.a, yp = y + DELTA * dr.b, xm = x - DELTA * dr.a, ym = y - DELTA * dr.b;
    const deux = dans(xp, yp, w, h) && dans(xm, ym, w, h);
    compte[i + 1] = compte[i] + Number(deux);
    const p = 3 * (Math.round(yp) * w + Math.round(xp)), mo = 3 * (Math.round(ym) * w + Math.round(xm));
    for (let c = 0; c < 3; c++) {
      couleur[6 * (i + 1) + c] = couleur[6 * i + c] + (deux ? rgb[p + c] : 0);
      couleur[6 * (i + 1) + 3 + c] = couleur[6 * i + 3 + c] + (deux ? rgb[mo + c] : 0);
    }
  }
  return { a: dr.a, b: dr.b, c: dr.c, t0: T, force, dedans, couleur, compte };
}

// Score of the quadrilateral whose side k runs from corner k to k + 1, or null when it cannot beat `borne`:
// every factor is <= 1, so the cheap ones come first and most candidates stop there.
function noter(cotes: Droite[], table: number[], w: number, h: number, borne: number): Candidat | null {
  const q = coinsDe(cotes) as Point[];
  if (q.some((p) => !p || p[0] < -0.3 * w || p[0] > 1.3 * w || p[1] < -0.3 * h || p[1] > 1.3 * h)) return null;
  let score = forme(q, w, h);
  for (let k = 0; k < 4 && score > borne; k++) score *= Math.min(1, appui(cotes[k], q[k], q[(k + 1) % 4]) / 0.7) ** 2;
  if (score <= borne) return null;
  // Just outside each side the table, just inside the same card border on all 4: a side taken on the art
  // box, on the inner frame or on another card breaks one of the two.
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const dedans = cotes.map((dr) => (dr.a * cx + dr.b * cy > dr.c ? 1 : -1));
  score *= versTable(cotes.map((dr, k) => bande(dr, q[k], q[(k + 1) % 4], -dedans[k])), table);
  score *= coherence(cotes.map((dr, k) => bande(dr, q[k], q[(k + 1) % 4], dedans[k])));
  return score > borne ? { q, cotes, score } : null;
}

// Index range of the side p-q on its line, without `marge` of its length at each end (rounded corners).
function plage(dr: Droite, p: Point, q: Point, marge: number): [number, number] {
  let tp = -p[0] * dr.b + p[1] * dr.a, tq = -q[0] * dr.b + q[1] * dr.a;
  if (tp > tq) [tp, tq] = [tq, tp];
  const m = marge * (tq - tp);
  return [Math.max(0, Math.round(tp + m) + dr.t0), Math.min(dr.dedans.length - 1, Math.round(tq - m) + dr.t0)];
}

// Mean edge strength along the side; a side mostly out of the frame gets a neutral 0.5.
function appui(dr: Droite, p: Point, q: Point): number {
  const [i, j] = plage(dr, p, q, 0.06);
  if (j <= i) return 0;
  const n = dr.dedans[j] - dr.dedans[i];
  return n < 0.15 * (j - i) ? 0.5 : (dr.force[j] - dr.force[i]) / n;
}

// Mean colour DELTA px beside the side, on the +n (sens 1) or -n (sens -1) side; null when mostly out of frame.
function bande(dr: Droite, p: Point, q: Point, sens: number): number[] | null {
  const [i, j] = plage(dr, p, q, 0.1);
  const n = j > i ? dr.compte[j] - dr.compte[i] : 0;
  if (n < 0.15 * (j - i) || n < 5) return null;
  const o = sens > 0 ? 0 : 3;
  return [0, 1, 2].map((c) => (dr.couleur[6 * j + o + c] - dr.couleur[6 * i + o + c]) / n);
}

// 1 when every colour is the table's.
function versTable(cs: (number[] | null)[], table: number[]): number {
  return cs.reduce((p, x) => (x ? p / (1 + (distance(x, table) / SIGMA_EXT) ** 2) : p), 1);
}

// 1 when the colours agree; each colour far from their median lowers it.
function coherence(cs: (number[] | null)[]): number {
  const ok = cs.filter((c): c is number[] => c !== null);
  if (ok.length < 2) return 1;
  const med = [0, 1, 2].map((c) => {
    const v = ok.map((x) => x[c]).sort((a, b) => a - b);
    return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2;
  });
  return ok.reduce((p, x) => p / (1 + (distance(x, med) / SIGMA_INT) ** 2), 1);
}

// Shape prior: convex, card ratio (perspective tolerated), size (the card beats its own art box), centre.
function forme(q: Point[], w: number, h: number): number {
  const z = q.map((p, i) => (q[(i + 1) % 4][0] - p[0]) * (q[(i + 2) % 4][1] - p[1]) - (q[(i + 1) % 4][1] - p[1]) * (q[(i + 2) % 4][0] - p[0]));
  if (!(z.every((v) => v > 0) || z.every((v) => v < 0))) return 0;
  const [c0, c1] = [long(q[0], q[1]) + long(q[2], q[3]), long(q[1], q[2]) + long(q[3], q[0])];
  const ratio = Math.min(c0, c1) / Math.max(c0, c1);
  const aire = Math.abs(q.reduce((s, p, i) => s + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0)) / 2 / (w * h);
  if (aire < 0.03) return 0;
  const cx = q.reduce((s, p) => s + p[0], 0) / 4 / w - 0.5, cy = q.reduce((s, p) => s + p[1], 0) / 4 / h - 0.5;
  return Math.exp(-((Math.log(ratio / RATIO) / 0.25) ** 2)) * aire * (1 - 0.3 * Math.hypot(cx, cy));
}

// Mean gradient across the side, mean colour and colour variance along it, at offsets d = -3..D px (outward
// when s = 1), over the part t1..t2 of the side p-r. Averaged along the side, a faint edge stands out of the noise.
function profilCote(dr: Ligne, p: Point, r: Point, s: number, D: number, t1: number, t2: number, gx: Float32Array, gy: Float32Array, rgb: Uint8Array | null, w: number, h: number) {
  const g = new Float32Array(D + 4), n = new Int32Array(D + 4), variance = new Float32Array(D + 4);
  const col = Array.from({ length: D + 4 }, () => [0, 0, 0]);
  const pas = 1 / long(p, r);
  for (let i = 0; i < D + 4; i++) {
    const d = s * (i - 3);
    for (let t = t1; t <= t2; t += pas) {
      const x = Math.round(p[0] + (r[0] - p[0]) * t + d * dr.a), y = Math.round(p[1] + (r[1] - p[1]) * t + d * dr.b);
      if (!dans(x, y, w, h)) continue;
      const j = y * w + x;
      g[i] += Math.abs(gx[j] * dr.a + gy[j] * dr.b);
      n[i]++;
      for (let c = 0; rgb && c < 3; c++) { col[i][c] += rgb[3 * j + c]; variance[i] += rgb[3 * j + c] ** 2; }
    }
    if (!n[i]) continue;
    g[i] /= n[i];
    col[i] = col[i].map((v) => v / n[i]);
    variance[i] = variance[i] / n[i] - col[i].reduce((s, v) => s + v * v, 0);
  }
  return { g, col, n, variance };
}

// Moves each side outward onto the outermost parallel edge (within 10 % of the card's width) beyond which the
// colour is clearly more the table's, and table all along the side (not another card lying next to this one).
function elargir(cotes: Ligne[], gx: Float32Array, gy: Float32Array, rgb: Uint8Array, table: number[], grain: number, w: number, h: number): Ligne[] {
  cotes = cotes.map((dr) => ({ a: dr.a, b: dr.b, c: dr.c }));
  for (let tour = 0; tour < 3; tour++) {
    const q = coinsDe(cotes);
    if (q.some((p) => !p)) break;
    const cx = q.reduce((s, p) => s + p![0], 0) / 4, cy = q.reduce((s, p) => s + p![1], 0) / 4;
    let change = false;
    for (let k = 0; k < 4; k++) {
      const dr = cotes[k], p = q[k]!, r = q[(k + 1) % 4]!;
      const s = dr.a * cx + dr.b * cy > dr.c ? -1 : 1; // outward = s * normal
      const D = Math.max(6, Math.round(0.1 * (long(q[(k + 3) % 4]!, p) + long(r, q[(k + 2) % 4]!)) / 2)) + 6;
      const { g, col, n, variance } = profilCote(dr, p, r, s, D, 0.1, 0.9, gx, gy, rgb, w, h);
      if (n[3] < 10) continue;
      const ecart = (i: number) => (n[i] ? distance(col[i], table) : Infinity);
      const i0 = [2, 3, 4].reduce((b, i) => (g[i] > g[b] ? i : b), 3);
      const actuel = ecart(i0 + 4);
      for (let i = D - 2; i > i0 + 2; i--) {
        if (!(g[i] >= g[i - 1] && g[i] >= g[i + 1] && g[i] >= Math.max(0.1 * g[i0], 6))) continue;
        const dehors = ecart(i + 4);
        const uni = Math.sqrt(Math.max(0, variance[i + 4])) < Math.max(15, 3 * grain);
        if (dehors < 0.6 * actuel && actuel - dehors > 6 && dehors < 60 && uni) {
          cotes[k] = { ...dr, c: dr.c + s * (i - 3) };
          change = true;
          break;
        }
      }
    }
    if (!change) break;
  }
  return cotes;
}

// Sub-pixel position of the edge (+-3 px) on each half of every side, from the gradient averaged along that
// half; the side becomes the line through both points.
function affiner(cotes: Ligne[], gx: Float32Array, gy: Float32Array, w: number, h: number): Ligne[] {
  const q = coinsDe(cotes);
  if (q.some((p) => !p)) return cotes;
  return cotes.map((dr, k) => {
    const p = q[k]!, r = q[(k + 1) % 4]!;
    const pts: Point[] = [];
    for (const [t1, t2] of [[0.1, 0.5], [0.5, 0.9]]) {
      const { g, n } = profilCote(dr, p, r, 1, 3, t1, t2, gx, gy, null, w, h);
      if (n[3] < 5) continue;
      const i = [1, 2, 3, 4, 5].reduce((b, i) => (g[i] > g[b] ? i : b), 3);
      const den = g[i - 1] - 2 * g[i] + g[i + 1];
      const d = i - 3 + (den < 0 ? (0.5 * (g[i - 1] - g[i + 1])) / den : 0);
      const tm = (t1 + t2) / 2;
      pts.push([p[0] + (r[0] - p[0]) * tm + d * dr.a, p[1] + (r[1] - p[1]) * tm + d * dr.b]);
    }
    if (pts.length < 2) return dr;
    let a = pts[0][1] - pts[1][1], b = pts[1][0] - pts[0][0];
    const l = Math.hypot(a, b);
    if (a * dr.a + b * dr.b < 0) { a = -a; b = -b; }
    return { a: a / l, b: b / l, c: (a * pts[0][0] + b * pts[0][1]) / l };
  });
}

// Top-left, top-right, bottom-right, bottom-left as seen in the photo, starting from the corner nearest the top-left.
function ordonner(q: Point[]): Point[] {
  const aire = q.reduce((s, p, i) => s + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0);
  const horaire = aire > 0 ? q : [...q].reverse(); // y down: positive area = clockwise on screen
  const i0 = horaire.reduce((b, p, i) => (p[0] + p[1] < horaire[b][0] + horaire[b][1] ? i : b), 0);
  return [0, 1, 2, 3].map((j) => horaire[(i0 + j) % 4]);
}
