// Experiments on the query-side robustness to the phone flash (blown-out hotspot on the artwork, holo cards) and on
// the "carte non reconnue" decision. The reference index is unchanged: only the query's fingerprint changes.
// Measured by evaluer.ts and decision.ts, see RAPPORT.md. Retained: patch masking only (REGLAGE) and the rule
// reconnue(); the code to integrate is in vision.patch and reconnaissance.patch. Inpainting (boucher), dehazing
// (devoiler), the trimmed mean (rogne), the neighbour mask (voisins) and the ORB mask were measured and not retained.
import { AutoModel, Tensor } from "@huggingface/transformers";
import sharp from "sharp";
import { JEUX, type Jeu } from "../../commun.ts";
import { DIM, opencv, type Points } from "../../vision.ts";

const MODELE = "onnx-community/dinov2-small";
export const ENTREE = { largeur: 224, hauteur: 308, pas: 14 }; // 16 x 22 patches of 14 px
let dino: Promise<any> | undefined;

// Copy of vision.ts ART (artwork box per game).
export const ART: Record<Jeu, [number, number, number, number]> = {
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

export type Empreinte = Record<Jeu, Float32Array>;

// ---------- Flash hotspot ----------

// The flash clips the sensor: a pixel is blown out when its three channels are >= CLIP. Printed whites (borders,
// highlights) are rarely that pure after a phone's JPEG, and a stray white pixel costs almost nothing below.
export const CLIP = 245;

export type Reglage = { boucher: boolean; masquer: boolean; croissance: number; part: number; rogne: number; devoiler?: boolean; voisins?: boolean };
// Retained setting (RAPPORT.md): the patches that are at least a quarter glare are left out of the artwork mean.
export const REGLAGE: Reglage = { boucher: false, masquer: true, croissance: 3, part: 0.25, rogne: 0 };

// Glare map of a small RGB image: blown-out pixels grown by `croissance` px (the halo and JPEG ringing around the
// clipped core). 255 = glare. Returns null when nothing is blown out.
export async function carteReflet(rgb: Buffer, w: number, h: number, croissance: number): Promise<Uint8Array | null> {
  const m = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (rgb[3 * i] >= CLIP && rgb[3 * i + 1] >= CLIP && rgb[3 * i + 2] >= CLIP) { m[i] = 255; n++; }
  if (!n) return null;
  if (!croissance) return m;
  const { cv } = await opencv();
  const src = cv.matFromArray(h, w, cv.CV_8UC1, m);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * croissance + 1, 2 * croissance + 1));
  cv.dilate(src, src, k);
  const sortie = Uint8Array.from(src.data);
  src.delete(); k.delete();
  return sortie;
}

// Fills the glare with the surrounding colours (OpenCV inpainting): the network then sees a smooth patch instead of a
// bright disc with sharp edges, whose tokens would otherwise leak into the whole image through attention.
export async function boucher(rgb: Buffer, w: number, h: number, masque: Uint8Array): Promise<Buffer> {
  const { cv } = await opencv();
  const src = cv.matFromArray(h, w, cv.CV_8UC3, rgb), m = cv.matFromArray(h, w, cv.CV_8UC1, masque), dst = new cv.Mat();
  cv.inpaint(src, m, dst, 5, cv.INPAINT_TELEA);
  const sortie = Buffer.from(dst.data);
  src.delete(); m.delete(); dst.delete();
  return sortie;
}

// The flash halo around the clipped core is a white veil: I = J t + 255 (1 - t). Dark channel prior: in a picture the
// darkest channel over a small window is near 0, so 1 - t ~ dark(I) / 255, and J = (I - 255 (1 - t)) / t.
// Only near the hotspot (weight = blurred glare map), so a card without glare, or a white artwork far from it, is untouched.
export async function devoiler(rgb: Buffer, w: number, h: number, masque: Uint8Array): Promise<Buffer> {
  const { cv } = await opencv();
  const min = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) min[i] = Math.min(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]);
  const sombre = cv.matFromArray(h, w, cv.CV_8UC1, min), poids = cv.matFromArray(h, w, cv.CV_8UC1, masque);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.erode(sombre, sombre, k);
  cv.GaussianBlur(sombre, sombre, new cv.Size(25, 25), 4);
  cv.GaussianBlur(poids, poids, new cv.Size(121, 121), 30);
  let pmax = 1;
  for (const v of poids.data) pmax = Math.max(pmax, v);
  const sortie = Buffer.alloc(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    const t = Math.max(0.35, 1 - 0.9 * (sombre.data[i] / 255) * Math.min(1, (2 * poids.data[i]) / pmax));
    for (let c = 0; c < 3; c++) sortie[3 * i + c] = Math.max(0, Math.min(255, (rgb[3 * i + c] - 255 * (1 - t)) / t));
  }
  sombre.delete(); poids.delete(); k.delete();
  return sortie;
}

// Share of glare pixels in each 14 px patch, row by row like the tokens.
function partReflet(masque: Uint8Array | null, w: number, h: number, pas: number): Float32Array {
  const gw = Math.floor(w / pas), gh = Math.floor(h / pas);
  const p = new Float32Array(gw * gh);
  if (!masque) return p;
  for (let y = 0; y < gh * pas; y++) for (let x = 0; x < gw * pas; x++) if (masque[y * w + x]) p[Math.floor(y / pas) * gw + Math.floor(x / pas)]++;
  return p.map((v) => v / (pas * pas));
}

// ---------- Fingerprint ----------

export type Jetons = { h: Float32Array; T: number; gw: number; gh: number; reflet: Float32Array[]; ms: number };

// DINOv2 patch tokens of card images (as vision.ts), with the glare map of each image and optionally the glare filled in.
export async function jetons(images: Buffer[], r: Pick<Reglage, "boucher" | "croissance" | "devoiler">): Promise<Jetons> {
  dino ??= AutoModel.from_pretrained(MODELE, { dtype: "fp32" });
  const model = await dino;
  const t0 = performance.now();
  const { largeur, hauteur, pas } = ENTREE;
  const n = largeur * hauteur;
  const x = new Float32Array(images.length * 3 * n);
  const moy = [0.485, 0.456, 0.406], ec = [0.229, 0.224, 0.225]; // ImageNet normalisation
  const reflet: Float32Array[] = [];
  await Promise.all(images.map(async (b, k) => {
    let brut = await sharp(b).resize(largeur, hauteur, { fit: "fill", kernel: "cubic" }).removeAlpha().raw().toBuffer();
    const masque = await carteReflet(brut, largeur, hauteur, r.croissance);
    if (masque && r.devoiler) brut = await devoiler(brut, largeur, hauteur, masque);
    if (masque && r.boucher) brut = await boucher(brut, largeur, hauteur, masque);
    reflet[k] = partReflet(masque, largeur, hauteur, pas);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[k * 3 * n + c * n + i] = (brut[3 * i + c] / 255 - moy[c]) / ec[c];
  }));
  const pre = performance.now() - t0;
  const sortie = (await model({ pixel_values: new Tensor("float32", x, [images.length, 3, hauteur, largeur]) })).last_hidden_state;
  return { h: sortie.data as Float32Array, T: sortie.dims[1], gw: Math.floor(largeur / pas), gh: Math.floor(hauteur / pas), reflet, ms: pre };
}

// Fingerprint of image k: per game, the L2-normalised mean of the patch tokens inside the artwork box, without the
// patches that are at least `part` glare (masquer). If the hotspot covers most of the artwork, all patches are kept.
// rogne > 0: trimmed mean, the share `rogne` of patches farthest from the first mean are dropped (measured, not retained).
export function poolerArt(j: Jetons, k: number, r: Pick<Reglage, "masquer" | "part" | "rogne" | "voisins">): Empreinte {
  const { h, T, gw, gh } = j;
  const debut = T - gw * gh; // CLS first, then the patches row by row
  const art = {} as Empreinte;
  for (const jeu of JEUX) {
    const [x0, y0, x1, y1] = ART[jeu];
    const zone: number[] = [];
    for (let t = 0; t < gw * gh; t++) {
      const cx = ((t % gw) + 0.5) / gw, cy = (Math.floor(t / gw) + 0.5) / gh;
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) zone.push(t);
    }
    // voisins: the 8 neighbours of a glare patch are left out too (halo).
    const eblouie = (t: number) => j.reflet[k][t] >= r.part || (!!r.voisins && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => { const x = (t % gw) + dx, y = Math.floor(t / gw) + dy; return x >= 0 && x < gw && y >= 0 && y < gh && j.reflet[k][y * gw + x] >= r.part; })));
    let garde = r.masquer ? zone.filter((t) => !eblouie(t)) : zone;
    if (garde.length < 0.3 * zone.length) garde = zone;
    const moyenne = (l: number[]) => {
      const v = new Float32Array(DIM);
      for (const t of l) for (let d = 0, o = (k * T + debut + t) * DIM; d < DIM; d++) v[d] += h[o + d];
      return normer(v);
    };
    let v = moyenne(garde);
    if (r.rogne > 0) {
      const proximite = garde.map((t) => { let s = 0; for (let d = 0, o = (k * T + debut + t) * DIM; d < DIM; d++) s += h[o + d] * v[d]; return [t, s]; });
      proximite.sort((a, b) => b[1] - a[1]);
      v = moyenne(proximite.slice(0, Math.ceil(garde.length * (1 - r.rogne))).map(([t]) => t));
    }
    art[jeu] = v;
  }
  return art;
}

// Drop-in for vision.ts empreintes(): same output, glare handled.
export async function empreintes(images: Buffer[], r: Reglage = REGLAGE): Promise<Empreinte[]> {
  const j = await jetons(images, r);
  return images.map((_, k) => poolerArt(j, k, r));
}

// ---------- ORB without the hotspot ----------

// As vision.ts pointsOrb, plus `sansReflet`: no keypoint on or next to blown-out pixels (the rim of the hotspot is
// the strongest corner of a flashed card and matches nothing on the reference). Queries only; references have no glare.
export async function pointsOrb(image: Buffer | string, nb = 500, sansReflet = false): Promise<Points> {
  const { cv } = await opencv();
  const { data, info } = await sharp(image).resize(300, Math.round((300 * 88) / 63), { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const img = cv.matFromArray(info.height, info.width, cv.CV_8UC1, data);
  const orb = new cv.ORB(nb, 1.2, 3, 15, 0, 2, 0, 15, 10);
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const masque = new cv.Mat();
  if (sansReflet) {
    // 255 where the pixel is not blown out, then that region shrunk by 7 px (2 % of the card) around the glare.
    cv.threshold(img, masque, CLIP - 1, 255, cv.THRESH_BINARY_INV);
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15));
    cv.erode(masque, masque, k);
    k.delete();
  }
  orb.detectAndCompute(img, masque, kp, desc);
  const n = kp.size();
  const xy = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { const p = kp.get(i).pt; xy[2 * i] = p.x / info.width; xy[2 * i + 1] = p.y / info.height; }
  const d = new Uint32Array(Uint8Array.from(desc.data).buffer);
  img.delete(); kp.delete(); orb.delete(); desc.delete(); masque.delete();
  return { n, xy, desc: d };
}

// ---------- "Carte non reconnue" ----------

// Evidences of the best candidate after fusion (reconnaissance.ts): fingerprint similarity, ORB matches at the same
// place, text score (name 0-1 + number 0-1). Thresholds calibrated in evaluer.ts --decision (RAPPORT.md).
export const SEUILS = { sim: 0.62, orb: 12, texte: 1.5 };

export function reconnue(c: { sim: number; orb: number; texte: number }, s = SEUILS): boolean {
  return c.sim >= s.sim || c.orb >= s.orb || c.texte >= s.texte;
}
