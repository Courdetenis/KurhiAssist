// Measures the recognition on the bench: right card at rank 1 / in the top 5, language, outline found and its
// corner error, time; overall, per game and per difficulty tag. Writes banc/resultats/<label>.json and .md.
// Usage (from phase0/): node banc/evaluer.ts [--label base] [--limite 240]
import fs from "node:fs";
import { parseArgs } from "node:util";
import { chargerReferences, identifierPhoto } from "../reconnaissance.ts";

const { values: opts } = parseArgs({ options: { label: { type: "string", default: "base" }, limite: { type: "string" } } });
type Cas = { fichier: string; jeu: string; id: string; nom: string; langue: string; coins: [number, number][]; tags: string[] };
const verite: Cas[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8")).slice(0, opts.limite ? Number(opts.limite) : undefined);

// Mean corner distance as a share of the card's diagonal; the found corners are matched in any rotation order.
function erreurCoins(vrais: [number, number][], trouves: [number, number][] | null): number | null {
  if (!trouves) return null;
  const diag = Math.hypot(vrais[2][0] - vrais[0][0], vrais[2][1] - vrais[0][1]);
  let meilleur = Infinity;
  for (let d = 0; d < 4; d++) {
    const e = vrais.reduce((s, v, i) => s + Math.hypot(v[0] - trouves[(i + d) % 4][0], v[1] - trouves[(i + d) % 4][1]), 0) / 4;
    meilleur = Math.min(meilleur, e);
  }
  return meilleur / diag;
}

chargerReferences();
const lignes: any[] = [];
for (const c of verite) {
  const r = await identifierPhoto(fs.readFileSync(`banc/photos/${c.fichier}`));
  const rang = r.candidats.findIndex((x) => x.id === c.id && x.jeu === c.jeu);
  const err = erreurCoins(c.coins, r.coins);
  lignes.push({ ...c, rang, langueLue: r.langue, erreurCoins: err, ms: r.ms, top: `${r.candidats[0].jeu}/${r.candidats[0].id} ${r.candidats[0].nom} ${(r.candidats[0].sim * 100).toFixed(0)}%` });
  process.stdout.write(rang === 0 ? "." : rang > 0 ? "o" : "x");
}
console.log();

type Stat = { n: number; top1: number; top5: number; langue: number; contour: number; ms: number };
const groupes = new Map<string, Stat>();
for (const l of lignes) {
  for (const g of ["tous", l.jeu, ...l.tags.map((t: string) => `#${t}`)]) {
    const s = groupes.get(g) ?? { n: 0, top1: 0, top5: 0, langue: 0, contour: 0, ms: 0 };
    s.n++;
    s.top1 += Number(l.rang === 0);
    s.top5 += Number(l.rang >= 0 && l.rang < 5);
    s.langue += Number(l.langueLue === l.langue);
    s.contour += Number(l.erreurCoins !== null && l.erreurCoins < 0.03); // corners within 3 % of the diagonal
    s.ms += l.ms;
    groupes.set(g, s);
  }
}
const pct = (a: number, n: number) => `${Math.round((100 * a) / n)} %`;
let md = `# Banc d'essai : ${opts.label}\n\n${lignes.length} photos. Contour juste = coins à moins de 3 % de la diagonale.\n\n| Groupe | Photos | Bonne carte 1re | Dans les 5 | Langue | Contour juste | Temps moyen |\n|---|---|---|---|---|---|---|\n`;
for (const [g, s] of [...groupes].sort((a, b) => (a[0] === "tous" ? -1 : b[0] === "tous" ? 1 : a[0].startsWith("#") === b[0].startsWith("#") ? a[0].localeCompare(b[0]) : a[0].startsWith("#") ? 1 : -1))) {
  md += `| ${g} | ${s.n} | ${pct(s.top1, s.n)} | ${pct(s.top5, s.n)} | ${pct(s.langue, s.n)} | ${pct(s.contour, s.n)} | ${(s.ms / s.n / 1000).toFixed(1)} s |\n`;
}
md += `\n## Échecs (bonne carte absente de la 1re place)\n\n${lignes.filter((l) => l.rang !== 0).map((l) => `- ${l.fichier} attendu ${l.jeu}/${l.id} ${l.nom}, rang ${l.rang}, obtenu ${l.top}, coins ${l.erreurCoins === null ? "non trouvés" : (l.erreurCoins * 100).toFixed(1) + " %"} [${l.tags.join(", ")}]`).join("\n")}\n`;
fs.mkdirSync("banc/resultats", { recursive: true });
fs.writeFileSync(`banc/resultats/${opts.label}.json`, JSON.stringify(lignes, null, 1));
fs.writeFileSync(`banc/resultats/${opts.label}.md`, md);
console.log(md.split("\n## Échecs")[0]);
