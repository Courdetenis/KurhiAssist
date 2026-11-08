// Card outline accuracy on three sets: the real counter scans (scans/ + verite-reelles.json), the realistic synthetic
// set (experiences/contour2/photos + verite.json) and the 240-photo bench (banc/photos + banc/verite.json).
// "Juste" = mean corner error < 3 % of the card diagonal (metric of banc/evaluer.ts); "4 coins" = every corner < 3 %.
// Usage (from phase0/): node experiences/contour2/evaluer.ts [--module ../../contour.ts] [--jeux reel,synth,banc] [--limite N] [--sortie f.json]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { Point } from "../../vision.ts";

const { values: opts } = parseArgs({ options: {
  module: { type: "string", default: "./contour.ts" }, jeux: { type: "string", default: "reel,synth,banc" },
  limite: { type: "string" }, sortie: { type: "string" }, detail: { type: "boolean", default: false },
} });
const ici = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const { trouverCarte } = await import(pathToFileURL(path.resolve(ici, opts.module!)).href);

type Cas = { fichier: string; coins: Point[]; tags?: string[] };
const JEUX: Record<string, { dossier: string; verite: string }> = {
  reel: { dossier: "scans", verite: "experiences/contour2/verite-reelles.json" },
  synth: { dossier: "experiences/contour2/photos", verite: "experiences/contour2/verite.json" },
  banc: { dossier: "banc/photos", verite: "banc/verite.json" },
};

// Per corner error / card diagonal, for the best cyclic shift of the found corners (same as banc/evaluer.ts).
function erreurs(vrais: Point[], trouves: Point[] | null): { moy: number; max: number } | null {
  if (!trouves) return null;
  const diag = Math.hypot(vrais[2][0] - vrais[0][0], vrais[2][1] - vrais[0][1]);
  let best = { moy: Infinity, max: Infinity };
  for (let d = 0; d < 4; d++) {
    const e = vrais.map((v, i) => Math.hypot(v[0] - trouves[(i + d) % 4][0], v[1] - trouves[(i + d) % 4][1]) / diag);
    const moy = e.reduce((s, x) => s + x, 0) / 4;
    if (moy < best.moy) best = { moy, max: Math.max(...e) };
  }
  return best;
}

const resultats: Record<string, any[]> = {};
for (const jeu of opts.jeux!.split(",")) {
  const { dossier, verite } = JEUX[jeu];
  if (!fs.existsSync(verite)) { console.log(`${jeu}: pas de ${verite}`); continue; }
  const cas: Cas[] = JSON.parse(fs.readFileSync(verite, "utf8")).slice(0, opts.limite ? Number(opts.limite) : undefined);
  const lignes: any[] = [];
  for (const c of cas) {
    const r = await trouverCarte(fs.readFileSync(`${dossier}/${c.fichier}`));
    const e = erreurs(c.coins, r.coins);
    lignes.push({ fichier: c.fichier, tags: c.tags ?? [], moy: e?.moy ?? null, max: e?.max ?? null, ms: r.ms, confiance: r.confiance, coins: r.coins });
    process.stdout.write(e && e.moy < 0.03 ? "." : "x");
  }
  console.log();
  resultats[jeu] = lignes;
  const n = lignes.length;
  const pct = (k: number) => `${((100 * k) / n).toFixed(1)} %`;
  const tri = (xs: number[]) => xs.sort((a, b) => a - b);
  const moys = tri(lignes.map((l) => l.moy ?? Infinity)), ms = tri(lignes.map((l) => l.ms));
  console.log(`${jeu}: ${n} photos, juste ${pct(lignes.filter((l) => l.moy !== null && l.moy < 0.03).length)}, 4 coins < 3 % ${pct(lignes.filter((l) => l.max !== null && l.max < 0.03).length)}, ` +
    `erreur médiane ${(100 * moys[(n - 1) >> 1]).toFixed(2)} %, ms moyen ${Math.round(ms.reduce((s, x) => s + x, 0) / n)}, médian ${Math.round(ms[(n - 1) >> 1])}, p90 ${Math.round(ms[Math.floor(0.9 * (n - 1))])}, max ${Math.round(ms[n - 1])}`);
  const rates = lignes.filter((l) => !(l.moy !== null && l.moy < 0.03));
  console.log(`  ratés (${rates.length}) : ${rates.map((l) => `${l.fichier} ${l.moy === null ? "-" : (100 * l.moy).toFixed(1)}`).join(", ")}`);
  if (opts.detail) for (const l of lignes) console.log(`  ${l.fichier} moy ${l.moy === null ? "-" : (100 * l.moy).toFixed(2)} max ${l.max === null ? "-" : (100 * l.max).toFixed(2)} ${Math.round(l.ms)} ms conf ${l.confiance?.toFixed?.(2) ?? "-"}`);
  // Per tag, synthetic sets only.
  const tags = [...new Set(lignes.flatMap((l) => l.tags))].sort();
  if (tags.length) console.log("  " + tags.map((t) => { const ls = lignes.filter((l) => l.tags.includes(t)); return `${t} ${ls.filter((l) => l.moy !== null && l.moy < 0.03).length}/${ls.length}`; }).join(", "));
}
if (opts.sortie) fs.writeFileSync(opts.sortie, JSON.stringify(resultats, null, 1));
