// Local image processing, no paid service: card outline (contour.ts + OpenCV warp), image fingerprint (DINOv2),
// geometric check of the best candidates (ORB). Measured in experiences/correspondance/RAPPORT.md.
import { AutoModel, Tensor } from "@huggingface/transformers";
import { createRequire } from "node:module";
import sharp from "sharp";
import { JEUX, type Jeu } from "./commun.ts";
import { trouverCarte } from "./contour.ts";

export const DIM = 384;
const MODELE = "onnx-community/dinov2-small";
const ENTREE = { largeur: 224, hauteur: 308, pas: 14 }; // whole card, aspect kept: 16 x 22 patches of 14 px
let dino: Promise<any> | undefined;

// Artwork box per game, as fractions of the card (x0, y0, x1, y1): the text differs between languages, the art does not,
// and the borders absorb the outline error.
const ART: Record<Jeu, [number, number, number, number]> = {
  pokemon: [0.08, 0.1, 0.92, 0.48],
  yugioh: [0.12, 0.18, 0.88, 0.66],
  onepiece: [0.06, 0.06, 0.94, 0.62],
  riftbound: [0.05, 0.05, 0.95, 0.55],
  lorcana: [0.08, 0.08, 0.92, 0.46],
};

const normer = (v: Float32Array) => {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
};

// Fingerprints of card images, one per game: the L2-normalised mean of the DINOv2 patch tokens inside that game's
// artwork box. A reference is indexed with its own game's box; a query is compared box to box.
export type Empreinte = Record<Jeu, Float32Array>;

export async function empreintes(images: Buffer[]): Promise<Empreinte[]> {
  dino ??= AutoModel.from_pretrained(MODELE, { dtype: "fp32" });
  const model = await dino;
  const { largeur, hauteur, pas } = ENTREE;
  const n = largeur * hauteur;
  const x = new Float32Array(images.length * 3 * n);
  const moy = [0.485, 0.456, 0.406], ec = [0.229, 0.224, 0.225]; // ImageNet normalisation
  await Promise.all(images.map(async (b, k) => {
    const brut = await sharp(b).resize(largeur, hauteur, { fit: "fill", kernel: "cubic" }).removeAlpha().raw().toBuffer();
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[k * 3 * n + c * n + i] = (brut[3 * i + c] / 255 - moy[c]) / ec[c];
  }));
  const h = (await model({ pixel_values: new Tensor("float32", x, [images.length, 3, hauteur, largeur]) })).last_hidden_state;
  const [, T] = h.dims;
  const gw = Math.floor(largeur / pas), gh = Math.floor(hauteur / pas);
  const debut = T - gw * gh; // CLS first, then the patches row by row
  return images.map((_, k) => {
    const art = Object.fromEntries(JEUX.map((j) => [j, new Float32Array(DIM)])) as Empreinte;
    for (let t = 0; t < gw * gh; t++) {
      const o = (k * T + debut + t) * DIM;
      const cx = ((t % gw) + 0.5) / gw, cy = (Math.floor(t / gw) + 0.5) / gh;
      for (const j of JEUX) {
        const [x0, y0, x1, y1] = ART[j];
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) for (let d = 0; d < DIM; d++) art[j][d] += h.data[o + d];
      }
    }
    for (const j of JEUX) normer(art[j]);
    return art;
  });
}

// ---------- Geometric check (ORB) ----------

// Straightened cards line up with their reference up to the outline error, so a local match counts only when its
// two keypoints sit at about the same place on both cards (or mirrored places for an upside-down card).
export type Points = { n: number; xy: Float32Array; desc: Uint32Array }; // 8 words (256 bits) per keypoint

export async function pointsOrb(image: Buffer | string, nb = 500): Promise<Points> {
  const { cv } = await opencv();
  const { data, info } = await sharp(image).resize(300, Math.round((300 * 88) / 63), { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const img = cv.matFromArray(info.height, info.width, cv.CV_8UC1, data);
  const orb = new cv.ORB(nb, 1.2, 3, 15, 0, 2, 0, 15, 10);
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const masque = new cv.Mat();
  orb.detectAndCompute(img, masque, kp, desc);
  const n = kp.size();
  const xy = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { const p = kp.get(i).pt; xy[2 * i] = p.x / info.width; xy[2 * i + 1] = p.y / info.height; }
  const d = new Uint32Array(Uint8Array.from(desc.data).buffer);
  img.delete(); kp.delete(); orb.delete(); desc.delete(); masque.delete();
  return { n, xy, desc: d };
}

const bits = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
};

// Matches with Hamming distance <= seuil and a clear lead over the next neighbour, each query keypoint compared
// only with reference keypoints within `tol` (fraction of the card) of the same place; best of both orientations.
export function accords(q: Points, r: Points, tol = 0.07, seuil = 48, ratio = 0.9): number {
  const G = Math.ceil(1 / tol);
  const cases: number[][] = Array.from({ length: G * G }, () => []);
  const cel = (v: number) => Math.min(G - 1, Math.max(0, Math.floor(v * G)));
  for (let j = 0; j < r.n; j++) cases[cel(r.xy[2 * j + 1]) * G + cel(r.xy[2 * j])].push(j);
  let meilleur = 0;
  for (const renverse of [false, true]) {
    let n = 0;
    for (let i = 0; i < q.n; i++) {
      const x = renverse ? 1 - q.xy[2 * i] : q.xy[2 * i], y = renverse ? 1 - q.xy[2 * i + 1] : q.xy[2 * i + 1];
      const cx = cel(x), cy = cel(y);
      let d1 = 999, d2 = 999;
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(G - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(G - 1, cx + 1); xx++) {
        for (const j of cases[yy * G + xx]) {
          if (Math.abs(r.xy[2 * j] - x) > tol || Math.abs(r.xy[2 * j + 1] - y) > tol) continue;
          let d = 0;
          for (let w = 0; w < 8; w++) d += bits(q.desc[8 * i + w] ^ r.desc[8 * j + w]);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      if (d1 <= seuil && d1 <= ratio * d2) n++;
    }
    meilleur = Math.max(meilleur, n);
  }
  return meilleur;
}

// ---------- Card outline ----------

// Straightened card, 63 x 88 mm ratio. High resolution because small print (numbers, Yu-Gi-Oh! text) needs it for OCR.
export const LARGEUR = 1260;
export const HAUTEUR = 1760;
let cvModule: any;

// Loaded on first use only: OpenCV.js installs process-wide crash handlers.
// The module is a thenable that resolves to itself: never await it or return it from an async function
// (that loops forever), hence the { cv } wrapper.
export async function opencv(): Promise<{ cv: any }> {
  cvModule ??= createRequire(import.meta.url)("@techstark/opencv-js");
  while (typeof cvModule.Mat !== "function") await new Promise((r) => setTimeout(r, 20));
  return { cv: cvModule };
}

export type Point = [number, number];

// Finds the card's outline (contour.ts) and straightens it.
// Returns the straightened card in two orientations (the photo may be upside down); without an outline,
// the whole photo in two orientations. The caller keeps whichever matches best.
// `coins` are the found corners (top-left, top-right, bottom-right, bottom-left) in the photo's pixels
// after EXIF rotation, or null when no outline was found. `imposes` (same space) skips the detection: corners
// placed by hand in the app.
export async function redresserCarte(photo: Buffer, imposes?: Point[]): Promise<{ orientations: Buffer[]; trouve: boolean; coins: Point[] | null }> {
  const { cv } = await opencv();
  const coins = imposes ?? (await trouverCarte(photo)).coins;
  const meta = await sharp(photo).metadata();
  const largeurPhoto = (meta.orientation ?? 1) >= 5 ? meta.height! : meta.width!;
  const { data, info } = await sharp(photo).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mats: any[] = [];
  const m = <T>(x: T) => (mats.push(x), x);
  try {
    const src = m(cv.matFromArray(info.height, info.width, cv.CV_8UC4, data));
    const k = info.width / largeurPhoto;
    let [hg, hd, bd, bg]: Point[] = coins
      ? coins.map(([x, y]) => [x * k, y * k] as Point)
      : [[0, 0], [info.width, 0], [info.width, info.height], [0, info.height]];
    if (Math.hypot(hd[0] - hg[0], hd[1] - hg[1]) > Math.hypot(bg[0] - hg[0], bg[1] - hg[1])) {
      [hg, hd, bd, bg] = [hd, bd, bg, hg]; // card lying sideways: rotate a quarter turn to portrait
    }
    const M = m(cv.getPerspectiveTransform(
      m(cv.matFromArray(4, 1, cv.CV_32FC2, [...hg, ...hd, ...bd, ...bg])),
      m(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, LARGEUR, 0, LARGEUR, HAUTEUR, 0, HAUTEUR])),
    ));
    const carte = m(new cv.Mat());
    cv.warpPerspective(src, carte, M, new cv.Size(LARGEUR, HAUTEUR));
    const droit = await sharp(Buffer.from(carte.data), { raw: { width: LARGEUR, height: HAUTEUR, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
    return { orientations: [droit, await sharp(droit).rotate(180).toBuffer()], trouve: coins !== null, coins };
  } finally {
    for (const x of mats) x.delete?.();
  }
}
