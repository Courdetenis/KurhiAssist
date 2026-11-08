// Debug: share of photos whose 4 true sides are among the detector's lines (within 2.5 % of the card diagonal
// and 2 deg), i.e. the best any scoring could do. Usage: node oracle.ts <dossier> <verite.json> [limite]
import fs from "node:fs";
import { interne } from "./contour.ts";
const [dossier, vf, lim] = process.argv.slice(2);
const verite = JSON.parse(fs.readFileSync(vf, "utf8")).slice(0, lim ? +lim : undefined);
let ok = 0;
const rates: string[] = [];
for (const v of verite) {
  const a = await interne.analyser(fs.readFileSync(`${dossier}/${v.fichier}`));
  const k = a.w / a.largeur;
  const g = v.coins.map((p: number[]) => [p[0] * k, p[1] * k]);
  const diag = Math.hypot(g[2][0] - g[0][0], g[2][1] - g[0][1]);
  const trouve = [0, 1, 2, 3].map((i) => {
    const p = g[i], q = g[(i + 1) % 4], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const na = -(q[1] - p[1]) / l, nb = (q[0] - p[0]) / l;
    return a.droites.some((dr) => Math.abs(dr.a * na + dr.b * nb) > Math.cos(0.035) && [p, q].every((r) => Math.abs(dr.a * r[0] + dr.b * r[1] - dr.c) < 0.025 * diag));
  });
  if (trouve.every(Boolean)) ok++;
  else rates.push(`${v.fichier}:${trouve.map(Number).join("")}`);
}
console.log(`${dossier}: côtés tous présents ${ok}/${verite.length}  ${rates.join(" ")}`);
