// Card image matching, 100 % local: global fingerprint (ViT) over all references, then geometric re-ranking
// of the best candidates with local features (ORB + spatial check). Input: a straightened card, upright or upside down.
import { AutoModel, Tensor, env } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { JEUX, fichierRef, type Jeu, type Ref } from "../../commun.ts";
import { opencv } from "../../vision.ts";

export const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(DOSSIER, "../.."); // phase0/, where references/ lives
env.cacheDir = path.join(DOSSIER, ".cache");

// ---------- Global fingerprint ----------

// One forward pass = one model on the whole card (aspect kept) at one input size. Several poolings come out of it.
export type Passe = { nom: string; modele: string; largeur: number; hauteur: number; pas: number };

export const PASSES: Record<string, Passe> = {
  // 63 x 88 mm -> 16 x 22 patches of 14 px. Retained.
  dv2s_ent: { nom: "dv2s_ent", modele: "onnx-community/dinov2-small", largeur: 224, hauteur: 308, pas: 14 },
  // 14 x 19 patches of 16 px. Screened on the subset only (see RAPPORT.md).
  dv3s_ent: { nom: "dv3s_ent", modele: "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX", largeur: 224, hauteur: 304, pas: 16 },
};

// Artwork box per game, as fractions of the card (x0, y0, x1, y1): the text differs between languages, the art does not.
export const ART: Record<Jeu, [number, number, number, number]> = {
  pokemon: [0.08, 0.1, 0.92, 0.48],
  yugioh: [0.12, 0.18, 0.88, 0.66],
  onepiece: [0.06, 0.06, 0.94, 0.62],
  riftbound: [0.05, 0.05, 0.95, 0.55],
};

const modeles = new Map<string, Promise<any>>();
export const FILS = { n: 0 }; // ONNX threads, 0 = runtime default (all cores)
const charger = (p: Passe) => {
  if (!modeles.has(p.modele)) {
    const session_options = FILS.n ? { intraOpNumThreads: FILS.n, interOpNumThreads: 1 } : {};
    modeles.set(p.modele, AutoModel.from_pretrained(p.modele, { dtype: "fp32", session_options }));
  }
  return modeles.get(p.modele)!;
};

// Whole card -> normalised CHW floats (ImageNet mean/std), optionally turned upside down.
async function pixels(image: Buffer | string, p: Passe, rot180 = false): Promise<Float32Array> {
  const brut = await sharp(image).resize(p.largeur, p.hauteur, { fit: "fill", kernel: "cubic" }).removeAlpha().raw().toBuffer();
  const n = p.largeur * p.hauteur;
  const moy = [0.485, 0.456, 0.406], ec = [0.229, 0.224, 0.225];
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (brut[3 * i + c] / 255 - moy[c]) / ec[c];
  if (rot180) for (let c = 0; c < 3; c++) out.subarray(c * n, (c + 1) * n).reverse(); // half turn of the resized image
  return out;
}

const normer = (v: Float32Array) => {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
};

// Poolings of one pass: CLS token, mean of patch tokens, and mean of patch tokens inside each game's artwork box.
export type Sorties = { cls: Float32Array; moy: Float32Array; art: Record<Jeu, Float32Array> };

export async function encoder(images: (Buffer | string)[], p: Passe, rot180: boolean | boolean[] = false): Promise<Sorties[]> {
  const model = await charger(p);
  const lots = await Promise.all(images.map((im, i) => pixels(im, p, Array.isArray(rot180) ? rot180[i] : rot180)));
  const taille = 3 * p.largeur * p.hauteur;
  const x = new Float32Array(lots.length * taille);
  lots.forEach((l, i) => x.set(l, i * taille));
  const out = await model({ pixel_values: new Tensor("float32", x, [lots.length, 3, p.hauteur, p.largeur]) });
  const h = out.last_hidden_state;
  const [, T, D] = h.dims;
  const gw = Math.floor(p.largeur / p.pas), gh = Math.floor(p.hauteur / p.pas);
  const debut = T - gw * gh; // CLS (+ register tokens) come first
  return lots.map((_, i) => {
    const base = i * T * D;
    const cls = normer(Float32Array.from(h.data.subarray(base, base + D)));
    const moy = new Float32Array(D);
    const art = Object.fromEntries(JEUX.map((j) => [j, new Float32Array(D)])) as Record<Jeu, Float32Array>;
    const boites = JEUX.map((j) => [ART[j][0] * gw, ART[j][1] * gh, ART[j][2] * gw, ART[j][3] * gh]);
    for (let t = 0; t < gw * gh; t++) {
      const o = base + (debut + t) * D;
      const cx = (t % gw) + 0.5, cy = Math.floor(t / gw) + 0.5;
      for (let d = 0; d < D; d++) moy[d] += h.data[o + d];
      JEUX.forEach((j, k) => {
        const [x0, y0, x1, y1] = boites[k];
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) for (let d = 0; d < D; d++) art[j][d] += h.data[o + d];
      });
    }
    for (const j of JEUX) normer(art[j]);
    return { cls, moy: normer(moy), art };
  });
}

// ---------- Index ----------

// Index of one pass: per game, the refs (same order as the project's index/<jeu>.json) and 3 blocks of D floats
// per ref [cls | moy | art]. Built by indexer.ts into index/<pass>/.
export type Index = { refs: Ref[]; D: number; vecteurs: Float32Array };

export function chargerIndexPasse(passe: string, sousDossier = "index"): Index | null {
  const refs: Ref[] = [];
  const blocs: Float32Array[] = [];
  let D = 0;
  for (const jeu of JEUX) {
    const f = path.join(DOSSIER, sousDossier, passe, `${jeu}.bin`);
    if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f);
    const r: Ref[] = JSON.parse(fs.readFileSync(f.replace(/\.bin$/, ".json"), "utf8"));
    const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    D = v.length / r.length / 3;
    refs.push(...r);
    blocs.push(v);
  }
  if (!refs.length) return null;
  const vecteurs = new Float32Array(refs.length * 3 * D);
  blocs.reduce((o, b) => (vecteurs.set(b, o), o + b.length), 0);
  return { refs, D, vecteurs };
}

// Similarity of the query to every ref: weighted sum of the cls, moy and art (same game box) dot products.
export function similarites(ix: Index, q: Sorties, poids: [number, number, number]): Float32Array {
  const { refs, D, vecteurs } = ix;
  const sims = new Float32Array(refs.length);
  for (let i = 0; i < refs.length; i++) {
    const b = i * 3 * D;
    const qa = q.art[refs[i].jeu];
    let s = 0;
    if (poids[0]) { let a = 0; for (let d = 0; d < D; d++) a += q.cls[d] * vecteurs[b + d]; s += poids[0] * a; }
    if (poids[1]) { let a = 0; for (let d = 0; d < D; d++) a += q.moy[d] * vecteurs[b + D + d]; s += poids[1] * a; }
    if (poids[2]) { let a = 0; for (let d = 0; d < D; d++) a += qa[d] * vecteurs[b + 2 * D + d]; s += poids[2] * a; }
    sims[i] = s;
  }
  return sims;
}

export function meilleurs(sims: Float32Array, k: number): number[] {
  const ordre: number[] = [];
  for (let i = 0; i < sims.length; i++) {
    if (ordre.length < k || sims[i] > sims[ordre[ordre.length - 1]]) {
      let j = ordre.length < k ? ordre.length : k - 1;
      while (j > 0 && sims[ordre[j - 1]] < sims[i]) { ordre[j] = ordre[j - 1]; j--; }
      ordre[j] = i;
    }
  }
  return ordre;
}

// ---------- Geometric re-ranking ----------

// Straightened cards are aligned with their reference up to outline error, so a local match is kept only when
// its two keypoints sit at about the same place on both cards (or at mirrored places for an upside-down card).
export const ORB_LARGEUR = 300;
export type Points = { n: number; xy: Float32Array; desc: Uint32Array }; // 8 words (256 bits) per keypoint

export async function pointsOrb(image: Buffer | string, nb = 500): Promise<Points> {
  const { cv } = await opencv();
  const { data, info } = await sharp(image).resize(ORB_LARGEUR, Math.round(ORB_LARGEUR * 88 / 63), { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
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

export const pointsVersOctets = (p: Points) => Buffer.concat([Buffer.from(Int32Array.of(p.n).buffer), Buffer.from(p.xy.buffer), Buffer.from(p.desc.buffer)]);
export function octetsVersPoints(b: Buffer): Points {
  const a = new Uint8Array(b).buffer;
  const n = new Int32Array(a, 0, 1)[0];
  return { n, xy: new Float32Array(a, 4, 2 * n), desc: new Uint32Array(a, 4 + 8 * n, 8 * n) };
}

const bits = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
};

// Guided matching: each query keypoint is compared only with reference keypoints within `tol` (fraction of the
// card) of the same place, or of the mirrored place for an upside-down card. Counts matches with Hamming
// distance <= seuil and a clear lead over the next neighbour; best of the two orientations.
// `boite` keeps only reference keypoints inside that box (the artwork: frames are shared by a whole layout).
export function accords(q: Points, r: Points, tol = 0.05, seuil = 64, boite?: [number, number, number, number], ratio = 0.9): number {
  const G = Math.ceil(1 / tol);
  const cases: number[][] = Array.from({ length: G * G }, () => []);
  const cel = (v: number) => Math.min(G - 1, Math.max(0, Math.floor(v * G)));
  for (let j = 0; j < r.n; j++) {
    const x = r.xy[2 * j], y = r.xy[2 * j + 1];
    if (!boite || (x >= boite[0] && x <= boite[2] && y >= boite[1] && y <= boite[3])) cases[cel(y) * G + cel(x)].push(j);
  }
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

export const imageRef = (r: Pick<Ref, "jeu" | "id">) => path.join(RACINE, fichierRef(r));

// ---------- Query ----------

// Retained setting (see RAPPORT.md): DINOv2-small on the whole card with its aspect kept, similarity on the
// artwork-box mean of patch tokens, then guided ORB on the whole card of the top K_ORB candidates (frame and text
// keypoints help: ORB restricted to the artwork measured worse).
export const PASSE = PASSES.dv2s_ent;
export const POIDS: [number, number, number] = [0, 0, 1];
export const K_ORB = 20;
export const ORB = { tol: 0.07, seuil: 48, beta: 0.2, cap: 200 };
let ix: Index | null = null;

export async function identifierImage(carte: Buffer, k = 10): Promise<{ candidats: { jeu: string; id: string; score: number }[]; ms: number }> {
  const t0 = performance.now();
  ix ??= chargerIndexPasse(PASSE.nom);
  if (!ix) throw new Error("Index absent : node experiences/correspondance/indexer.ts");
  const [s0, s1] = await encoder([carte, carte], PASSE, [false, true]); // upright and upside down
  const sims = similarites(ix, s0, POIDS);
  const s180 = similarites(ix, s1, POIDS);
  for (let i = 0; i < sims.length; i++) sims[i] = Math.max(sims[i], s180[i]);
  const top = meilleurs(sims, Math.max(k, K_ORB));
  // Geometric re-ranking: ORB is rotation-invariant and accords() checks both orientations.
  const [q, ...refsOrb] = await Promise.all([pointsOrb(carte), ...top.slice(0, K_ORB).map((i) => pointsOrb(imageRef(ix!.refs[i])))]);
  const candidats = top.map((i, n) => {
    const r = ix!.refs[i];
    const acc = n < K_ORB ? accords(q, refsOrb[n], ORB.tol, ORB.seuil) : 0;
    return { jeu: r.jeu, id: r.id, score: sims[i] + ORB.beta * Math.min(acc, ORB.cap) / ORB.cap };
  }).sort((a, b) => b.score - a.score);
  return { candidats: candidats.slice(0, k), ms: Math.round(performance.now() - t0) };
}
