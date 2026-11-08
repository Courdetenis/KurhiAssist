// Two test sets in the style of banc/generer.ts, closer to the shop's real phone photos (flash straight on, holo
// cards, busy playmat):
//   reflets : indexed cards (4 games) with a blown-out flash hotspot on the artwork, often holo;
//   intrus  : cards of games that are NOT indexed (Magic, Star Wars Unlimited, Digimon, Flesh and Blood,
//             Grand Archive), same conditions, to calibrate "carte non reconnue".
// Source images are kept in sources/ so a rerun does not download again. Writes photos/<set>/*.jpg and photos/<set>.json.
// Usage (from phase0/): node experiences/reflets/generer.ts --set reflets|intrus [--n 160] [--graine 7]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { chargerIndex } from "../../indexer.ts";
import { opencv, type Point } from "../../vision.ts";

const { values: opts } = parseArgs({ options: { set: { type: "string", default: "reflets" }, n: { type: "string", default: "160" }, graine: { type: "string", default: "7" } } });
const DOSSIER = fileURLToPath(new URL(".", import.meta.url));
const N = Number(opts.n);
const W = 1500, H = 2000;
const UA = { "User-Agent": "KurhiAssist-bench/0.1 (local card-scanner test bench, one request at a time)", Accept: "application/json" };
type Calque = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

// Seeded random (mulberry32), as in banc/generer.ts.
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
const choisir = <T>(l: T[]) => l[Math.floor(alea() * l.length)];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Sources ----------

type Source = { jeu: string; id: string; nom: string; url: string | string[]; langue: string }; // urls tried in order

async function json(url: string): Promise<any> {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.json();
}

// Image file kept on disk; `attente` = politeness pause before a real download.
async function image(s: Source, attente: number): Promise<Buffer | null> {
  const f = path.join(DOSSIER, "sources", opts.set!, `${s.jeu}-${s.id.replace(/[^\w.-]/g, "_")}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  await pause(attente);
  let r: Response | null = null;
  for (const url of [s.url].flat()) if (!r?.ok) r = await fetch(url, { headers: { "User-Agent": UA["User-Agent"] } }).catch(() => null);
  if (!r?.ok) return null;
  // Normalised to a portrait JPEG; landscape cards (leaders, bases) are skipped by the callers.
  const img = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: "#fff" }).resize(745, 1040, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer().catch(() => null);
  if (img) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, img); }
  return img;
}

// Indexed cards (the 4 games of the bench, never Lorcana), full size like banc/generer.ts, Pokémon in French when possible.
async function indexees(n: number): Promise<[Source, number][]> {
  const part: Record<string, number> = { pokemon: 0.42, yugioh: 0.25, onepiece: 0.2, riftbound: 0.13 };
  const l: [Source, number][] = [];
  for (const jeu of ["pokemon", "yugioh", "onepiece", "riftbound"] as const) {
    const refs = chargerIndex(jeu)!.refs;
    for (let k = 0; k < Math.round(n * part[jeu]); k++) {
      const r = refs[Math.floor(alea() * refs.length)];
      const url = jeu === "pokemon" ? [r.image.replace("/en/", "/fr/").replace("/low.jpg", "/high.jpg"), r.image.replace("/low.jpg", "/high.jpg")] : jeu === "yugioh" ? r.image.replace("cards_small", "cards") : r.image;
      l.push([{ jeu, id: r.id, nom: r.nom, url, langue: jeu === "pokemon" ? "fr" : "en" }, 0]);
    }
  }
  return l;
}

// Out-of-index games, each from its free public API, one request at a time with a pause.
async function intrus(n: number): Promise<[Source, number][]> {
  const l: [Source, number][] = [];
  const part = { mtg: 0.4, swu: 0.18, digimon: 0.15, fab: 0.15, ga: 0.12 };
  // Magic: Scryfall random card (asks for 50-100 ms between requests), a third in French.
  for (let k = 0; k < Math.round(n * part.mtg); k++) {
    await pause(150);
    const q = encodeURIComponent(k % 3 === 2 ? "lang:fr game:paper -is:oversized" : "game:paper -is:oversized");
    const c = await json(`https://api.scryfall.com/cards/random?q=${q}`).catch(() => null);
    const uris = c?.image_uris ?? c?.card_faces?.[0]?.image_uris;
    if (!uris?.large || ["planar", "scheme", "art_series", "battle"].includes(c.layout)) { k--; continue; }
    l.push([{ jeu: "mtg", id: c.id, nom: c.printed_name ?? c.name, url: uris.large, langue: c.lang }, 100]);
  }
  // Star Wars Unlimited: units, events, upgrades (portrait); leaders and bases are landscape.
  const swu = (await Promise.all(["sor", "shd", "twi", "jtl"].map((s) => json(`https://api.swu-db.com/cards/${s}?format=json`))))
    .flatMap((r) => r.data).filter((c: any) => ["Unit", "Event", "Upgrade"].includes(c.Type) && c.FrontArt);
  for (let k = 0; k < Math.round(n * part.swu); k++) { const c = choisir(swu); l.push([{ jeu: "swu", id: `${c.Set}-${c.Number}`, nom: c.Name, url: c.FrontArt, langue: "en" }, 250]); }
  // Digimon: digimoncard.io allows 15 requests per 10 s.
  const digi = await json("https://digimoncard.io/api-public/getAllCards?sort=name&series=Digimon%20Card%20Game&sortdirection=asc");
  for (let k = 0; k < Math.round(n * part.digimon); k++) { const c = choisir<any>(digi); l.push([{ jeu: "digimon", id: c.cardnumber, nom: c.name, url: `https://images.digimoncard.io/images/cards/${c.cardnumber}.jpg`, langue: "en" }, 800]); }
  // Flesh and Blood: the-fab-cube open card data (one JSON), images on the publisher's CDN; portrait printings only.
  const fab = (await json("https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json"))
    .flatMap((c: any) => c.printings.filter((p: any) => p.image_url && !p.image_rotation_degrees).map((p: any) => ({ nom: c.name, id: p.id + p.foiling, url: p.image_url })));
  for (let k = 0; k < Math.round(n * part.fab); k++) { const c = choisir<any>(fab); l.push([{ jeu: "fab", id: c.id, nom: c.nom, url: c.url, langue: "en" }, 250]); }
  // Grand Archive: official public API.
  for (let k = 0; k < Math.round(n * part.ga); k++) {
    await pause(250);
    const page = await json(`https://api.gatcg.com/cards/search?page=${1 + Math.floor(alea() * 80)}`).catch(() => null);
    const e = page && choisir<any>(page.data)?.editions?.find((x: any) => !x.orientation);
    if (!e) { k--; continue; }
    l.push([{ jeu: "ga", id: e.slug, nom: page.data.find((c: any) => c.editions.includes(e)).name, url: `https://api.gatcg.com${e.image}`, langue: "en" }, 0]);
  }
  return l;
}

// ---------- Card surface: holo foil and flash hotspot ----------

const hsv = (h: number) => [0, 2 / 3, 1 / 3].map((o) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (h + o))); // smooth rainbow, h in 0..1

// The flash itself is returned apart (reflet: white layer, alpha = intensity), to be added after the exposure:
// the sensor clips, so the core stays pure white whatever the exposure.
async function surface(carte: Buffer, tags: string[], pReflet: number): Promise<{ img: Buffer; reflet: Buffer | null; w: number; h: number; marge: number }> {
  const w = 630, h = 880;
  const px = new Float32Array(await sharp(carte).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer());
  const holo = oui(0.6);
  if (holo) {
    // Foil: rainbow sheen bands plus sparkles, on the artwork or on the whole card.
    tags.push("holo");
    const toute = oui(0.3);
    const [x0, y0, x1, y1] = toute ? [0, 0, w, h] : [0.06 * w, 0.08 * h, 0.94 * w, 0.62 * h];
    const a = entre(0, Math.PI), periode = entre(80, 260), force = entre(0.08, 0.22);
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const c = hsv(((x * Math.cos(a) + y * Math.sin(a)) / periode) % 1 + 1);
      for (let k = 0; k < 3; k++) { const i = 3 * (y * w + x) + k; px[i] = px[i] * (1 - force) + 255 * c[k] * force; }
    }
    for (let s = 0; s < entre(800, 4000); s++) {
      const x = Math.floor(entre(x0, x1)), y = Math.floor(entre(y0, y1)), c = hsv(alea()), v = entre(0.4, 1);
      for (let k = 0; k < 3; k++) px[3 * (y * w + x) + k] += 255 * v * (0.5 + 0.5 * c[k]);
    }
  }
  let voile: Uint8Array | null = null;
  if (oui(pReflet)) {
    // Phone flash straight on: clipped white core (pure 255) with a wide soft halo, around the artwork's middle.
    tags.push("flash");
    const cx = entre(0.28, 0.72) * w, cy = entre(0.18, 0.55) * h;
    const r = entre(0.05, 0.15) * w, R = r * entre(2.2, 4.5), A = entre(1.5, 4), B = entre(0.2, 0.65);
    const e = entre(1, 1.5), rot = entre(0, Math.PI);
    if (r > 0.1 * w) tags.push("flash-fort");
    voile = new Uint8Array(4 * w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const u = (dx * Math.cos(rot) + dy * Math.sin(rot)) / e, v = -dx * Math.sin(rot) + dy * Math.cos(rot);
      const d = Math.hypot(u, v);
      const halo = B * Math.exp(-((d / R) ** 2));
      const g = Math.min(1, A * Math.exp(-((d / r) ** 2)) + halo);
      const frange = holo ? hsv((Math.atan2(v, u) / (2 * Math.PI) + d / R) % 1 + 1) : null;
      if (frange) for (let k = 0; k < 3; k++) px[3 * (y * w + x) + k] += 120 * halo * (frange[k] - 0.5);
      voile.set([255, 255, 255, Math.round(255 * g)], 4 * (y * w + x));
    }
  }
  const brut = Buffer.from(px.map((v) => Math.max(0, Math.min(255, v))));
  let img = await sharp(brut, { raw: { width: w, height: h, channels: 3 } }).ensureAlpha().png().toBuffer();
  let reflet = voile && await sharp(voile, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  let marge = 0;
  if (oui(0.3)) {
    tags.push("pochette");
    marge = Math.round(entre(10, 22));
    img = await sharp(img).extend({ top: marge, bottom: marge, left: marge, right: marge, background: { r: 235, g: 238, b: 242, alpha: entre(0.35, 0.7) } }).png().toBuffer();
    if (reflet) reflet = await sharp(reflet).extend({ top: marge, bottom: marge, left: marge, right: marge, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  return { img, reflet, w: w + 2 * marge, h: h + 2 * marge, marge };
}

// ---------- Background: busy playmat ----------

const couleur = () => { const c = hsv(alea()); const v = entre(0.35, 0.95); return `rgb(${c.map((x) => Math.round(255 * v * (0.25 + 0.75 * x))).join(",")})`; };

async function tapis(autre: Buffer | null, tags: string[]): Promise<Buffer> {
  if (autre && oui(0.4)) {
    // Art playmat: another card's artwork blown up to the whole table.
    tags.push("tapis-illustration");
    const m = await sharp(autre).metadata();
    return sharp(autre).extract({ left: Math.round(m.width! * 0.1), top: Math.round(m.height! * 0.1), width: Math.round(m.width! * 0.8), height: Math.round(m.height! * 0.45) })
      .resize(W, H, { fit: "cover" }).blur(entre(2, 6)).modulate({ brightness: entre(0.6, 0.95), saturation: entre(1, 1.4) }).png().toBuffer();
  }
  if (oui(0.2)) {
    // Plain table, as in the bench.
    tags.push("table");
    const b = choisir([[150, 110, 70], [228, 226, 222], [120, 120, 115]]);
    return sharp({ create: { width: W, height: H, channels: 3, background: { r: b[0], g: b[1], b: b[2] } } }).png().toBuffer();
  }
  // Printed playmat: dark saturated base, a few large shapes (balls, rings, blobs), a repeated small icon.
  tags.push("tapis-motifs");
  let corps = `<rect width="100%" height="100%" fill="${couleur()}"/>`;
  const icone = couleur(), pas = entre(120, 260);
  for (let y = 0; y < H + pas; y += pas) for (let x = (y / pas) % 2 ? pas / 2 : 0; x < W + pas; x += pas) {
    corps += `<circle cx="${x}" cy="${y}" r="${pas * 0.22}" fill="none" stroke="${icone}" stroke-width="${pas * 0.06}" opacity="0.5"/>`;
  }
  for (let k = 0; k < entre(2, 6); k++) {
    const cx = entre(-200, W + 200), cy = entre(-200, H + 200), r = entre(250, 900);
    corps += oui(0.5)
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${couleur()}"/><rect x="${cx - r}" y="${cy - r * 0.07}" width="${2 * r}" height="${r * 0.14}" fill="${couleur()}"/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * entre(0.4, 1)}" fill="${couleur()}" transform="rotate(${entre(0, 180)} ${cx} ${cy})" opacity="${entre(0.6, 1)}"/>`;
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${corps}</svg>`)).blur(entre(0.8, 2)).png().toBuffer();
}

// Warps an RGBA image onto the W x H frame at the given corners (as banc/generer.ts).
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

// Phone held above the counter: card fairly large and frontal, small tilt, sometimes upside down or sideways.
function coins(w: number, h: number, tags: string[]): Point[] {
  const hauteur = H * entre(0.42, 0.78);
  const k = hauteur / h;
  let angle = entre(-12, 12);
  if (oui(0.1)) { angle += 180; tags.push("tournee"); } else if (oui(0.08)) { angle += 90; tags.push("tournee"); }
  const p = oui(0.25) ? (tags.push("perspective"), entre(0.06, 0.14)) : entre(0, 0.03);
  const a = (angle * Math.PI) / 180;
  const tour = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [x * k, y * k]).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const ext = Math.max(...tour.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const cx = entre(Math.min(ext, W / 2), Math.max(W - ext, W / 2)), cy = entre(Math.min(ext, H / 2), Math.max(H - ext, H / 2));
  const jeu = p * w * k;
  return tour.map(([x, y]) => [cx + x + entre(-jeu, jeu), cy + y + entre(-jeu, jeu)] as Point);
}

async function photo(carte: Buffer, autre: Buffer | null, tags: string[], pReflet: number) {
  const s = await surface(carte, tags, pReflet);
  const c = coins(s.w, s.h, tags);
  const { cv } = await opencv();
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, s.w, 0, s.w, s.h, 0, s.h]), cv.matFromArray(4, 1, cv.CV_32FC2, c.flat()));
  const m = s.marge;
  const pts = cv.matFromArray(4, 1, cv.CV_32FC2, [m, m, s.w - m, m, s.w - m, s.h - m, m, s.h - m]);
  const vrais = new cv.Mat();
  cv.perspectiveTransform(pts, vrais, M);
  const coinsCarte = Array.from({ length: 4 }, (_, i) => [vrais.data32F[2 * i], vrais.data32F[2 * i + 1]] as Point);
  M.delete(); pts.delete(); vrais.delete();

  const scene = await sharp(await tapis(autre, tags)).composite([{ input: await placer(s.img, s.w, s.h, c) }]).raw().toBuffer({ resolveWithObject: true });
  // Flash falloff: the middle of the frame lit, the corners darker; then exposure, colour cast, blur, noise, JPEG.
  const { data, info } = scene;
  const fx = entre(0.35, 0.65) * W, fy = entre(0.35, 0.65) * H, chute = entre(0.25, 0.5), expo = entre(0.8, 1.1);
  const teinte = oui(0.3) ? [1.05, 0.98, 0.86] : oui(0.3) ? [0.92, 0.98, 1.06] : [1, 1, 1];
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += info.channels) {
    const g = expo * (1 - chute * Math.min(1, Math.hypot(x - fx, y - fy) / Math.hypot(W, H) * 1.6));
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, data[i + k] * g * teinte[k] + (alea() - 0.5) * 10));
  }
  let p = sharp(data, { raw: { width: W, height: H, channels: info.channels } }).removeAlpha();
  if (s.reflet) p = sharp(await p.png().toBuffer()).composite([{ input: await placer(s.reflet, s.w, s.h, c) }]);
  if (oui(0.25)) { tags.push("flou"); p = sharp(await p.png().toBuffer()).blur(entre(0.8, 2.5)); }
  return { jpeg: await p.jpeg({ quality: Math.round(entre(70, 90)) }).toBuffer(), coins: coinsCarte };
}

// ---------- Main ----------

const sortie = path.join(DOSSIER, "photos", opts.set!);
fs.rmSync(sortie, { recursive: true, force: true });
fs.mkdirSync(sortie, { recursive: true });
// A set already built keeps its cards (Scryfall's random cards would differ): images are then read from sources/.
const deja = path.join(DOSSIER, "photos", `${opts.set}.json`);
const liste: [Source, number][] = fs.existsSync(deja) ? JSON.parse(fs.readFileSync(deja, "utf8")).map((v: Source) => [{ ...v, url: [] }, 0])
  : opts.set === "intrus" ? await intrus(N) : await indexees(N);
const verite: any[] = [];
let decor: Buffer | null = null;
for (const [n, [s, attente]] of liste.entries()) {
  const carte = await image(s, attente);
  if (!carte) { console.warn(`  image introuvable : ${s.jeu} ${s.id}`); continue; }
  const tags: string[] = [];
  const { jpeg, coins } = await photo(carte, decor, tags, opts.set === "intrus" ? 0.75 : 1);
  decor = carte; // the previous card's artwork may serve as the next playmat
  const fichier = `${String(n).padStart(3, "0")}-${s.jeu}.jpg`;
  fs.writeFileSync(path.join(sortie, fichier), jpeg);
  verite.push({ fichier, jeu: s.jeu, id: s.id, nom: s.nom, langue: s.langue, coins, tags });
  if (verite.length % 20 === 0) console.log(`${verite.length}/${liste.length}`);
}
fs.writeFileSync(path.join(DOSSIER, "photos", `${opts.set}.json`), JSON.stringify(verite, null, 1));
console.log(`${verite.length} photos dans ${sortie}`);
