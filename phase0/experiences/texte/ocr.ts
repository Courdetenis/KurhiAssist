// PaddleOCR on CPU (onnxruntime-node): PP-OCRv5 mobile text detection + PP-OCRv5 latin mobile recognition,
// plus the PP-OCRv5 multilingual (Chinese/Japanese/English) recognizer to spot Japanese cards.
// Input: straightened card as raw RGB. Output: text lines with position (0..1 of the card) and confidence.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ort from "onnxruntime-node";
import sharp from "sharp";

export type Ligne = { texte: string; conf: number; x0: number; y0: number; x1: number; y1: number };
export type Image = { data: Buffer; largeur: number; hauteur: number }; // raw RGB

const modele = (f: string) => fileURLToPath(new URL(`./modeles/${f}`, import.meta.url));
const OPTIONS: ort.InferenceSession.SessionOptions = { intraOpNumThreads: 4, interOpNumThreads: 1 }; // 4 threads: 0.57 s/card vs 1.1 s with 1 (bench)
const sessions = new Map<string, Promise<ort.InferenceSession>>();
const session = (f: string) => sessions.get(f) ?? (sessions.set(f, ort.InferenceSession.create(modele(f), OPTIONS)), sessions.get(f)!);
// CTC classes: 0 = blank, then the dictionary, then space.
function dictionnaire(f: string): string[] {
  const l = fs.readFileSync(modele(f), "utf8").split("\n").map((x) => x.replace(/\r$/, ""));
  if (l.at(-1) === "") l.pop();
  return ["", ...l, " "];
}
const RECS = { latin: { onnx: "latin_rec.onnx", dict: dictionnaire("latin_dict.txt") }, multi: { onnx: "v5_rec.onnx", dict: dictionnaire("v5_dict.txt") } };

// Detection size: multiple of 32, card ratio (bench: 640x896 as good as 736x1024 and faster).
const DW = 640, DH = 896;

export async function detecter(img: Image): Promise<Boite[]> {
  const det = await session("v5_det.onnx");
  const petit = await sharp(img.data, { raw: { width: img.largeur, height: img.hauteur, channels: 3 } })
    .resize(DW, DH, { fit: "fill" }).raw().toBuffer();
  const n = DW * DH;
  const x = new Float32Array(3 * n);
  const moy = [0.485, 0.456, 0.406], et = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[c * n + i] = (petit[i * 3 + 2 - c] / 255 - moy[c]) / et[c]; // BGR like cv2
  const sortie = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, DH, DW]) });
  const p = sortie[det.outputNames[0]].data as Float32Array;

  // DB post-processing, axis-aligned (the card is straightened): threshold, connected components, unclip.
  const vu = new Uint8Array(n);
  const pile = new Int32Array(n);
  const boites = [];
  for (let s = 0; s < n; s++) {
    if (vu[s] || p[s] < 0.3) continue;
    let haut = 0, somme = 0, nb = 0, xa = DW, xb = 0, ya = DH, yb = 0;
    pile[haut++] = s; vu[s] = 1;
    while (haut) {
      const i = pile[--haut];
      const px = i % DW, py = (i / DW) | 0;
      somme += p[i]; nb++;
      if (px < xa) xa = px; if (px > xb) xb = px; if (py < ya) ya = py; if (py > yb) yb = py;
      for (const j of [i - 1, i + 1, i - DW, i + DW]) {
        if (j < 0 || j >= n || vu[j] || p[j] < 0.3 || (j === i - 1 && px === 0) || (j === i + 1 && px === DW - 1)) continue;
        vu[j] = 1; pile[haut++] = j;
      }
    }
    const w = xb - xa + 1, h = yb - ya + 1;
    if (nb < 6 || Math.min(w, h) < 2 || somme / nb < 0.55) continue;
    const d = (w * h * 1.6) / (2 * (w + h)); // unclip ratio 1.6
    boites.push({
      x0: Math.max(0, (xa - d) / DW), y0: Math.max(0, (ya - d) / DH),
      x1: Math.min(1, (xb + 1 + d) / DW), y1: Math.min(1, (yb + 1 + d) / DH),
    });
  }
  return boites;
}

// Bilinear crop of a box (0..1 coordinates) to height 48, normalised CHW BGR, optionally turned 180°.
function decouper(img: Image, b: Boite, retourne: boolean): { x: Float32Array; w: number } {
  const X0 = b.x0 * img.largeur, Y0 = b.y0 * img.hauteur, bw = (b.x1 - b.x0) * img.largeur, bh = (b.y1 - b.y0) * img.hauteur;
  const H = 48, W = Math.max(16, Math.min(1280, Math.round((H * bw) / bh / 8) * 8));
  const x = new Float32Array(3 * H * W);
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const uu = retourne ? W - 1 - u : u, vv = retourne ? H - 1 - v : v;
      const sx = Math.min(img.largeur - 1.001, Math.max(0, X0 + ((uu + 0.5) * bw) / W - 0.5));
      const sy = Math.min(img.hauteur - 1.001, Math.max(0, Y0 + ((vv + 0.5) * bh) / H - 0.5));
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const a = (iy * img.largeur + ix) * 3, bb = a + img.largeur * 3;
      for (let c = 0; c < 3; c++) {
        const val = (img.data[a + c] * (1 - fx) + img.data[a + 3 + c] * fx) * (1 - fy) + (img.data[bb + c] * (1 - fx) + img.data[bb + 3 + c] * fx) * fy;
        x[(2 - c) * H * W + v * W + u] = val / 127.5 - 1;
      }
    }
  }
  return { x, w: W };
}

type Boite = { x0: number; y0: number; x1: number; y1: number };

// One line at a time (padded batches measured ~1.6x slower on CPU), CTC greedy decoding.
export async function reconnaitre(img: Image, boites: Boite[], retourne = false, modeleRec: keyof typeof RECS = "latin"): Promise<{ texte: string; conf: number }[]> {
  const rec = await session(RECS[modeleRec].onnx), DICT = RECS[modeleRec].dict;
  const res: { texte: string; conf: number }[] = [];
  for (const b of boites) {
    const { x, w } = decouper(img, b, retourne);
    const t = (await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, 48, w]) }))[rec.outputNames[0]];
    const [, T, C] = t.dims as number[];
    const p = t.data as Float32Array;
    let texte = "", somme = 0, nb = 0, avant = 0;
    for (let k = 0, o = 0; k < T; k++, o += C) {
      let m = 0;
      for (let c = 1; c < C; c++) if (p[o + c] > p[o + m]) m = c;
      if (m && m !== avant) { texte += DICT[m] ?? ""; somme += p[o + m]; nb++; }
      avant = m;
    }
    res.push({ texte: texte.trim(), conf: nb ? somme / nb : 0 });
  }
  return res;
}

// All text lines of the card. Orientation 0/180: the widest boxes are read both ways, the better reading wins.
export async function lireLignes(carte: Buffer): Promise<{ lignes: Ligne[]; retourne: boolean; kana: number }> {
  const { data, info } = await sharp(carte).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { data, largeur: info.width, hauteur: info.height };
  const boites = await detecter(img);
  const larges = [...boites].sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, 4);
  const somme = (r: { conf: number }[]) => r.reduce((t, x) => t + x.conf, 0);
  const retourne = somme(await reconnaitre(img, larges, true)) > somme(await reconnaitre(img, larges));
  const lus = await reconnaitre(img, boites, retourne);
  const lignes: Ligne[] = [];
  boites.forEach((b, i) => {
    if (!lus[i].texte) return;
    const pos = retourne ? { x0: 1 - b.x1, y0: 1 - b.y1, x1: 1 - b.x0, y1: 1 - b.y0 } : b;
    lignes.push({ ...lus[i], ...pos });
  });
  lignes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  // Japanese check: the lines the latin model reads worst, read again by the multilingual model; kana count.
  const doutes = boites.filter((b, i) => lus[i].conf < 0.85 && b.x1 - b.x0 > 0.04).slice(0, 8);
  const kana = doutes.length < 3 ? 0 : (await reconnaitre(img, doutes, retourne, "multi"))
    .filter((r) => r.conf > 0.7).reduce((n, r) => n + (r.texte.match(/[぀-ヿ]/g)?.length ?? 0), 0);
  return { lignes, retourne, kana };
}
