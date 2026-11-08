// Phase 0: compares resultats/*.json with the checked rows of verite.csv. Writes resultats/score.md.
import fs from "node:fs";
import { lireCsv, norm } from "./commun.ts";

const verite = lireCsv("verite.csv").filter((v) => ["o", "oui"].includes(norm(v.verifie)));
if (!verite.length) {
  console.error('Aucune ligne vérifiée dans verite.csv (colonne verifie = "o").');
  process.exit(1);
}

type Stat = { n: number; contour: number; jeu: number; langue: number; avecId: number; top1: number; top3: number; top10: number; ms: number };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "–");

let md = `# Score phase 0\n\n${verite.length} photos vérifiées. Généré le ${new Date().toLocaleString("fr-FR")}.\n`;
for (const fichier of fs.readdirSync("resultats").filter((f) => f.endsWith(".json")).sort()) {
  const resultats = JSON.parse(fs.readFileSync(`resultats/${fichier}`, "utf8"));
  const groupes = new Map<string, Stat>();
  for (const v of verite) {
    const e = resultats[v.fichier];
    if (!e) continue;
    const rang = e.candidats.findIndex((c: { id: string }) => c.id === v.id_correct);
    for (const g of ["tous", v.jeu]) {
      const s = groupes.get(g) ?? { n: 0, contour: 0, jeu: 0, langue: 0, avecId: 0, top1: 0, top3: 0, top10: 0, ms: 0 };
      s.n++;
      s.contour += Number(e.detecte);
      s.jeu += Number(e.candidats[0]?.jeu === v.jeu);
      s.langue += Number(norm(e.langue) === norm(v.langue));
      if (v.id_correct) { // empty = card missing from the reference index, not a recognition error
        s.avecId++;
        s.top1 += Number(rang === 0);
        s.top3 += Number(rang >= 0 && rang < 3);
        s.top10 += Number(rang >= 0);
      }
      s.ms += e.ms;
      groupes.set(g, s);
    }
  }
  md += `\n## ${fichier.replace(/\.json$/, "")}\n\n| Groupe | Photos | Contour trouvé | Jeu | Langue | Bonne carte 1re | Dans les 3 premières | Dans les 10 premières | Temps moyen |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const [g, s] of groupes) {
    md += `| ${g} | ${s.n} | ${pct(s.contour, s.n)} | ${pct(s.jeu, s.n)} | ${pct(s.langue, s.n)} | ${pct(s.top1, s.avecId)} | ${pct(s.top3, s.avecId)} | ${pct(s.top10, s.avecId)} | ${(s.ms / s.n / 1000).toFixed(1)} s |\n`;
  }
}
fs.writeFileSync("resultats/score.md", md);
console.log(md);
