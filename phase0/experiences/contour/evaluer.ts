// Card outline only: current redresserCarte (vision.ts) vs trouverCarte (contour.ts) on the bench.
// Contour juste = corners within 3 % of the card diagonal (same metric as banc/evaluer.ts).
// Writes experiences/contour/resultats.json (per photo) and prints the table.
// Usage (from phase0/): node experiences/contour/evaluer.ts [--limite 240] [--rapide]
// --rapide reuses the stored redresserCarte column (vision.ts unchanged) and only runs trouverCarte.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { redresserCarte, type Point } from "../../vision.ts";
import { trouverCarte } from "./contour.ts";

const { values: opts } = parseArgs({ options: { limite: { type: "string" }, rapide: { type: "boolean", default: false } } });
type Cas = { fichier: string; coins: Point[]; tags: string[] };
const verite: Cas[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8")).slice(0, opts.limite ? Number(opts.limite) : undefined);
const SORTIE = "experiences/contour/resultats.json";

// Copy of erreurCoins from banc/evaluer.ts (that file runs on import).
function erreurCoins(vrais: Point[], trouves: Point[] | null): number | null {
  if (!trouves) return null;
  const diag = Math.hypot(vrais[2][0] - vrais[0][0], vrais[2][1] - vrais[0][1]);
  let meilleur = Infinity;
  for (let d = 0; d < 4; d++) {
    const e = vrais.reduce((s, v, i) => s + Math.hypot(v[0] - trouves[(i + d) % 4][0], v[1] - trouves[(i + d) % 4][1]), 0) / 4;
    meilleur = Math.min(meilleur, e);
  }
  return meilleur / diag;
}

type Ligne = { fichier: string; tags: string[]; avant: number | null; msAvant: number; apres: number | null; msApres: number; coins: Point[] | null };
const anciens: Ligne[] = opts.rapide && fs.existsSync(SORTIE) ? JSON.parse(fs.readFileSync(SORTIE, "utf8")) : [];
const lignes: Ligne[] = [];
for (const c of verite) {
  const photo = fs.readFileSync(`banc/photos/${c.fichier}`);
  const ancien = anciens.find((l) => l.fichier === c.fichier);
  let avant = ancien?.avant ?? null, msAvant = ancien?.msAvant ?? 0;
  if (!ancien) {
    const t = performance.now();
    avant = erreurCoins(c.coins, (await redresserCarte(photo)).coins);
    msAvant = performance.now() - t;
  }
  const r = await trouverCarte(photo);
  const apres = erreurCoins(c.coins, r.coins);
  lignes.push({ fichier: c.fichier, tags: c.tags, avant, msAvant, apres, msApres: r.ms, coins: r.coins });
  process.stdout.write(apres !== null && apres < 0.03 ? "." : "x");
}
console.log();
fs.writeFileSync(SORTIE, JSON.stringify(lignes, null, 1));

const juste = (e: number | null) => e !== null && e < 0.03;
const pct = (a: number, n: number) => `${Math.round((100 * a) / n)} %`;
const mediane = (xs: (number | null)[]) => {
  const v = xs.map((x) => x ?? Infinity).sort((a, b) => a - b);
  const m = v[Math.floor((v.length - 1) / 2)];
  return m === Infinity ? "-" : `${(m * 100).toFixed(1)} %`;
};
const groupes = new Map<string, Ligne[]>();
for (const l of lignes) for (const g of ["tous", ...l.tags]) groupes.set(g, [...(groupes.get(g) ?? []), l]);
let md = `| Groupe | Photos | Juste avant | Juste après | Erreur médiane avant | après | ms avant | ms après |\n|---|---|---|---|---|---|---|---|\n`;
for (const [g, ls] of [...groupes].sort((a, b) => (a[0] === "tous" ? -1 : b[0] === "tous" ? 1 : a[0].localeCompare(b[0])))) {
  const ms = (k: "msAvant" | "msApres") => Math.round(ls.reduce((s, l) => s + l[k], 0) / ls.length);
  md += `| ${g} | ${ls.length} | ${pct(ls.filter((l) => juste(l.avant)).length, ls.length)} | ${pct(ls.filter((l) => juste(l.apres)).length, ls.length)} | ${mediane(ls.map((l) => l.avant))} | ${mediane(ls.map((l) => l.apres))} | ${ms("msAvant")} | ${ms("msApres")} |\n`;
}
console.log(md);
const ratesApres = lignes.filter((l) => !juste(l.apres));
console.log(`Ratés après (${ratesApres.length}) : ${ratesApres.map((l) => `${l.fichier} ${l.apres === null ? "-" : (l.apres * 100).toFixed(1)}`).join(", ")}`);
