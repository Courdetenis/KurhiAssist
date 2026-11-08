// Debug: top lines (yellow: 10 first, cyan: next), best quad before widening (red), result (green), next to the
// background likeness map; factors of the best quad and of the quad made of the lines closest to the true
// sides (when the photo is in a verite file). Usage: node dbg.ts <photo> <out.jpg> [nb lines]
import fs from "node:fs";
import sharp from "sharp";
import { interne, NOMS, POIDS } from "./contour.ts";
const [photo, out, nArg] = process.argv.slice(2);
const a = await interne.analyser(fs.readFileSync(photo));
const { w, h } = a;
const [meilleur] = interne.chercher(a, POIDS, 1);
const coins = meilleur ? interne.finir(a, meilleur) : null;
const k = w / a.largeur;
let s = "";
a.droites.slice(0, Number(nArg ?? 30)).forEach((l, i) => {
  const x0 = l.c * l.a, y0 = l.c * l.b, ux = -l.b, uy = l.a;
  s += `<line x1="${x0 - 2000 * ux}" y1="${y0 - 2000 * uy}" x2="${x0 + 2000 * ux}" y2="${y0 + 2000 * uy}" stroke="${i < 10 ? "#ff0" : "#0ff"}" stroke-width="1" opacity="0.6"/>`;
});
if (meilleur) s += `<polygon points="${meilleur.q.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#f00" stroke-width="2"/>`;
if (coins) s += `<polygon points="${coins.map((p) => [p[0] * k, p[1] * k].join(",")).join(" ")}" fill="none" stroke="#0f0" stroke-width="1.5"/>`;
const facteurs = (f: number[]) => NOMS.map((n, i) => `${n} ${f[i].toFixed(2)}`).join(", ");
if (meilleur) console.log(`gagnant: score ${meilleur.score.toFixed(2)} | ${facteurs(meilleur.f)}`);
const img = await sharp(photo).rotate().resize(w, h).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${s}</svg>`) }]).png().toBuffer();
const fond = await sharp(Buffer.from(Uint8Array.from(a.fond, (v) => v * 255)), { raw: { width: w, height: h, channels: 1 } }).toColourspace("srgb").png().toBuffer();
await sharp({ create: { width: 2 * w, height: h, channels: 3, background: "#000" } }).composite([{ input: img, left: 0, top: 0 }, { input: fond, left: w, top: 0 }]).jpeg().toFile(out);
for (const vf of ["experiences/contour2/verite-reelles.json", "experiences/contour2/verite.json", "experiences/contour2/verite-app.json", "banc/verite.json"]) {
  if (!fs.existsSync(vf)) continue;
  const v = JSON.parse(fs.readFileSync(vf, "utf8")).find((c: any) => photo.endsWith("/" + c.fichier));
  if (!v) continue;
  const g = v.coins.map((p: number[]) => [p[0] * k, p[1] * k]);
  const diag = Math.hypot(g[2][0] - g[0][0], g[2][1] - g[0][1]);
  const cotes = [0, 1, 2, 3].map((i) => {
    const p = g[i], q = g[(i + 1) % 4], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const na = -(q[1] - p[1]) / l, nb = (q[0] - p[0]) / l;
    let best = -1, bd = Infinity;
    a.droites.forEach((dr, j) => {
      if (Math.abs(dr.a * na + dr.b * nb) < Math.cos(0.035)) return;
      const e = Math.max(...[p, q].map((r: number[]) => Math.abs(dr.a * r[0] + dr.b * r[1] - dr.c)));
      if (e < bd) { bd = e; best = j; }
    });
    console.log(`côté ${i}: droite n°${best} à ${(100 * bd / diag).toFixed(1)} % de la diagonale`);
    return bd < 0.025 * diag ? a.droites[best] : null;
  });
  if (cotes.every(Boolean)) {
    const c = interne.noter(cotes as any, a, POIDS);
    console.log(c ? `vrai: score ${c.score.toFixed(2)} | ${facteurs(c.f)}` : "vrai: rejeté (forme)");
  }
  break;
}
