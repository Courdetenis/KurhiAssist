// Contact sheet: photos of a set with the true quad (green) and, optionally, found corners from an evaluer.ts
// --sortie file (red). Usage: node experiences/contour2/planche.ts <dossier> <verite.json> <out.jpg> [resultats.json jeu] [--rates]
import fs from "node:fs";
import sharp from "sharp";
const [dossier, veriteF, out, resF, jeu, rates] = process.argv.slice(2);
const verite = JSON.parse(fs.readFileSync(veriteF, "utf8"));
const res = resF ? JSON.parse(fs.readFileSync(resF, "utf8"))[jeu] : null;
let cas = verite.map((v: any) => ({ ...v, r: res?.find((l: any) => l.fichier === v.fichier) }));
if (rates) cas = cas.filter((c: any) => !(c.r?.moy != null && c.r.moy < 0.03));
cas = cas.slice(0, 24);
const T = 300;
const tuiles = await Promise.all(cas.map(async (c: any) => {
  const m = await sharp(`${dossier}/${c.fichier}`).metadata();
  const k = T / Math.max(m.width!, m.height!);
  const w = Math.round(m.width! * k), h = Math.round(m.height! * k);
  const poly = (q: number[][], col: string) => `<polygon points="${q.map((p) => `${p[0] * k},${p[1] * k}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2"/>`;
  let s = poly(c.coins, "#0f0");
  if (c.r?.coins) s += poly(c.r.coins, "#f00");
  s += `<text x="3" y="14" font-size="13" fill="#ff0" stroke="#000" stroke-width="0.5">${c.fichier.slice(0, 26)} ${c.r?.moy != null ? (100 * c.r.moy).toFixed(1) : ""}</text>`;
  const img = await sharp(`${dossier}/${c.fichier}`).resize(w, h).toBuffer();
  return sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${s}</svg>`) }]).png().toBuffer();
}));
const cols = 6, rows = Math.ceil(tuiles.length / cols);
await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: "#222" } })
  .composite(tuiles.map((t, i) => ({ input: t, left: (i % cols) * T, top: Math.floor(i / cols) * T }))).jpeg({ quality: 85 }).toFile(out);
