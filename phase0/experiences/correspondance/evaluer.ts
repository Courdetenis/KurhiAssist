// Matching-only bench: each bench photo is straightened with its TRUE corners ("vrai") and with corners moved by
// 2.5 % ("bruite") or 5 % ("bruite5") of the diagonal (an imperfect outline), then searched among the references.
// Compares the project's baseline (vision.ts empreintes + index/) with the variants of correspondance.ts.
// Usage (from phase0/): node experiences/correspondance/evaluer.ts --configs "base;dv2s_ent:1,0,0" [--sous] [--orb 50] [--label x]
// A config is "base" or a sum of passes "passe:wcls,wmoy,wart+passe2:...". Writes resultats/<label>.json and .md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { JEUX, fichierRef, norm, type Jeu, type Ref } from "../../commun.ts";
import { chargerIndex } from "../../indexer.ts";
import { DIM, empreintes, opencv } from "../../vision.ts";
import { ART, DOSSIER, PASSES, accords, octetsVersPoints, pointsVersOctets, chargerIndexPasse, encoder, imageRef, identifierImage, meilleurs, pointsOrb, similarites, type Index, type Points, type Sorties } from "./correspondance.ts";

const { values: opts } = parseArgs({ options: {
  configs: { type: "string", default: "base" }, sous: { type: "boolean" }, orb: { type: "string", default: "0" },
  label: { type: "string", default: "essai" }, conditions: { type: "string", default: "vrai,bruite" }, limite: { type: "string" }, chrono: { type: "string" }, depuis: { type: "string" }, fusion: { type: "string" },
} });
type Cas = { fichier: string; jeu: string; id: string; nom: string; langue: string; coins: [number, number][]; tags: string[] };
const verite: Cas[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8")).slice(0, opts.limite ? Number(opts.limite) : undefined);
const CACHE = path.join(DOSSIER, "cache");

// ---------- Straightened bench images (cached) ----------
const generateur = (graine: number) => () => { graine = (Math.imul(graine, 1664525) + 1013904223) >>> 0; return graine / 4294967296; };
const alea = generateur(12345), alea5 = generateur(54321);

async function redresser(photo: string, coins: [number, number][], sortie: string) {
  const { cv } = await opencv();
  const { data, info } = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, coins.flat()), cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1260, 0, 1260, 1760, 0, 1760]));
  const carte = new cv.Mat();
  cv.warpPerspective(src, carte, M, new cv.Size(1260, 1760));
  await sharp(Buffer.from(carte.data), { raw: { width: 1260, height: 1760, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toFile(sortie);
  src.delete(); M.delete(); carte.delete();
}

for (const cond of ["vrai", "bruite", "bruite5"]) fs.mkdirSync(path.join(CACHE, cond), { recursive: true });
for (const c of verite) {
  const diag = Math.hypot(c.coins[2][0] - c.coins[0][0], c.coins[2][1] - c.coins[0][1]);
  const bouger = (r: number, h: () => number) => c.coins.map(([x, y]) => { const a = h() * 2 * Math.PI; return [x + r * diag * Math.cos(a), y + r * diag * Math.sin(a)] as [number, number]; });
  for (const [cond, coins] of [["vrai", c.coins], ["bruite", bouger(0.025, alea)], ["bruite5", bouger(0.05, alea5)]] as const) {
    const f = path.join(CACHE, cond, c.fichier);
    if (!fs.existsSync(f)) await redresser(`banc/photos/${c.fichier}`, coins as [number, number][], f);
  }
}
const conditions = opts.conditions!.split(",");

// --chrono N: end-to-end identifierImage on N jittered cards, every other one upside down; cold ORB, one at a time.
if (opts.chrono) {
  const ms: number[] = [];
  let bons = 0;
  for (const [n, c] of verite.slice(0, Number(opts.chrono)).entries()) {
    let img = fs.readFileSync(path.join(CACHE, conditions[0], c.fichier));
    if (n % 2) img = await sharp(img).rotate(180).toBuffer();
    const r = await identifierImage(img, 5);
    if (n) ms.push(r.ms); // first call loads the model and the index
    bons += Number(r.candidats[0].jeu === c.jeu && r.candidats[0].id === c.id);
  }
  ms.sort((a, b) => a - b);
  console.log(`identifierImage (${conditions[0]}) : top-1 ${bons}/${opts.chrono}, médiane ${ms[ms.length >> 1]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
  process.exit(0);
}

// ---------- Indexes ----------
// Baseline: the project's own index. Restricted to the screening subset with --sous.
const sousDossier = opts.sous ? "index-sous" : "index";
const garde = opts.sous ? new Set(chargerIndexPasse(Object.keys(PASSES).find((p) => fs.existsSync(path.join(DOSSIER, "index-sous", p)))!, "index-sous")!.refs.map((r) => `${r.jeu}/${r.id}`)) : null;
const base = (() => {
  const refs: Ref[] = [];
  const v: number[] = [];
  const blocs: Float32Array[] = [];
  for (const jeu of JEUX) {
    const ix = chargerIndex(jeu)!;
    ix.refs.forEach((r, i) => { if (!garde || garde.has(`${r.jeu}/${r.id}`)) { refs.push(r); v.push(blocs.length); blocs.push(ix.vecteurs.subarray(i * DIM, (i + 1) * DIM)); } });
  }
  const vecteurs = new Float32Array(refs.length * DIM);
  blocs.forEach((b, i) => vecteurs.set(b, i * DIM));
  return { refs, vecteurs };
})();
const posBase = new Map(base.refs.map((r, i) => [`${r.jeu}/${r.id}`, i]));
// Two refs are "the same image" when their baseline fingerprints are near identical (reprints, foil copies).
const memeImage = (a: Pick<Ref, "jeu" | "id">, b: Pick<Ref, "jeu" | "id">) => {
  const i = posBase.get(`${a.jeu}/${a.id}`), j = posBase.get(`${b.jeu}/${b.id}`);
  if (i === undefined || j === undefined) return false;
  let s = 0;
  for (let d = 0; d < DIM; d++) s += base.vecteurs[i * DIM + d] * base.vecteurs[j * DIM + d];
  return s > 0.97;
};

const indexes = new Map<string, Index>();
const index = (p: string) => {
  if (!indexes.has(p)) indexes.set(p, chargerIndexPasse(p, sousDossier)!);
  return indexes.get(p)!;
};

// ---------- Runs ----------
type Cand = { jeu: Jeu; id: string; nom: string; sim: number; acc?: number[] };
type Ligne = Cas & { cond: string; config: string; rang: number; top: Cand[]; ms: number; msOrb?: number };
let lignes: Ligne[] = [];
const K = 100;

if (opts.depuis) lignes = JSON.parse(fs.readFileSync(path.join(DOSSIER, "resultats", `${opts.depuis}.json`), "utf8"));
else for (const cond of conditions) {
  // Query fingerprints per pass, both orientations, computed once and shared by the configs.
  const requetes = new Map<string, { s0: Sorties; s1: Sorties }[]>();
  for (const config of opts.configs!.split(";")) {
    for (const [n, c] of verite.entries()) {
      const img = fs.readFileSync(path.join(CACHE, cond, c.fichier));
      const t0 = performance.now();
      let sims = new Float32Array(0), refs: Ref[] = [];
      if (config === "base") {
        const [v0, v1] = await empreintes([img, await sharp(img).rotate(180).toBuffer()]);
        refs = base.refs;
        sims = new Float32Array(refs.length);
        for (let i = 0; i < refs.length; i++) {
          let a = 0, b = 0;
          for (let d = 0, o = i * DIM; d < DIM; d++) { a += v0[d] * base.vecteurs[o + d]; b += v1[d] * base.vecteurs[o + d]; }
          sims[i] = Math.max(a, b);
        }
      } else for (const terme of config.split("+")) {
        const [p, w] = terme.split(":");
        const poids = w.split(",").map(Number) as [number, number, number];
        const ix = index(p);
        refs = ix.refs;
        if (!requetes.has(p)) requetes.set(p, []);
        const liste = requetes.get(p)!;
        if (!liste[n]) { const [s0, s1] = await encoder([img, img], PASSES[p], [false, true]); liste[n] = { s0, s1 }; }
        const a = similarites(ix, liste[n].s0, poids), b = similarites(ix, liste[n].s1, poids);
        if (!sims.length) sims = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) sims[i] += Math.max(a[i], b[i]);
      }
      // ms counts the first config using a pass only (later configs reuse the query fingerprints).
      const top = meilleurs(sims, K);
      lignes.push({ ...c, cond, config, rang: top.findIndex((i) => refs[i].jeu === c.jeu && refs[i].id === c.id), top: top.map((i) => ({ jeu: refs[i].jeu, id: refs[i].id, nom: refs[i].nom, sim: sims[i] })), ms: performance.now() - t0 });
      const l = lignes[lignes.length - 1];
      process.stdout.write(l.rang === 0 ? "." : l.rang > 0 && l.rang < 5 ? "o" : "x");
    }
    console.log(` ${cond} ${config}`);
  }
}

// Geometric re-ranking data: guided ORB matches for the top candidates, for a few (tolerance, threshold) pairs.
// [tolerance, Hamming threshold, artwork only]. Reference keypoints are cached on disk (cache/orb/), so msOrb
// here is NOT a cold timing: see the timing run of identifierImage for that.
const REGLAGES: [number, number, boolean][] = [[0.07, 48, false], [0.07, 48, true], [0.05, 48, true], [0.07, 64, true]];
const nbOrb = Number(opts.orb);
if (nbOrb) {
  const cacheOrb = new Map<string, Points>();
  for (const l of lignes) {
    const t1 = performance.now();
    const q = await pointsOrb(fs.readFileSync(path.join(CACHE, l.cond, l.fichier)));
    for (const t of l.top.slice(0, nbOrb)) {
      const cle = `${t.jeu}/${t.id}`;
      if (!cacheOrb.has(cle)) {
        const f = path.join(CACHE, "orb", fichierRef(t).replace(/^references\//, "").replace(/\.jpg$/, ".bin"));
        if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, pointsVersOctets(await pointsOrb(imageRef(t)))); }
        cacheOrb.set(cle, octetsVersPoints(fs.readFileSync(f)));
      }
      t.acc = REGLAGES.map(([tol, seuil, art]) => accords(q, cacheOrb.get(cle)!, tol, seuil, art ? ART[t.jeu as Jeu] : undefined));
    }
    l.msOrb = performance.now() - t1;
    process.stdout.write(".");
  }
  console.log(` orb ${nbOrb} (${cacheOrb.size} refs)`);
}
fs.mkdirSync(path.join(DOSSIER, "resultats"), { recursive: true });
fs.writeFileSync(path.join(DOSSIER, "resultats", `${opts.label}.json`), JSON.stringify(lignes));
const fusion = opts.fusion ? JSON.parse(opts.fusion) : grille(lignes, nbOrb || 20);
const md = rapport(lignes) + (fusion ? rapport(lignes, fusion).split("\n").slice(2).join("\n") : "");
fs.writeFileSync(path.join(DOSSIER, "resultats", `${opts.label}.md`), md);
console.log(md.split("\n").filter((x) => !x.includes("#")).join("\n"));

// ---------- Report ----------
// Re-ranking: the first k candidates sorted by sim + beta * min(acc[r], cap) / cap.
type Fusion = { r: number; beta: number; cap: number; k: number };
function reordonner(l: Ligne, f: Fusion): Cand[] {
  const top = l.top.slice(0, f.k).map((t) => ({ ...t, f: t.sim + f.beta * Math.min(t.acc?.[f.r] ?? 0, f.cap) / f.cap }));
  top.sort((a, b) => b.f - a.f);
  return [...top, ...l.top.slice(f.k)];
}

function rapport(lignes: Ligne[], fusion?: Fusion): string {
  const groupes = new Map<string, { n: number; t1: number; t5: number; t20: number; nom: number; img: number; ms: number }>();
  for (const l of lignes) {
    const top = fusion ? reordonner(l, fusion) : l.top;
    const rang = top.findIndex((t) => t.jeu === l.jeu && t.id === l.id);
    const premier = top[0];
    const nomConfig = fusion ? `${l.config} +orb${fusion.k}` : l.config;
    for (const g of ["tous", l.jeu, ...l.tags.map((t) => `#${t}`)].map((g) => `${l.cond} | ${nomConfig} | ${g}`)) {
      const s = groupes.get(g) ?? { n: 0, t1: 0, t5: 0, t20: 0, nom: 0, img: 0, ms: 0 };
      s.n++;
      s.t1 += Number(rang === 0);
      s.t5 += Number(rang >= 0 && rang < 5);
      s.t20 += Number(rang >= 0 && rang < 20);
      s.nom += Number(premier.jeu === l.jeu && norm(premier.nom) === norm(l.nom));
      s.img += Number(rang === 0 || (premier.jeu === l.jeu && memeImage(premier, l as Pick<Ref, "jeu" | "id">)));
      s.ms += l.ms + (fusion ? l.msOrb ?? 0 : 0);
      groupes.set(g, s);
    }
  }
  const pct = (a: number, n: number) => `${Math.round((100 * a) / n)}`;
  let md = "| Coins | Config | Groupe | n | top-1 | top-5 | top-20 | top-1 même image | top-1 même nom | ms |\n|---|---|---|---|---|---|---|---|---|---|\n";
  for (const [g, s] of groupes) md += `| ${g} | ${s.n} | ${pct(s.t1, s.n)} | ${pct(s.t5, s.n)} | ${pct(s.t20, s.n)} | ${pct(s.img, s.n)} | ${pct(s.nom, s.n)} | ${Math.round(s.ms / s.n)} |\n`;
  return md;
}

// Fusion grid on the "tous" top-1 (printed only, to pick the setting).
function grille(lignes: Ligne[], k: number): Fusion | undefined {
  if (!lignes.some((l) => l.top[0].acc)) return undefined;
  let meilleur: [number, Fusion] = [-1, { r: 0, beta: 0, cap: 1, k }];
  for (let r = 0; r < REGLAGES.length; r++) for (const beta of [0.05, 0.1, 0.2, 0.5, 1, 100]) for (const cap of [10, 25, 50, 100, 200]) for (const kk of [10, 20, k]) {
    const f = { r, beta, cap, k: Math.min(kk, k) };
    const ok = lignes.filter((l) => reordonner(l, f)[0].id === l.id).length;
    if (ok > meilleur[0]) meilleur = [ok, f];
  }
  console.log("meilleure fusion", JSON.stringify(meilleur[1]), `${meilleur[0]}/${lignes.length}`);
  return meilleur[1];
}
