// Fits the weights (POIDS) of contour.ts's score on a synthetic training set. For each photo the candidates are
// the K best quadrilaterals under the current weights plus the true one (the lines closest to the true sides);
// the weights maximise the probability of the true candidates under a softmax of the scores (conditional
// logit), kept >= 0 (the search prunes on partial scores), with an L2 pull towards the starting weights.
// Candidates are collected again with the new weights for a second round.
// Training photos: generer.ts with seeds 11, 12, 13 (--n 100 --graine 11 --dossier experiences/contour2/app-11
// --verite experiences/contour2/app-11/verite.json), never the test sets.
// Usage (from phase0/): node experiences/contour2/apprendre.ts [--dossiers experiences/contour2/app-11,...] [--K 100] [--tours 2] [--lambda 0.01]
import fs from "node:fs";
import { parseArgs } from "node:util";
import type { Point } from "../../vision.ts";
import { interne, NOMS, POIDS } from "./contour.ts";

const { values: opts } = parseArgs({ options: {
  dossiers: { type: "string", default: "experiences/contour2/app-11,experiences/contour2/app-12,experiences/contour2/app-13" },
  limite: { type: "string" }, K: { type: "string", default: "100" }, tours: { type: "string", default: "2" }, lambda: { type: "string", default: "0.01" },
} });
const K = Number(opts.K), LAMBDA = Number(opts.lambda);
const verite: { fichier: string; coins: Point[] }[] = opts.dossiers!.split(",").filter((d) => fs.existsSync(`${d}/verite.json`))
  .flatMap((d) => JSON.parse(fs.readFileSync(`${d}/verite.json`, "utf8")).map((v: any) => ({ ...v, fichier: `${d}/${v.fichier}` })))
  .slice(0, opts.limite ? Number(opts.limite) : undefined);

// Mean corner error / diagonal, best cyclic shift, both orientations.
function erreur(vrais: Point[], q: Point[]): number {
  const diag = Math.hypot(vrais[2][0] - vrais[0][0], vrais[2][1] - vrais[0][1]);
  let best = Infinity;
  for (const r of [q, [...q].reverse()]) for (let d = 0; d < 4; d++) {
    best = Math.min(best, vrais.reduce((s, v, i) => s + Math.hypot(v[0] - r[(i + d) % 4][0], v[1] - r[(i + d) % 4][1]), 0) / 4 / diag);
  }
  return best;
}

type Exemple = { F: number[][]; pos: boolean[] };
const exemples = new Map<string, Exemple>();
let poids = [...POIDS];
const w0 = [...POIDS];

for (let tour = 0; tour < Number(opts.tours); tour++) {
  let premiers = 0, sansVrai = 0;
  for (const v of verite) {
    const a = await interne.analyser(fs.readFileSync(v.fichier));
    const k = a.w / a.largeur;
    const vrais = v.coins.map(([x, y]) => [x * k, y * k] as Point);
    const diag = Math.hypot(vrais[2][0] - vrais[0][0], vrais[2][1] - vrais[0][1]);
    const cands = interne.chercher(a, poids, K);
    // The true candidate: for each true side, the closest line (2 deg, both ends within 2.5 % of the diagonal).
    const cotes = [0, 1, 2, 3].map((i) => {
      const p = vrais[i], q = vrais[(i + 1) % 4], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const na = -(q[1] - p[1]) / l, nb = (q[0] - p[0]) / l;
      let best = null, bd = 0.025 * diag;
      for (const dr of a.droites) {
        if (Math.abs(dr.a * na + dr.b * nb) < Math.cos(0.035)) continue;
        const e = Math.max(...[p, q].map((r) => Math.abs(dr.a * r[0] + dr.b * r[1] - dr.c)));
        if (e < bd) { bd = e; best = dr; }
      }
      return best;
    });
    const vrai = cotes.every(Boolean) ? interne.noter(cotes as any, a, poids) : null;
    const liste = [...cands];
    if (vrai && !cands.some((c) => erreur(vrai.q, c.q) < 1e-6)) liste.push(vrai);
    const pos = liste.map((c) => erreur(vrais, c.q) < 0.02);
    if (!pos.some(Boolean)) { sansVrai++; continue; }
    if (pos[0]) premiers++;
    // Merge with the previous rounds' candidates of this photo (no duplicates needed: they only reweight).
    const ancien = exemples.get(v.fichier);
    exemples.set(v.fichier, { F: [...(ancien?.F ?? []), ...liste.map((c) => c.f)], pos: [...(ancien?.pos ?? []), ...pos] });
  }
  console.log(`tour ${tour + 1}: vrai 1er ${premiers}/${verite.length}, sans vrai candidat ${sansVrai}`);

  // Conditional logit, projected gradient ascent with Adam steps.
  const n = NOMS.length, m = new Float64Array(n), s2 = new Float64Array(n);
  const ex = [...exemples.values()];
  const objectif = (w: number[], grad?: Float64Array) => {
    let J = 0;
    for (const { F, pos } of ex) {
      const sc = F.map((f) => f.reduce((s, x, i) => s + w[i] * x, 0));
      const mx = Math.max(...sc);
      const e = sc.map((s) => Math.exp(s - mx));
      const Z = e.reduce((s, x) => s + x, 0), Zp = e.reduce((s, x, i) => s + (pos[i] ? x : 0), 0);
      J += Math.log(Zp / Z);
      if (grad) for (let c = 0; c < F.length; c++) for (let i = 0; i < n; i++) grad[i] += F[c][i] * ((pos[c] ? e[c] / Zp : 0) - e[c] / Z);
    }
    J -= LAMBDA * ex.length * w.reduce((s, x, i) => s + (x - w0[i]) ** 2, 0);
    if (grad) for (let i = 0; i < n; i++) grad[i] -= 2 * LAMBDA * ex.length * (w[i] - w0[i]);
    return J / ex.length;
  };
  console.log(`  log-vraisemblance moyenne avant ${objectif(poids).toFixed(3)}`);
  for (let it = 1; it <= 1500; it++) {
    const g = new Float64Array(n);
    objectif(poids, g);
    for (let i = 0; i < n; i++) {
      m[i] = 0.9 * m[i] + 0.1 * g[i];
      s2[i] = 0.999 * s2[i] + 0.001 * g[i] * g[i];
      const pas = (0.02 * m[i] / (1 - 0.9 ** it)) / (Math.sqrt(s2[i] / (1 - 0.999 ** it)) + 1e-8);
      poids[i] = Math.max(0, poids[i] + pas);
    }
  }
  console.log(`  après ${objectif(poids).toFixed(3)}`);
  console.log(`  POIDS = [${poids.map((x) => +x.toFixed(2)).join(", ")}]`);
  console.log("  " + NOMS.map((nm, i) => `${nm} ${poids[i].toFixed(2)}`).join(", "));
}
