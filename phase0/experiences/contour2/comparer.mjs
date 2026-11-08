// Per-photo differences between two evaluer.ts --sortie files. Usage: node comparer.mjs a.json b.json
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const ok = (l) => l && l.moy !== null && l.moy < 0.03;
for (const jeu of Object.keys(b)) {
  if (!a[jeu]) continue;
  const gagne = [], perdu = [];
  for (const l of b[jeu]) {
    const m = a[jeu].find((x) => x.fichier === l.fichier);
    if (ok(m) && !ok(l)) perdu.push(`${l.fichier} ${l.moy === null ? "-" : (100 * l.moy).toFixed(1)}`);
    if (!ok(m) && ok(l)) gagne.push(l.fichier);
  }
  console.log(`${jeu}: +${gagne.length} -${perdu.length}  gagnés: ${gagne.join(" ")}  perdus: ${perdu.join(", ")}`);
}
