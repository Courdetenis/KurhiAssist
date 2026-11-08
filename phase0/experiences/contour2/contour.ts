// Card outline in a counter photo (OpenCV.js, CPU, no model), about 100 ms.
// 1. Straight lines: Hough on a colour Canny of the photo shrunk to 640 px, after a median filter that wipes out
//    the weave of a fabric playmat.
// 2. Background, two ways: colours seen in a ring along the frame's border (a busy mat is background wherever
//    its colours show there), and what is reached from that border without crossing an edge.
// 3. Every quadrilateral made of two roughly parallel pairs of lines is scored: edge strength along its 4
//    sides, sides that stop at the corners, card ratio, right angles, size, centre, background just outside
//    each side, the same card border just inside. The score is a weighted sum of log factors (a product of
//    factors, each raised to a power); the weights were fitted on synthetic photos (apprendre.ts).
// 4. The winner's sides are pushed outward onto a fainter parallel edge when the colour beyond it is more the
//    background's (white card on a white table: the inner frame was taken for the card), then refitted on the
//    gradient averaged along each half of the side.
// Corners are where the sides meet, so rounded corners, corners out of the frame and a card partly hidden
// by another one all work. A sleeve's edge usually wins over the card's own edge inside it.
import sharp from "sharp";
import { opencv, type Point } from "../../vision.ts";

const TAILLE = Number(process.env.TAILLE ?? 640); // working size, long side
const RATIO = 63 / 88;
const NB_DROITES = Number(process.env.NBD ?? 60); // longest lines kept
const CONTRASTE = 60; // Sobel 3x3 response counted as a full edge
const DELTA = 4; // px between a side and the colour samples beside it

// Log factors of a candidate, all <= 0, and their weights (the score is their weighted sum).
export const NOMS = ["ratio", "angle", "aire", "centre", "appui", "appuiPlein", "bouts", "fond", "exterieur", "dedansFond", "coherence", "coherenceRGB", "table", "contraste"] as const;
export const POIDS: number[] = process.env.POIDS ? JSON.parse(process.env.POIDS) : [1, 1, 1, 1, 2, 0, 1, 1, 0, 0, 1, 0, 0, 0];

type Ligne = { a: number; b: number; c: number }; // a x + b y = c, (a, b) unit normal
// Along the line (point = c n + t u, u = (-b, a), index = t + t0), prefix sums of: edge strength (force), signed
// edge strength (signe), in-frame samples (dedans), DELTA px on the +n then -n side: colour, background
// likeness, reached from the border (couleur, 5 + 5 values), samples where both sides are in frame (compte).
type Droite = Ligne & { t0: number; force: Float32Array; signe: Float32Array; dedans: Int32Array; couleur: Float32Array; compte: Int32Array };
type Candidat = { q: Point[]; cotes: Droite[]; score: number; f: number[] };
type Analyse = {
  w: number; h: number; largeur: number; droites: Droite[]; gx: Float32Array; gy: Float32Array; rgb: Uint8Array;
  fond: Float32Array; table: number[]; grain: number;
};

export async function trouverCarte(photo: Buffer): Promise<{ coins: Point[] | null; ms: number; confiance: number }> {
  const t0 = performance.now();
  const a = await analyser(photo);
  const [meilleur] = chercher(a, POIDS, 1);
  if (!meilleur) return { coins: null, ms: performance.now() - t0, confiance: 0 };
  return { coins: finir(a, meilleur), ms: performance.now() - t0, confiance: Math.exp(meilleur.score) };
}

// Lines of the photo, with everything needed to score quadrilaterals made of them.
async function analyser(photo: Buffer): Promise<Analyse> {
  const T0 = performance.now(); const tm: Record<string, number> = {}; let tp = T0; const top = (n: string) => { const t = performance.now(); tm[n] = (tm[n] ?? 0) + t - tp; tp = t; };
  const { cv } = await opencv();
  const meta = await sharp(photo).metadata();
  const largeur = (meta.orientation ?? 1) >= 5 ? meta.height! : meta.width!;
  const { data, info } = await sharp(photo).rotate().resize(TAILLE, TAILLE, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const mats: any[] = [];
  const m = <T>(x: T) => (mats.push(x), x);
  try {
    top("decode");
    const brut = m(cv.matFromArray(h, w, cv.CV_8UC3, data));
    // Plain Gaussian blur for the final widening and refit (faint edges, sub-pixel position) ...
    const net = m(new cv.Mat());
    cv.GaussianBlur(brut, net, new cv.Size(5, 5), 0);
    const rgbNet = new Uint8Array(net.data);
    const [gxNet, gyNet] = gradient(cv, net, m, w, h);
    // ... and a median filter first for the lines and the scores.
    const flou = m(new cv.Mat());
    cv.medianBlur(brut, flou, 5); // fabric weave and print dots: many short edges, gone; straight sides stay
    cv.GaussianBlur(flou, flou, new cv.Size(5, 5), 0);
    top("median+gauss");
    const rgb = new Uint8Array(flou.data); // copy: views on the WASM heap go stale when it grows
    // Canny on 3 channels keeps, per pixel, the strongest channel: yellow on brown wood still has an edge.
    const bords = m(new cv.Mat());
    cv.Canny(flou, bords, Number(process.env.CB ?? 20), 3 * Number(process.env.CB ?? 20));
    top("canny");
    const [gx, gy] = gradient(cv, flou, m, w, h);
    top("sobel");
    const fond = fondProba(rgb, w, h);
    top("fondProba");
    // Reached from the frame's border without crossing an edge (Canny closed by a 3x3 dilation): the mat around
    // the card, however the flash changes its colours.
    const libre = m(new cv.Mat()), etiq = m(new cv.Mat());
    cv.dilate(bords, libre, m(cv.Mat.ones(3, 3, cv.CV_8U)));
    cv.bitwise_not(libre, libre);
    cv.connectedComponents(libre, etiq, 4, cv.CV_32S);
    const e = etiq.data32S as Int32Array;
    let nb = 0;
    for (let i = 0; i < w * h; i++) if (e[i] > nb) nb = e[i];
    const auBord = new Uint8Array(nb + 1);
    for (let x = 0; x < w; x++) auBord[e[x]] = auBord[e[(h - 1) * w + x]] = 1;
    for (let y = 0; y < h; y++) auBord[e[y * w]] = auBord[e[y * w + w - 1]] = 1;
    auBord[0] = 0; // edge pixels
    if (process.env.EXT2) {
      // A region cut off from the border by a printed outline and the card (between a mat's curve and the card's
      // side) is still the mat when its mean colour is a border region's (teinte distance below 15).
      const somme = new Float64Array(3 * (nb + 1)), taille = new Int32Array(nb + 1);
      for (let i = 0; i < w * h; i++) { const c = e[i]; taille[c]++; for (let k = 0; k < 3; k++) somme[3 * c + k] += rgb[3 * i + k]; }
      const moy = (c: number) => [0, 1, 2].map((k) => somme[3 * c + k] / taille[c]);
      const bords: number[][] = [];
      for (let c = 1; c <= nb; c++) if (auBord[c] && taille[c] > 50) bords.push(moy(c));
      for (let c = 1; c <= nb; c++) if (!auBord[c] && taille[c] > 50 && bords.some((b) => teinte(moy(c), b) < Number(process.env.EXT2))) auBord[c] = 1;
    }
    const exterieur = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) exterieur[i] = auBord[e[i]];
    top("connexe");
    // Table colour: median of a ring along the frame's border; its grain: median distance to that colour.
    const anneau: number[][] = [];
    for (let i = 0; i < 2 * (w + h); i += 2) {
      const [x, y] = i < w ? [i, 3] : i < 2 * w ? [i - w, h - 4] : i < 2 * w + h ? [3, i - 2 * w] : [w - 4, i - 2 * w - h];
      anneau.push([0, 1, 2].map((c) => rgb[3 * (y * w + x) + c]));
    }
    const mediane = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
    const table = [0, 1, 2].map((c) => mediane(anneau.map((p) => p[c])));
    const grain = mediane(anneau.map((p) => distance(p, table)));

    top("anneau");
    const segs = m(new cv.Mat());
    cv.HoughLinesP(bords, segs, 1, Math.PI / 180, 30, Number(process.env.HMIN ?? 0.06) * Math.max(w, h), 8);
    top("hough");
    const lignes = regrouper(segs.data32S as Int32Array, fond, w, h).slice(0, NB_DROITES);
    top("regrouper");
    const droites = lignes.map((dr) => profil(dr, gx, gy, rgb, fond, exterieur, w, h));
    top("profil"); if (process.env.PROFIL) console.log(JSON.stringify(Object.fromEntries(Object.entries(tm).map(([k, v]) => [k, Math.round(v)]))), segs.rows);
    return { w, h, largeur, droites, gx, gy, rgb, fond, table, grain, exterieur, gxNet, gyNet, rgbNet } as Analyse;
  } finally {
    for (const x of mats) x.delete?.();
  }
}

// The K best quadrilaterals (best first). Every log factor is <= 0 and every weight >= 0, so a partial score is
// an upper bound: most candidates stop after the cheap factors.
function chercher(a: Analyse, poids: number[], K: number): Candidat[] {
  const { droites } = a;
  const paires: [Droite, Droite][] = [];
  for (let i = 0; i < droites.length; i++) for (let j = i + 1; j < droites.length; j++) {
    if (Math.abs(droites[i].a * droites[j].a + droites[i].b * droites[j].b) > Math.cos((30 * Math.PI) / 180)) paires.push([droites[i], droites[j]]);
  }
  const meilleurs: Candidat[] = [];
  for (let i = 0; i < paires.length; i++) for (let j = i + 1; j < paires.length; j++) {
    const [d1, d2] = paires[i], [d3, d4] = paires[j];
    if (Math.abs(d1.a * d3.a + d1.b * d3.b) > Math.cos((50 * Math.PI) / 180)) continue;
    const cand = noter([d1, d4, d2, d3], a, poids, meilleurs.length < K ? -Infinity : meilleurs[K - 1].score);
    if (!cand) continue;
    meilleurs.splice(meilleurs.findIndex((c) => c.score < cand.score) >>> 0, 0, cand); // >>> 0: -1 -> end
    if (meilleurs.length > K) meilleurs.pop();
  }
  return meilleurs;
}

// Widening, refit, corners in the photo's pixels.
function finir(a: Analyse, meilleur: Candidat): Point[] {
  const { w, h, fond, grain } = a;
  const [gx, gy, rgb] = process.env.FIN === "2" ? [(a as any).gxNet, (a as any).gyNet, a.rgb] : process.env.FIN ? [(a as any).gxNet, (a as any).gyNet, (a as any).rgbNet] : [a.gx, a.gy, a.rgb];
  let cotes: Ligne[] = elargir(meilleur.cotes, gx, gy, rgb, fond, a.table, grain, w, h);
  const q0 = coinsDe(cotes);
  if (q0.some((p) => !p) || !convexe(q0 as Point[])) cotes = meilleur.cotes; // widening broke the shape
  cotes = affiner(cotes, gx, gy, w, h);
  const q = cotes.map((dr, k) => inter(cotes[(k + 3) % 4], dr) ?? meilleur.q[k]);
  const k = a.largeur / w;
  return ordonner(q).map(([x, y]) => [x * k, y * k] as Point);
}

// Same as Canny for the gradient used to score and refit: per pixel, the channel with the largest Sobel response.
function gradient(cv: any, img: any, m: <T>(x: T) => T, w: number, h: number): [Float32Array, Float32Array] {
  const sx = m(new cv.Mat()), sy = m(new cv.Mat());
  cv.Sobel(img, sx, cv.CV_16S, 1, 0, 3);
  cv.Sobel(img, sy, cv.CV_16S, 0, 1, 3);
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const x3 = sx.data16S as Int16Array, y3 = sy.data16S as Int16Array;
  for (let i = 0; i < w * h; i++) {
    let best = -1;
    for (let c = 3 * i; c < 3 * i + 3; c++) {
      const n = x3[c] * x3[c] + y3[c] * y3[c];
      if (n > best) { best = n; gx[i] = x3[c]; gy[i] = y3[c]; }
    }
  }
  return [gx, gy];
}

const long = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const distance = (x: number[], y: number[]) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
const dans = (x: number, y: number, w: number, h: number) => x >= 3 && y >= 3 && x < w - 3 && y < h - 3;

// Per pixel, how much its colour looks like the background: share of a ring along the frame's border (4 % of
// the long side wide) with a colour within one 16-level bin, counted also 15 and 30 % brighter (the flash
// lights the centre more than the border). 1 once that share reaches 1.5 %.
function fondProba(rgb: Uint8Array, w: number, h: number): Float32Array {
  const hist = new Float32Array(4096);
  const R = Math.round(0.04 * Math.max(w, h));
  const bin = (r: number, g: number, b: number) => ((Math.min(255, r) >> 4) << 8) | ((Math.min(255, g) >> 4) << 4) | (Math.min(255, b) >> 4);
  let n = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (Math.min(x, y, w - 1 - x, h - 1 - y) >= R) continue;
    const j = 3 * (y * w + x);
    for (const k of [1, 1.15, 1.3]) hist[bin(rgb[j] * k, rgb[j + 1] * k, rgb[j + 2] * k)]++;
    n += 3;
  }
  const proba = new Float32Array(4096);
  for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
    let s = 0;
    for (let dr = Math.max(0, r - 1); dr <= Math.min(15, r + 1); dr++) for (let dg = Math.max(0, g - 1); dg <= Math.min(15, g + 1); dg++) for (let db = Math.max(0, b - 1); db <= Math.min(15, b + 1); db++) s += hist[(dr << 8) | (dg << 4) | db];
    proba[(r << 8) | (g << 4) | b] = Math.min(1, s / (0.015 * n));
  }
  const fond = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) fond[i] = proba[bin(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2])];
  return fond;
}

function inter(p: Ligne, q: Ligne): Point | null {
  const det = p.a * q.b - q.a * p.b;
  if (Math.abs(det) < 1e-6) return null;
  return [(p.c * q.b - q.c * p.b) / det, (p.a * q.c - q.a * p.c) / det];
}

// Corner k is where side k - 1 meets side k.
const coinsDe = (cotes: Ligne[]) => cotes.map((dr, k) => inter(cotes[(k + 3) % 4], dr));

function convexe(q: Point[]): boolean {
  const z = q.map((p, i) => (q[(i + 1) % 4][0] - p[0]) * (q[(i + 2) % 4][1] - p[1]) - (q[(i + 1) % 4][1] - p[1]) * (q[(i + 2) % 4][0] - p[0]));
  return z.every((v) => v > 0) || z.every((v) => v < 0);
}

// Hough segments -> lines: collinear segments (same angle within 2 deg, within 3 px) add their lengths.
// A segment counts fully where it has the background on one side only: wood grain or a mat's stripes
// (background on both sides) would otherwise crowd the card's sides out of the longest lines.
function regrouper(s: Int32Array, fond: Float32Array, w: number, h: number): Ligne[] {
  const segs = Array.from({ length: s.length / 4 }, (_, i) => [s[4 * i], s[4 * i + 1], s[4 * i + 2], s[4 * i + 3]])
    .map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, l: Math.hypot(x2 - x1, y2 - y1) }))
    .sort((p, q) => q.l - p.l);
  const estFond = (x: number, y: number) => fond[Math.round(y) * w + Math.round(x)] > 0.5;
  const ds: (Ligne & { long: number })[] = [];
  for (const { x1, y1, x2, y2, l } of segs) {
    const a = -(y2 - y1) / l, b = (x2 - x1) / l;
    let bord = 0, n = 0;
    for (let t = 0; t <= 1; t += 2 / l) {
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (!dans(x + DELTA * a, y + DELTA * b, w, h) || !dans(x - DELTA * a, y - DELTA * b, w, h)) continue;
      n++;
      if (estFond(x + DELTA * a, y + DELTA * b) !== estFond(x - DELTA * a, y - DELTA * b)) bord++;
    }
    const utile = l * (0.25 + (0.75 * bord) / Math.max(1, n));
    const dr = ds.find((d) => Math.abs(d.a * a + d.b * b) > 0.9994 && Math.abs(d.a * x1 + d.b * y1 - d.c) < 3 && Math.abs(d.a * x2 + d.b * y2 - d.c) < 3);
    if (dr) dr.long += utile;
    else ds.push({ a, b, c: a * x1 + b * y1, long: utile });
  }
  return ds.sort((p, q) => q.long - p.long);
}

function profil(dr: Ligne, gx: Float32Array, gy: Float32Array, rgb: Uint8Array, fond: Float32Array, exterieur: Uint8Array, w: number, h: number): Droite {
  const T = Math.ceil(1.7 * Math.hypot(w, h));
  const force = new Float32Array(2 * T + 2), signe = new Float32Array(2 * T + 2), dedans = new Int32Array(2 * T + 2);
  const couleur = new Float32Array(10 * (2 * T + 2)), compte = new Int32Array(2 * T + 2);
  const val = (j: number, c: number) => (c < 3 ? rgb[3 * j + c] : c === 3 ? fond[j] : exterieur[j]);
  for (let i = 0; i <= 2 * T; i++) {
    const t = i - T;
    const x = dr.c * dr.a - t * dr.b, y = dr.c * dr.b + t * dr.a;
    const ok = dans(x, y, w, h);
    dedans[i + 1] = dedans[i] + Number(ok);
    // Gradient across the line, best of +-2 px along the normal (tolerates a slightly tilted line).
    let g = 0;
    for (let o = -2; ok && o <= 2; o++) {
      const j = Math.round(y + o * dr.b) * w + Math.round(x + o * dr.a);
      const v = gx[j] * dr.a + gy[j] * dr.b;
      if (Math.abs(v) > Math.abs(g)) g = v;
    }
    force[i + 1] = force[i] + Math.min(1, Math.abs(g) / CONTRASTE);
    signe[i + 1] = signe[i] + Math.max(-1, Math.min(1, g / CONTRASTE));
    const xp = x + DELTA * dr.a, yp = y + DELTA * dr.b, xm = x - DELTA * dr.a, ym = y - DELTA * dr.b;
    const deux = dans(xp, yp, w, h) && dans(xm, ym, w, h);
    compte[i + 1] = compte[i] + Number(deux);
    const p = Math.round(yp) * w + Math.round(xp), mo = Math.round(ym) * w + Math.round(xm);
    for (let c = 0; c < 5; c++) {
      couleur[10 * (i + 1) + c] = couleur[10 * i + c] + (deux ? val(p, c) : 0);
      couleur[10 * (i + 1) + 5 + c] = couleur[10 * i + 5 + c] + (deux ? val(mo, c) : 0);
    }
  }
  return { a: dr.a, b: dr.b, c: dr.c, t0: T, force, signe, dedans, couleur, compte };
}

// Score (weighted sum of the log factors, in NOMS order) of the quadrilateral whose side k runs from corner k
// to k + 1, or null when it cannot beat `borne`. The cheap factors come first.
function noter(cotes: Droite[], a: Analyse, poids: number[], borne: number): Candidat | null {
  const { w, h } = a;
  const q = coinsDe(cotes) as Point[];
  if (q.some((p) => !p || p[0] < -0.3 * w || p[0] > 1.3 * w || p[1] < -0.3 * h || p[1] > 1.3 * h) || !convexe(q)) return null;
  const aire = Math.abs(q.reduce((s, p, i) => s + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0)) / 2 / (w * h);
  if (aire < 0.03) return null;
  const f: number[] = [];
  let score = 0;
  const ajouter = (v: number) => { score += poids[f.length] * v; f.push(v); return score > borne; };
  // Shape: card ratio (perspective tolerated), right angles (a parallelogram made of a mat's stripes is not a
  // card in mild perspective), size (the card beats its own art box), centre.
  const [c0, c1] = [long(q[0], q[1]) + long(q[2], q[3]), long(q[1], q[2]) + long(q[3], q[0])];
  if (!ajouter(-((Math.log(Math.min(c0, c1) / Math.max(c0, c1) / RATIO) / 0.25) ** 2))) return null;
  const ecarts = q.map((p, i) => {
    const u = q[(i + 3) % 4], v = q[(i + 1) % 4];
    const cos = ((u[0] - p[0]) * (v[0] - p[0]) + (u[1] - p[1]) * (v[1] - p[1])) / long(u, p) / long(v, p);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90;
  });
  if (!ajouter(-ecarts.reduce((s, e) => s + e * e, 0) / 4 / 20 ** 2)) return null;
  if (!ajouter(Math.log(Math.min(1, aire)))) return null;
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  if (!ajouter(Math.log(1 - 0.3 * Math.hypot(cx / w - 0.5, cy / h - 0.5)))) return null;
  // Edge all along each side (two saturation levels); edge that goes on beyond the corners (stripe, outline).
  const appuis = cotes.map((dr, k) => appui(dr, q[k], q[(k + 1) % 4]));
  if (!ajouter(appuis.reduce((s, v) => s + Math.log(Math.max(1e-3, Math.min(1, v / 0.7))), 0))) return null;
  if (!ajouter(appuis.reduce((s, v) => s + Math.log(Math.max(1e-3, Math.min(1, v / 0.95))), 0))) return null;
  const bouts = cotes.flatMap((dr, k) => prolongement(dr, q[k], q[(k + 1) % 4]));
  if (!ajouter(-bouts.reduce((s, v) => s + Math.log(1 + (Math.max(0, v - 0.25) / 0.3) ** 2), 0))) return null;
  // Just outside each side the background, just inside the same card border on all 4: a side taken on the art
  // box, on the inner frame or on another card breaks one of these.
  const sens = cotes.map((dr) => (dr.a * cx + dr.b * cy > dr.c ? 1 : -1));
  const dehors = cotes.map((dr, k) => bande(dr, q[k], q[(k + 1) % 4], -sens[k]));
  const dedans = cotes.map((dr, k) => bande(dr, q[k], q[(k + 1) % 4], sens[k]));
  const somme = (xs: (number[] | null)[], g: (x: number[], k: number) => number) => xs.reduce((s, x, k) => (x ? s + g(x, k) : s), 0);
  if (!ajouter(somme(dehors, (x) => -Math.log(1 + ((1 - x[3]) / 0.4) ** 2)))) return null;
  if (!ajouter(somme(dehors, (x) => -Math.log(1 + ((1 - x[4]) / 0.4) ** 2)))) return null;
  if (!ajouter(somme(dedans, (x) => Math.log(1 - 0.9 * x[3])))) return null;
  const med = mediane3(dedans);
  if (!ajouter(med ? somme(dedans, (x) => -Math.log(1 + (teinte(x, med) / 25) ** 2)) : 0)) return null;
  if (!ajouter(med ? somme(dedans, (x) => -Math.log(1 + (distance(x, med) / 40) ** 2)) : 0)) return null;
  if (!ajouter(somme(dehors, (x) => -Math.log(1 + (distance(x, a.table) / 30) ** 2)))) return null;
  if (!ajouter(somme(dehors, (x, k) => (dedans[k] ? Math.log(Math.max(1e-3, Math.min(1, teinte(x, dedans[k]!) / 30))) : 0)))) return null;
  return { q, cotes, score, f };
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

// Edge strength with a steady polarity (texture averages out) on the line beyond both ends of the side p-q,
// from 4 to 20 % of its length; 0 when mostly out of the frame.
function prolongement(dr: Droite, p: Point, q: Point): number[] {
  let tp = -p[0] * dr.b + p[1] * dr.a, tq = -q[0] * dr.b + q[1] * dr.a;
  if (tp > tq) [tp, tq] = [tq, tp];
  const L = tq - tp, N = dr.dedans.length - 1;
  return [[tp - 0.2 * L, tp - 0.04 * L], [tq + 0.04 * L, tq + 0.2 * L]].map(([a, b]) => {
    const i = Math.max(0, Math.min(N, Math.round(a) + dr.t0)), j = Math.max(0, Math.min(N, Math.round(b) + dr.t0));
    const n = dr.dedans[j] - dr.dedans[i];
    return n < 0.3 * (b - a) ? 0 : Math.abs(dr.signe[j] - dr.signe[i]) / n;
  });
}

// Mean colour, background likeness and share reached from the border, DELTA px beside the side, on the +n
// (sens 1) or -n (sens -1) side; null when mostly out of frame.
function bande(dr: Droite, p: Point, q: Point, sens: number): number[] | null {
  const [i, j] = plage(dr, p, q, 0.1);
  const n = j > i ? dr.compte[j] - dr.compte[i] : 0;
  if (n < 0.15 * (j - i) || n < 5) return null;
  const o = sens > 0 ? 0 : 5;
  return [0, 1, 2, 3, 4].map((c) => (dr.couleur[10 * j + o + c] - dr.couleur[10 * i + o + c]) / n);
}

// Per channel median of the colours (null if fewer than 2).
function mediane3(cs: (number[] | null)[]): number[] | null {
  const ok = cs.filter((c): c is number[] => c !== null);
  if (ok.length < 2) return null;
  return [0, 1, 2].map((c) => {
    const v = ok.map((x) => x[c]).sort((a, b) => a - b);
    return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2;
  });
}

// Colour distance that tolerates the flash's lighting gradient: hue and saturation relative to brightness (in %,
// brightness floored so that near-black stays comparable), plus a weaker term on the brightness ratio.
function teinte(x: number[], y: number[]): number {
  const lx = (x[0] + x[1] + x[2]) / 3, ly = (y[0] + y[1] + y[2]) / 3;
  const kx = 100 / Math.max(lx, 40), ky = 100 / Math.max(ly, 40);
  return Math.hypot((x[0] - lx) * kx - (y[0] - ly) * ky, (x[1] - lx) * kx - (y[1] - ly) * ky, (x[2] - lx) * kx - (y[2] - ly) * ky, 30 * Math.log((lx + 10) / (ly + 10)));
}

// Mean gradient across the side, mean colour, colour variance and background likeness along it, at offsets
// d = -3..D px (outward when s = 1), over the part t1..t2 of the side p-r. Averaged along the side, a faint
// edge stands out of the noise.
function profilCote(dr: Ligne, p: Point, r: Point, s: number, D: number, t1: number, t2: number, gx: Float32Array, gy: Float32Array, rgb: Uint8Array | null, fond: Float32Array | null, w: number, h: number) {
  const g = new Float32Array(D + 4), n = new Int32Array(D + 4), variance = new Float32Array(D + 4), f = new Float32Array(D + 4);
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
      if (fond) f[i] += fond[j];
      for (let c = 0; rgb && c < 3; c++) { col[i][c] += rgb[3 * j + c]; variance[i] += rgb[3 * j + c] ** 2; }
    }
    if (!n[i]) continue;
    g[i] /= n[i];
    f[i] /= n[i];
    col[i] = col[i].map((v) => v / n[i]);
    variance[i] = variance[i] / n[i] - col[i].reduce((s, v) => s + v * v, 0);
  }
  return { g, col, n, variance, f };
}

// Moves each side outward onto the outermost parallel edge (within 10 % of the card's width) beyond which the
// colour is clearly more the background's, and uniform all along the side (not another card lying next to this one).
function elargir(cotes: Ligne[], gx: Float32Array, gy: Float32Array, rgb: Uint8Array, fond: Float32Array, table: number[], grain: number, w: number, h: number): Ligne[] {
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
      const { g, n, variance, f, col } = profilCote(dr, p, r, s, D, 0.1, 0.9, gx, gy, rgb, fond, w, h);
      if (n[3] < 10) continue;
      const ecart = (i: number) => (n[i] ? 1 - f[i] : Infinity); // missing background share
      const ecartT = (i: number) => (n[i] ? distance(col[i], table) : Infinity); // distance to the table colour
      const i0 = [2, 3, 4].reduce((b, i) => (g[i] > g[b] ? i : b), 3);
      const actuel = ecart(i0 + 4), actuelT = ecartT(i0 + 4);
      for (let i = D - 2; i > i0 + 2; i--) {
        if (!(g[i] >= g[i - 1] && g[i] >= g[i + 1] && g[i] >= Math.max(0.1 * g[i0], 6))) continue;
        const dehors = ecart(i + 4), dehorsT = ecartT(i + 4);
        const uni = Math.sqrt(Math.max(0, variance[i + 4])) < Math.max(15, 3 * grain);
        const EL = process.env.EL ?? "both";
        const parFond = dehors < 0.6 * actuel && actuel - dehors > 0.2 && dehors < 0.4, parTable = dehorsT < 0.6 * actuelT && actuelT - dehorsT > 6 && dehorsT < 60;
        if ((EL === "new" ? parFond : EL === "old" ? parTable : EL === "tgate" ? parTable && grain < Number(process.env.GR ?? 10) : EL === "gate" ? parFond || (parTable && grain < Number(process.env.GR ?? 10)) : parFond || parTable) && uni) {
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
      const { g, n } = profilCote(dr, p, r, 1, 3, t1, t2, gx, gy, null, null, w, h);
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

// For the tools of experiences/contour2 (apprendre.ts, dbg.ts): analysis, search with given weights, scoring of
// a given quadrilateral, final steps.
export const interne = { analyser, chercher, noter: (cotes: Droite[], a: Analyse, poids: number[]) => noter(cotes, a, poids, -Infinity), finir };
