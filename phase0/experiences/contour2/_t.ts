import fs from "node:fs";
import { interne, POIDS } from "./contour.ts";
for (const f of process.argv.slice(2)) {
  const a = await interne.analyser(fs.readFileSync(f));
  const [m] = interne.chercher(a, POIDS, 1);
  const k = a.largeur / a.w;
  console.log(f, "cand", JSON.stringify(m.q.map((p) => p.map((v) => Math.round(v * k)))));
  console.log("  fin", JSON.stringify(interne.finir(a, m).map((p) => p.map(Math.round))));
}
