// Timing of trouverCarte's stages (best of 3 runs per photo, so other jobs on the CPU weigh less).
// Usage (from phase0/): node experiences/contour2/temps.ts <dossier> [n]
import fs from "node:fs";
import { interne, POIDS, trouverCarte } from "./contour.ts";
const [dossier, nArg] = process.argv.slice(2);
const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith(".jpg")).slice(0, Number(nArg ?? 30));
await trouverCarte(fs.readFileSync(`${dossier}/${fichiers[0]}`)); // OpenCV start-up
const t: Record<string, number[]> = { analyser: [], chercher: [], finir: [], total: [] };
for (const f of fichiers) {
  const photo = fs.readFileSync(`${dossier}/${f}`);
  const best: Record<string, number> = { analyser: Infinity, chercher: Infinity, finir: Infinity, total: Infinity };
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    const a = await interne.analyser(photo);
    const t1 = performance.now();
    const [m] = interne.chercher(a, POIDS, 1);
    const t2 = performance.now();
    if (m) interne.finir(a, m);
    const t3 = performance.now();
    best.analyser = Math.min(best.analyser, t1 - t0); best.chercher = Math.min(best.chercher, t2 - t1);
    best.finir = Math.min(best.finir, t3 - t2); best.total = Math.min(best.total, t3 - t0);
  }
  for (const k in t) t[k].push(best[k]);
}
for (const [k, v] of Object.entries(t)) {
  v.sort((a, b) => a - b);
  console.log(`${k}: médiane ${Math.round(v[v.length >> 1])} ms, p90 ${Math.round(v[Math.floor(0.9 * (v.length - 1))])} ms, max ${Math.round(v[v.length - 1])} ms`);
}
