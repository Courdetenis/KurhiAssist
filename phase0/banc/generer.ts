// Builds a hard, measurable test bench: card images degraded like counter phone photos (perspective, glare,
// sleeve, blur, dim light, small card, light or cluttered background), with known card, language and corners.
// Query images are fetched from the sources at full size (French text for Pokémon when it exists), not the
// 300 px reference copies, so a match is not a lookup of the same file.
// Usage (from phase0/): node banc/generer.ts [--n 240] [--graine 1]
// Adding a game to an existing bench: node banc/generer.ts --jeux lorcana --ajouter (appends to banc/verite.json).
import fs from "node:fs";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { JEUX, type Jeu, type Ref } from "../commun.ts";
import { chargerIndex } from "../indexer.ts";
import { opencv, type Point } from "../vision.ts";

const { values: opts } = parseArgs({
  options: { n: { type: "string", default: "240" }, graine: { type: "string", default: "1" }, jeux: { type: "string", default: JEUX.join(",") }, ajouter: { type: "boolean", default: false } },
});
const N = Number(opts.n);
const PART: Record<Jeu, number> = { pokemon: 0.42, yugioh: 0.25, onepiece: 0.2, riftbound: 0.13, lorcana: 0.13 };
type Calque = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];
const W = 1500;
const H = 2000;

// Seeded random (mulberry32): the same seed always builds the same bench.
let etat = Number(opts.graine) >>> 0;
const alea = () => {
  etat = (etat + 0x6d2b79f5) >>> 0;
  let t = etat;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a: number, b: number) => a + alea() * (b - a);
const oui = (p: number) => alea() < p;

// Query image at full size; Pokémon in French when TCGdex has it (the index holds the English scans).
async function imageRequete(r: Ref): Promise<{ image: Buffer; langue: string } | null> {
  const essais: [string, string][] =
    r.jeu === "pokemon" ? [[r.image.replace("/en/", "/fr/").replace("/low.jpg", "/high.jpg"), "fr"], [r.image.replace("/low.jpg", "/high.jpg"), "en"]]
    : r.jeu === "yugioh" ? [[r.image.replace("cards_small", "cards"), "en"]]
    : r.jeu === "lorcana" ? [[r.image.replace("/normal/", "/large/"), "en"]]
    : [[r.image, "en"]];
  for (const [url, langue] of essais) {
    const rep = await fetch(url).catch(() => null);
    if (rep?.ok) return { image: Buffer.from(await rep.arrayBuffer()), langue };
  }
  return null;
}

const svg = (corps: string, w: number, h: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corps}</svg>`);

// Card surface effects, applied before the geometry: glare spot, holo sheen, sleeve.
async function surface(carte: Buffer, tags: string[]): Promise<{ img: Buffer; w: number; h: number; marge: number }> {
  const w = 630, h = 880;
  const calques: Calque[] = [];
  if (oui(0.4)) {
    tags.push("reflet");
    const cx = entre(0.2, 0.8) * w, cy = entre(0.15, 0.85) * h, r = entre(80, 220);
    calques.push({ input: svg(`<defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="${entre(0.75, 0.98)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${r * entre(1, 2)}" ry="${r}" fill="url(#g)" transform="rotate(${entre(-40, 40)} ${cx} ${cy})"/>`, w, h) });
  }
  if (oui(0.3)) {
    tags.push("holo");
    calques.push({ input: svg(`<defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0f"/><stop offset=".33" stop-color="#0ff"/><stop offset=".66" stop-color="#ff0"/><stop offset="1" stop-color="#f0f"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#h)" opacity="${entre(0.12, 0.25)}"/>`, w, h), blend: "overlay" });
  }
  let img = await sharp(carte).resize(w, h, { fit: "fill" }).ensureAlpha().composite(calques).png().toBuffer();
  let marge = 0;
  if (oui(0.35)) {
    // Sleeve: a slightly larger glossy pocket around the card, whose own edge competes with the card's.
    tags.push("pochette");
    marge = Math.round(entre(10, 22));
    img = await sharp(img).extend({ top: marge, bottom: marge, left: marge, right: marge, background: { r: 235, g: 238, b: 242, alpha: entre(0.35, 0.7) } })
      .composite([{ input: svg(`<rect width="100%" height="100%" fill="#fff" opacity="${entre(0.05, 0.15)}"/>`, w + 2 * marge, h + 2 * marge) }]).png().toBuffer();
  }
  return { img, w: w + 2 * marge, h: h + 2 * marge, marge };
}

async function fond(type: string): Promise<Buffer> {
  const px = Buffer.alloc(W * H * 3);
  const [base, ampl, rayures] =
    type === "bois" ? [[150, 110, 70], 30, true]
    : type === "tapis" ? [[30, 40, 60], 18, false]
    : type === "clair" ? [[228, 226, 222], 10, false] // white table: low contrast against white borders
    : [[120, 120, 115], 40, false];
  for (let i = 0, y = 0; y < H; y++) {
    const r = rayures ? Math.sin(y / entre(6, 9)) * 12 : 0;
    for (let x = 0; x < W; x++, i += 3) {
      const n = (alea() - 0.5) * (ampl as number) + r;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, (base as number[])[c] + n));
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).blur(1.2).png().toBuffer();
}

// Warps an RGBA image onto the W x H frame at the given corners; returns a transparent full-frame PNG.
async function placer(img: Buffer, w: number, h: number, dst: Point[]): Promise<Buffer> {
  const { cv } = await opencv();
  const { data } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromArray(h, w, cv.CV_8UC4, data);
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]), cv.matFromArray(4, 1, cv.CV_32FC2, dst.flat()));
  const sortie = new cv.Mat();
  cv.warpPerspective(src, sortie, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
  const png = await sharp(Buffer.from(sortie.data), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  src.delete(); M.delete(); sortie.delete();
  return png;
}

// Card corners in the frame: scale, centre, rotation, then perspective (each corner pulled by up to `p` of the width).
function coinsAleatoires(w: number, h: number, tags: string[]): Point[] {
  const petite = oui(0.25);
  if (petite) tags.push("petite");
  const hauteur = H * (petite ? entre(0.28, 0.4) : entre(0.5, 0.82));
  const k = hauteur / h;
  let angle = entre(-25, 25);
  if (oui(0.15)) { angle += oui(0.5) ? 90 : 180; tags.push("tournee"); }
  const p = oui(0.45) ? (tags.push("perspective"), entre(0.08, 0.2)) : entre(0, 0.03);
  const a = (angle * Math.PI) / 180;
  const demi = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [x * k, y * k]);
  const tour = demi.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const ext = Math.max(...tour.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const cx = entre(Math.min(ext, W / 2), Math.max(W - ext, W / 2));
  const cy = entre(Math.min(ext, H / 2), Math.max(H - ext, H / 2));
  const jeu = p * w * k;
  return tour.map(([x, y]) => [cx + x + entre(-jeu, jeu), cy + y + entre(-jeu, jeu)] as Point);
}

async function photo(r: Ref, image: Buffer, tags: string[], autre: Buffer | null) {
  const s = await surface(image, tags);
  const coinsPochette = coinsAleatoires(s.w, s.h, tags);
  // Ground truth = the card's own corners, inside the sleeve margin.
  const { cv } = await opencv();
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, s.w, 0, s.w, s.h, 0, s.h]), cv.matFromArray(4, 1, cv.CV_32FC2, coinsPochette.flat()));
  const m = s.marge;
  const pts = cv.matFromArray(4, 1, cv.CV_32FC2, [m, m, s.w - m, m, s.w - m, s.h - m, m, s.h - m]);
  const vrais = new cv.Mat();
  cv.perspectiveTransform(pts, vrais, M);
  const coins = Array.from({ length: 4 }, (_, i) => [vrais.data32F[2 * i], vrais.data32F[2 * i + 1]] as Point);
  M.delete(); pts.delete(); vrais.delete();

  const typeFond = ["bois", "tapis", "clair", "gris"][Math.floor(alea() * 4)];
  tags.push(`fond-${typeFond}`);
  const calques: Calque[] = [];
  if (autre && oui(0.3)) {
    // Clutter: another card half out of the frame.
    tags.push("encombre");
    const x = oui(0.5) ? entre(-300, -100) : entre(W - 350, W - 150), y = entre(0, H - 900);
    calques.push({ input: await placer(await sharp(autre).resize(630, 880, { fit: "fill" }).png().toBuffer(), 630, 880, [[x, y], [x + 600, y + 60], [x + 540, y + 900], [x - 60, y + 840]]) });
  }
  calques.push({ input: await placer(s.img, s.w, s.h, coinsPochette) });
  let p = sharp(await fond(typeFond)).composite(calques);
  const sombre = oui(0.3);
  if (sombre) tags.push("sombre");
  p = sharp(await p.png().toBuffer()).modulate({ brightness: sombre ? entre(0.45, 0.7) : entre(0.85, 1.15), saturation: entre(0.8, 1.15) });
  if (oui(0.3)) { tags.push("lumiere-chaude"); p = sharp(await p.png().toBuffer()).linear([1.06, 0.97, 0.82], [0, 0, 0]); }
  if (oui(0.35)) { tags.push("flou"); p = sharp(await p.png().toBuffer()).blur(entre(1.5, 3.5)); }
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  const bruit = sombre ? 18 : 8;
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + (alea() - 0.5) * bruit));
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: Math.round(entre(65, 88)) }).toBuffer();
  return { jpeg, coins };
}

fs.mkdirSync("banc/photos", { recursive: true });
const jeux = opts.jeux.split(",") as Jeu[];
const verite: any[] = opts.ajouter ? JSON.parse(fs.readFileSync("banc/verite.json", "utf8")) : [];
const index = Object.fromEntries(jeux.map((j) => [j, chargerIndex(j)!.refs]));
let n = verite.length;
for (const jeu of jeux) {
  const cible = Math.round(N * PART[jeu]);
  let faits = 0;
  while (faits < cible) {
    const refs = index[jeu];
    const r = refs[Math.floor(alea() * refs.length)];
    const req = await imageRequete(r);
    if (!req) continue;
    const autre = oui(0.5) ? (await imageRequete(refs[Math.floor(alea() * refs.length)]))?.image ?? null : null;
    const tags: string[] = [];
    const { jpeg, coins } = await photo(r, req.image, tags, autre);
    const fichier = `${String(n).padStart(3, "0")}-${jeu}.jpg`;
    fs.writeFileSync(`banc/photos/${fichier}`, jpeg);
    verite.push({ fichier, jeu, id: r.id, nom: r.nom, langue: req.langue, coins, tags });
    n++; faits++;
    if (n % 20 === 0) console.log(`${n} photos`);
  }
}
fs.writeFileSync("banc/verite.json", JSON.stringify(verite, null, 1));
console.log(`${verite.length} photos dans banc/photos, réponses dans banc/verite.json`);
