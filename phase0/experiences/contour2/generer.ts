// Realistic synthetic set for the card outline: phone-with-flash photos of a card lying on a busy playmat.
// Printed mats (dark purple with big light shapes, a big red blob with white and black outline), artwork mats
// (upscaled reference art), colourful patterns with straight lines, plain tables; fabric weave; flash vignetting.
// Cards: Lorcana (black border), dark Yu-Gi-Oh! frames, Pokémon, One Piece, Riftbound, with rounded corners,
// flash glare hotspot, holo streaks, sleeve, drop shadow, rotation, mild perspective, card at 20-60 % of the width.
// Ground truth = the card's sharp corners (where the sides meet), as annotated on the real scans.
// Ideas from banc/generer.ts (not imported: that file runs on import).
// Usage (from phase0/): node experiences/contour2/generer.ts [--n 180] [--graine 7] [--dossier experiences/contour2/photos] [--verite experiences/contour2/verite.json]
// Test set: the defaults. Training set for apprendre.ts: --n 300 --graine 11 --dossier experiences/contour2/photos-app --verite experiences/contour2/verite-app.json
import fs from "node:fs";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { opencv, type Point } from "../../vision.ts";

const { values: opts } = parseArgs({ options: {
  n: { type: "string", default: "180" }, graine: { type: "string", default: "7" },
  dossier: { type: "string", default: "experiences/contour2/photos" }, verite: { type: "string", default: "experiences/contour2/verite.json" },
} });
const N = Number(opts.n);
const W = 1500, H = 2000;
const DOSSIER = opts.dossier!;
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
const choix = <T>(v: T[]) => v[Math.floor(alea() * v.length)];
const svg = (corps: string, w = W, h = H) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corps}</svg>`);
const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(",")})`;

const REFS = Object.fromEntries(["pokemon", "yugioh", "onepiece", "riftbound"].map((j) => [j, fs.readdirSync(`references/${j}`).filter((f) => f.endsWith(".jpg")).map((f) => `references/${j}/${f}`)]));
REFS.lorcana = fs.readdirSync("experiences/contour2/lorcana").map((f) => `experiences/contour2/lorcana/${f}`);

// Mean brightness of the outer 2/30 of a card image: the frame colour.
async function bordure(f: string): Promise<number> {
  const { data } = await sharp(f).resize(30, 42, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let s = 0, n = 0;
  for (let y = 0; y < 42; y++) for (let x = 0; x < 30; x++) {
    if (x > 1 && x < 28 && y > 1 && y < 40) continue;
    s += data[3 * (y * 30 + x)] + data[3 * (y * 30 + x) + 1] + data[3 * (y * 30 + x) + 2];
    n += 3;
  }
  return s / n;
}

// ---------- Backgrounds ----------

// Organic closed blob around (cx, cy): a smooth path through jittered points on an ellipse.
function blob(cx: number, cy: number, rx: number, ry: number): string {
  const n = 7, pts: Point[] = [];
  const rot = entre(0, Math.PI);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, k = entre(0.75, 1.2);
    const x = rx * k * Math.cos(a), y = ry * k * Math.sin(a);
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  // Catmull-Rom to cubic Bezier, closed.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d + "Z";
}

// Dark mat with big printed shapes, like the shop's Pokémon mat.
function tapisImprime(): Buffer {
  const base = choix([[52, 45, 88], [40, 38, 75], [30, 30, 45], [25, 45, 70], [60, 30, 60], [20, 20, 25]]).map((v) => v * entre(0.8, 1.2));
  const clair = base.map((v) => v + entre(25, 60));
  let s = `<rect width="${W}" height="${H}" fill="${rgb(base)}"/>`;
  // Light outlined "balls" and small motifs, low contrast.
  for (let i = 0, n = Math.floor(entre(3, 9)); i < n; i++) {
    const cx = entre(-100, W + 100), cy = entre(-100, H + 100), r = entre(80, 260), e = r * entre(0.08, 0.16);
    s += `<g fill="none" stroke="${rgb(clair)}" stroke-width="${e}"><circle cx="${cx}" cy="${cy}" r="${r}"/><line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.3}"/></g>`;
  }
  for (let i = 0, n = Math.floor(entre(4, 14)); i < n; i++) s += `<path d="${blob(entre(0, W), entre(0, H), entre(30, 120), entre(30, 120))}" fill="${rgb(clair)}" opacity="${entre(0.4, 0.9)}"/>`;
  // One or two big saturated blobs with a white then black outline.
  for (let i = 0, n = oui(0.8) ? (oui(0.3) ? 2 : 1) : 0; i < n; i++) {
    const d = blob(entre(-0.2, 0.6) * W, entre(-0.1, 1.1) * H, entre(0.35, 0.8) * W, entre(0.3, 0.6) * H);
    const coul = choix([[225, 70, 75], [235, 95, 110], [240, 140, 60], [230, 200, 70], [90, 170, 220], [235, 235, 235]]);
    const e = entre(25, 50);
    s += `<path d="${d}" fill="none" stroke="#141218" stroke-width="${2.6 * e}"/><path d="${d}" fill="none" stroke="${rgb([235, 232, 240])}" stroke-width="${1.6 * e}"/><path d="${d}" fill="${rgb(coul)}"/>`;
  }
  return svg(s);
}

// Playmat printed with an artwork: reference art upscaled to the frame, sometimes two blended.
async function tapisIllustration(): Promise<Buffer> {
  const art = async () => {
    const f = choix(REFS[choix(["pokemon", "yugioh", "onepiece", "riftbound", "lorcana"])]);
    const m = await sharp(f).metadata();
    const box = { left: Math.round(0.08 * m.width!), top: Math.round(0.1 * m.height!), width: Math.round(0.84 * m.width!), height: Math.round(0.4 * m.height!) };
    return sharp(f).extract(box).resize(W, H, { fit: "cover", kernel: "cubic" }).modulate({ brightness: entre(0.6, 1), saturation: entre(0.8, 1.3) }).png().toBuffer();
  };
  const a = await art();
  if (oui(0.5)) return a;
  return sharp(a).composite([{ input: await sharp(await art()).ensureAlpha(entre(0.3, 0.6)).png().toBuffer() }]).png().toBuffer();
}

// Colourful patterns, with straight edges that compete with the card's.
function motifs(): Buffer {
  const pal = Array.from({ length: 4 }, () => [entre(20, 240), entre(20, 240), entre(20, 240)]);
  let s = `<rect width="${W}" height="${H}" fill="${rgb(pal[0])}"/>`;
  const type = choix(["rayures", "damier", "pois", "polygones"]);
  const rot = entre(-60, 60), p = entre(60, 260);
  if (type === "rayures") for (let x = -2 * H; x < 2 * H; x += p) s += `<rect x="${x}" y="${-2 * H}" width="${p * entre(0.3, 0.6)}" height="${4 * H}" fill="${rgb(choix(pal.slice(1)))}" transform="rotate(${rot} ${W / 2} ${H / 2})"/>`;
  if (type === "damier") for (let x = -H; x < 2 * H; x += p) for (let y = -H; y < 2 * H; y += p) if (((x + y) / p) % 2 === 0) s += `<rect x="${x}" y="${y}" width="${p}" height="${p}" fill="${rgb(pal[1])}" transform="rotate(${rot} ${W / 2} ${H / 2})"/>`;
  if (type === "pois") for (let x = 0; x < W + p; x += p) for (let y = 0; y < H + p; y += p) s += `<circle cx="${x + ((y / p) % 2) * p / 2}" cy="${y}" r="${p * entre(0.15, 0.35)}" fill="${rgb(choix(pal.slice(1)))}"/>`;
  if (type === "polygones") for (let i = 0; i < 25; i++) {
    const cx = entre(0, W), cy = entre(0, H), r = entre(80, 500), k = Math.floor(entre(3, 7)), a0 = entre(0, 6);
    s += `<polygon points="${Array.from({ length: k }, (_, j) => [cx + r * Math.cos(a0 + (2 * Math.PI * j) / k), cy + r * Math.sin(a0 + (2 * Math.PI * j) / k)].join(",")).join(" ")}" fill="${rgb(choix(pal))}" opacity="${entre(0.6, 1)}"/>`;
  }
  return svg(s);
}

function uni(): Buffer {
  const c = choix([[150, 110, 70], [120, 120, 115], [228, 226, 222], [35, 40, 55], [20, 60, 40]]);
  return svg(`<rect width="${W}" height="${H}" fill="${rgb(c.map((v) => v * entre(0.85, 1.1)))}"/>`);
}

// Fabric weave plus fine noise, as a multiplier around 1.
function tissage(px: Buffer, force: number) {
  const p = entre(5, 9), a = entre(0, Math.PI);
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 3) {
    const u = (x * ca + y * sa) / p, v = (-x * sa + y * ca) / p;
    const f = 1 + force * (0.5 * Math.sin(2 * Math.PI * u) * Math.sin(2 * Math.PI * v) + (alea() - 0.5));
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, px[i + c] * f));
  }
}

// ---------- Card ----------

async function carte(tags: string[]): Promise<{ img: Buffer; w: number; h: number; marge: number }> {
  const jeu = choix(["lorcana", "lorcana", "lorcana", "yugioh", "yugioh", "yugioh", "pokemon", "pokemon", "pokemon", "onepiece", "riftbound"]);
  let f = choix(REFS[jeu]);
  if (jeu === "yugioh" && oui(0.6)) for (let i = 0; i < 80 && (await bordure(f)) > 85; i++) f = choix(REFS.yugioh); // dark frame
  tags.push(jeu);
  if ((await bordure(f)) < 70) tags.push("bord-sombre");
  const w = 630, h = 880, r = Math.round(entre(0.035, 0.055) * w); // rounded corners
  const calques: Calque[] = [];
  if (oui(0.4)) {
    // Holo: diagonal rainbow streaks with sharp sides, plus sparkles.
    tags.push("holo");
    const a = entre(25, 65) * (oui(0.5) ? 1 : -1), p = entre(40, 140);
    let bandes = "";
    for (let x = -2 * h; x < 2 * h; x += p * entre(1, 2.5)) {
      const k = Math.floor(entre(0, 4));
      bandes += `<rect x="${x}" y="${-2 * h}" width="${p * entre(0.2, 0.6)}" height="${4 * h}" fill="${["#f0f", "#0ff", "#ff0", "#fff"][k]}" opacity="${entre(0.25, 0.6)}" transform="rotate(${a} ${w / 2} ${h / 2})"/>`;
    }
    calques.push({ input: svg(bandes, w, h), blend: "screen" });
    let etincelles = "";
    for (let i = 0; i < 60; i++) etincelles += `<circle cx="${entre(0, w)}" cy="${entre(0, h)}" r="${entre(1, 4)}" fill="#fff" opacity="${entre(0.4, 1)}"/>`;
    calques.push({ input: svg(etincelles, w, h) });
  }
  if (oui(0.7)) {
    // Flash glare: a saturated white core with a wide halo, usually on the art.
    tags.push("reflet");
    const cx = entre(0.15, 0.85) * w, cy = (oui(0.8) ? entre(0.15, 0.6) : entre(0.05, 0.95)) * h, rr = entre(0.12, 0.35) * w;
    calques.push({ input: svg(`<defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="${entre(0.15, 0.35)}" stop-color="#fff" stop-opacity="${entre(0.85, 1)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${rr * entre(1, 1.5)}" ry="${rr}" fill="url(#g)"/>`, w, h) });
  }
  const masque = svg(`<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`, w, h);
  let img = await sharp(f).resize(w, h, { fit: "fill", kernel: "cubic" }).removeAlpha().composite(calques).png().toBuffer();
  img = await sharp(img).ensureAlpha().composite([{ input: masque, blend: "dest-in" }]).png().toBuffer();
  let marge = 0;
  if (oui(0.25)) {
    // Sleeve: glossy, slightly larger pocket with its own rounded corners.
    tags.push("pochette");
    marge = Math.round(entre(8, 18));
    const ws = w + 2 * marge, hs = h + 2 * marge;
    const poche = svg(`<rect width="${ws}" height="${hs}" rx="${r + marge}" ry="${r + marge}" fill="rgb(235,238,242)" fill-opacity="${entre(0.25, 0.6)}"/>`, ws, hs);
    img = await sharp(poche).composite([{ input: img, left: marge, top: marge }, { input: svg(`<rect width="${ws}" height="${hs}" rx="${r + marge}" fill="#fff" opacity="${entre(0.04, 0.12)}"/>`, ws, hs) }]).png().toBuffer();
  }
  return { img, w: w + 2 * marge, h: h + 2 * marge, marge };
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

// Corners of a w x h card in the frame: width 20-60 % of the frame, rotation, mild perspective.
function coinsAleatoires(w: number, h: number, tags: string[]): Point[] {
  const largeur = W * entre(0.2, 0.6);
  if (largeur < 0.3 * W) tags.push("petite");
  const k = largeur / w;
  let angle = oui(0.7) ? entre(-12, 12) : entre(-45, 45);
  if (Math.abs(angle) > 12) tags.push("tournee");
  if (oui(0.1)) { angle += 90; tags.push("couchee"); }
  const p = oui(0.4) ? (tags.push("perspective"), entre(0.04, 0.1)) : entre(0, 0.02);
  const a = (angle * Math.PI) / 180;
  const demi = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [x * k, y * k]);
  const tour = demi.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const ex = Math.max(...tour.map(([x]) => Math.abs(x))) * 1.12, ey = Math.max(...tour.map(([, y]) => Math.abs(y))) * 1.12;
  // Framed by hand: near the centre, fully inside.
  const pres = (c: number, e: number, L: number) => Math.min(Math.max(c, Math.min(e, L / 2)), Math.max(L - e, L / 2));
  const cx = pres(W / 2 + (entre(-1, 1) + entre(-1, 1)) * 0.15 * W, ex, W), cy = pres(H / 2 + (entre(-1, 1) + entre(-1, 1)) * 0.12 * H, ey, H);
  const jeu = p * w * k;
  return tour.map(([x, y]) => [cx + x + entre(-jeu, jeu), cy + y + entre(-jeu, jeu)] as Point);
}

async function photo(tags: string[]) {
  const typeFond = choix(["imprime", "imprime", "imprime", "illustration", "illustration", "motifs", "uni"]);
  tags.push(`fond-${typeFond}`);
  let fond = typeFond === "imprime" ? tapisImprime() : typeFond === "illustration" ? await tapisIllustration() : typeFond === "motifs" ? motifs() : uni();
  const brut = await sharp(fond).resize(W, H).removeAlpha().raw().toBuffer();
  tissage(brut, typeFond === "uni" ? entre(0.03, 0.1) : entre(0.08, 0.25));
  fond = await sharp(brut, { raw: { width: W, height: H, channels: 3 } }).blur(entre(0.6, 1.2)).png().toBuffer();

  const s = await carte(tags);
  const coinsPochette = coinsAleatoires(s.w, s.h, tags);
  const { cv } = await opencv();
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, s.w, 0, s.w, s.h, 0, s.h]), cv.matFromArray(4, 1, cv.CV_32FC2, coinsPochette.flat()));
  const m = s.marge;
  const pts = cv.matFromArray(4, 1, cv.CV_32FC2, [m, m, s.w - m, m, s.w - m, s.h - m, m, s.h - m]);
  const vrais = new cv.Mat();
  cv.perspectiveTransform(pts, vrais, M);
  const coins = Array.from({ length: 4 }, (_, i) => [vrais.data32F[2 * i], vrais.data32F[2 * i + 1]] as Point);
  M.delete(); pts.delete(); vrais.delete();

  const calques: Calque[] = [];
  if (oui(0.08)) {
    // Another card half out of the frame.
    tags.push("encombre");
    const autre = await sharp(choix(REFS[choix(["pokemon", "yugioh", "lorcana"])])).resize(630, 880, { fit: "fill" }).png().toBuffer();
    const x = oui(0.5) ? entre(-500, -300) : entre(W - 250, W - 100), y = entre(0, H - 900);
    calques.push({ input: await placer(autre, 630, 880, [[x, y], [x + 600, y + 40], [x + 560, y + 880], [x - 40, y + 840]]) });
  }
  const carteCalque = await placer(s.img, s.w, s.h, coinsPochette);
  if (oui(0.5)) {
    // Drop shadow: the card's alpha, darkened, blurred and shifted.
    tags.push("ombre");
    const dx = Math.round(entre(-12, 12)), dy = Math.round(entre(-4, 16));
    const alpha = await sharp(carteCalque).extractChannel(3).blur(entre(3, 12)).linear(entre(0.3, 0.6), 0).toBuffer();
    const noir = await sharp({ create: { width: W, height: H, channels: 3, background: "#000" } }).joinChannel(alpha).png().toBuffer();
    const decale = await sharp(noir).extend({ top: Math.max(0, dy), bottom: Math.max(0, -dy), left: Math.max(0, dx), right: Math.max(0, -dx), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    calques.push({ input: await sharp(decale).extract({ left: Math.max(0, -dx), top: Math.max(0, -dy), width: W, height: H }).png().toBuffer() });
  }
  calques.push({ input: carteCalque });
  let img = await sharp(fond).composite(calques).png().toBuffer();
  // Flash: bright centre, darker corners; white balance and exposure.
  const cx = entre(0.35, 0.65) * W, cy = entre(0.3, 0.6) * H, bord = entre(0.4, 0.85);
  const vignette = svg(`<defs><radialGradient id="v" cx="${cx / W}" cy="${cy / H}" r="0.8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${rgb([255 * bord, 255 * bord, 255 * bord])}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>`);
  img = await sharp(img).composite([{ input: vignette, blend: "multiply" }]).png().toBuffer();
  let p = sharp(img).modulate({ brightness: entre(0.75, 1.15), saturation: entre(0.85, 1.15) }).linear([entre(0.92, 1.08), 1, entre(0.88, 1.1)], [0, 0, 0]);
  if (oui(0.3)) { tags.push("flou"); p = sharp(await p.png().toBuffer()).blur(entre(1, 2.5)); }
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  const bruit = entre(6, 16);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + (alea() - 0.5) * bruit));
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: Math.round(entre(70, 90)) }).toBuffer();
  return { jpeg, coins };
}

fs.mkdirSync(DOSSIER, { recursive: true });
const verite: { fichier: string; coins: Point[]; tags: string[] }[] = [];
for (let i = 0; i < N; i++) {
  const tags: string[] = [];
  const { jpeg, coins } = await photo(tags);
  const fichier = `${String(i).padStart(3, "0")}.jpg`;
  fs.writeFileSync(`${DOSSIER}/${fichier}`, jpeg);
  verite.push({ fichier, coins, tags });
  if ((i + 1) % 20 === 0) console.log(`${i + 1}/${N}`);
}
fs.writeFileSync(opts.verite!, JSON.stringify(verite, null, 1));
console.log(`${verite.length} photos dans ${DOSSIER}, réponses dans ${opts.verite}`);
