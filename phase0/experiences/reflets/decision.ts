// Reads resultats/<label>/*.json (evaluer.ts): top-1 per set, condition and variant, then calibrates and checks the
// "carte non reconnue" rule. Accepted = genuine photos whose top-1 is right (banc, reflets, scans); rejected = intrus
// and the Lorcana scan. Thresholds are searched on the even-numbered impostors and checked on the odd ones.
// Usage (from phase0/): node experiences/reflets/decision.ts --label v1 [--variante bouche+masque+orb]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { Mesure } from "./evaluer.ts";

const DOSSIER = fileURLToPath(new URL(".", import.meta.url));

const { values: opts } = parseArgs({ options: { label: { type: "string", default: "v1" }, variante: { type: "string" } } });
const dossier = path.join(DOSSIER, "resultats", opts.label!);
const toutes: (Mesure & { set: string; cond: string })[] = fs.readdirSync(dossier).filter((f) => f.endsWith(".json")).flatMap((f) => {
  const [set, cond] = f.replace(".json", "").split("-");
  return JSON.parse(fs.readFileSync(path.join(dossier, f), "utf8")).map((m: Mesure) => ({ ...m, set, cond }));
});
const indexe = (m: Mesure) => ["pokemon", "yugioh", "onepiece", "riftbound"].includes(m.jeu);
const pct = (a: number, n: number) => (n ? `${((100 * a) / n).toFixed(1)} %` : "-");
const variantes = [...new Set(toutes.map((m) => m.variante))];
const conds = [...new Set(toutes.map((m) => m.cond))].sort();

// ---------- Recognition ----------
let md = `# Résultats ${opts.label}\n\n## Bonne carte 1re (dans les 5) ; similarité moyenne de la bonne carte quand elle est 1re\n\n`;
for (const set of ["reflets", "banc", "scans"]) {
  md += `### ${set}\n\n| Variante | ${conds.map((c) => `${c} top-1 (top-5) | sim`).join(" | ")} |\n|---|${conds.map(() => "---|---").join("|")}|\n`;
  for (const v of variantes) {
    md += `| ${v} |`;
    for (const c of conds) {
      const l = toutes.filter((m) => m.set === set && m.cond === c && m.variante === v && indexe(m));
      const bons = l.filter((m) => m.rang === 0);
      md += ` ${pct(bons.length, l.length)} (${pct(l.filter((m) => m.rang >= 0 && m.rang < 5).length, l.length)}) | ${(bons.reduce((s, m) => s + m.top.sim, 0) / (bons.length || 1)).toFixed(3)} |`;
    }
    md += "\n";
  }
  md += "\n";
}

// ---------- Decision ----------
type Regle = { nom: string; f: (m: Mesure, s: number[]) => boolean; grilles: number[][] };
const sim = (m: Mesure) => m.top.sim, orbX = (m: Mesure) => m.top.orb - m.orbMed, ecart = (m: Mesure) => m.top.sim - m.deux.sim;
const plage = (a: number, b: number, p: number) => Array.from({ length: Math.round((b - a) / p) + 1 }, (_, i) => +(a + i * p).toFixed(4));
const REGLES: Regle[] = [
  { nom: "score >= a (actuel : numéro lu ou score >= 0,7)", f: (m, [a]) => m.top.score >= a, grilles: [plage(0.5, 1.2, 0.005)] },
  { nom: "numéro lu (texte >= 1,5) ou score >= a", f: (m, [a]) => m.top.texte >= 1.5 || m.top.score >= a, grilles: [plage(0.5, 1.2, 0.005)] },
  { nom: "texte >= b ou score >= a", f: (m, [a, b]) => m.top.texte >= b || m.top.score >= a, grilles: [plage(0.5, 1.2, 0.005), plage(0.7, 2, 0.1)] },
  { nom: "sim >= a ou texte >= b", f: (m, [a, b]) => sim(m) >= a || m.top.texte >= b, grilles: [plage(0.5, 1, 0.005), plage(0.8, 2, 0.1)] },
  { nom: "sim + 0,2 (ORB - ORB médian)/200 + 0,12 texte >= a", f: (m, [a]) => sim(m) + 0.2 * orbX(m) / 200 + 0.12 * m.top.texte >= a, grilles: [plage(0.5, 1.2, 0.005)] },
  { nom: "sim + c × écart + 0,12 texte >= a", f: (m, [a, c]) => sim(m) + c * ecart(m) + 0.12 * m.top.texte >= a, grilles: [plage(0.5, 1.4, 0.005), [0.5, 1, 1.5, 2, 3]] },
  { nom: "sim + c × écart + 0,2 (ORB - médian)/200 + 0,12 texte >= a", f: (m, [a, c]) => sim(m) + c * ecart(m) + 0.2 * orbX(m) / 200 + 0.12 * m.top.texte >= a, grilles: [plage(0.5, 1.4, 0.005), [0.5, 1, 1.5, 2, 3]] },
];
const produit = (g: number[][]): number[][] => g.reduce<number[][]>((acc, l) => acc.flatMap((x) => l.map((v) => [...x, v])), [[]]);

for (const v of opts.variante ? [opts.variante] : variantes) {
  md += `## Décision « carte non reconnue », variante ${v}\n\n`;
  for (const c of conds) {
    const l = toutes.filter((m) => m.variante === v && m.cond === c);
    const banc = l.filter((m) => m.set === "banc" && m.rang === 0);
    const autres = l.filter((m) => (m.set === "reflets" || m.set === "scans") && indexe(m) && m.rang === 0);
    const faux = l.filter((m) => indexe(m) && m.rang !== 0); // genuine card, wrong top-1: rejecting it is a bonus
    const intrus = l.filter((m) => !indexe(m));
    const calib = intrus.filter((_, i) => i % 2 === 0), test = intrus.filter((_, i) => i % 2 === 1);
    if (!intrus.length || !banc.length) continue;
    md += `### Contour ${c}\n\nAcceptées : banc juste ${banc.length}, reflets + scans justes ${autres.length}. Intrus : ${intrus.length} (calibrage ${calib.length}, contrôle ${test.length}). Top-1 faux sur cartes indexées : ${faux.length}.\n\n`;
    md += `| Règle | Seuils | Banc accepté | Reflets+scans acceptés | Intrus rejetés (calib / contrôle / tous) | Top-1 faux rejetés |\n|---|---|---|---|---|---|\n`;
    const actuelle = (m: Mesure) => m.top.texte >= 1.5 || m.top.score >= 0.7; // reconnaissance.ts before this work
    md += `| *actuelle : numéro lu ou score >= 0,7* | fixes | ${pct(banc.filter(actuelle).length, banc.length)} | ${pct(autres.filter(actuelle).length, autres.length)} | ${pct(calib.filter((m) => !actuelle(m)).length, calib.length)} / ${pct(test.filter((m) => !actuelle(m)).length, test.length)} / ${pct(intrus.filter((m) => !actuelle(m)).length, intrus.length)} | ${pct(faux.filter((m) => !actuelle(m)).length, faux.length)} |\n`;
    for (const r of REGLES) {
      // Best rejection on the calibration impostors with >= 98 % of the bench's right answers accepted;
      // ties broken by the acceptance on the flash photos.
      let best: { s: number[]; rej: number; acc: number } | null = null;
      for (const s of produit(r.grilles)) {
        if (banc.filter((m) => r.f(m, s)).length < 0.98 * banc.length) continue;
        const rej = calib.filter((m) => !r.f(m, s)).length, acc = autres.filter((m) => r.f(m, s)).length;
        if (!best || rej > best.rej || (rej === best.rej && acc > best.acc)) best = { s, rej, acc };
      }
      if (!best) continue;
      const ok = (m: Mesure) => r.f(m, best!.s);
      md += `| ${r.nom} | ${best.s.join(" ; ")} | ${pct(banc.filter(ok).length, banc.length)} | ${pct(autres.filter(ok).length, autres.length)} | ${pct(calib.filter((m) => !ok(m)).length, calib.length)} / ${pct(test.filter((m) => !ok(m)).length, test.length)} / ${pct(intrus.filter((m) => !ok(m)).length, intrus.length)} | ${pct(faux.filter((m) => !ok(m)).length, faux.length)} |\n`;
    }
    // Distribution of the evidences, to read the margins.
    const q = (l: Mesure[], f: (m: Mesure) => number) => { const x = l.map(f).sort((a, b) => a - b); return [0.02, 0.1, 0.5, 0.9, 0.98].map((p) => x[Math.min(x.length - 1, Math.floor(p * x.length))]?.toFixed(3)).join(" / "); };
    md += `\nQuantiles 2 / 10 / 50 / 90 / 98 % :\n\n| Indice | Banc juste | Reflets+scans justes | Intrus |\n|---|---|---|---|\n`;
    for (const [n, f] of [["sim", sim], ["écart", ecart], ["ORB", (m: Mesure) => m.top.orb], ["ORB - médian", orbX], ["texte", (m: Mesure) => m.top.texte], ["score", (m: Mesure) => m.top.score]] as const) {
      md += `| ${n} | ${q(banc, f)} | ${q(autres, f)} | ${q(intrus, f)} |\n`;
    }
    md += "\n";
  }
}
fs.writeFileSync(path.join(dossier, "decision.md"), md);
console.log(md);
