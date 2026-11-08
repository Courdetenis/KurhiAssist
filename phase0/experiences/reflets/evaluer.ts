// Measures the flash-glare variants (reflets.ts) and records the evidences used by the "carte non reconnue" decision,
// on 4 sets: banc (the 240 bench photos), reflets (indexed cards with flash), intrus (games not indexed),
// scans (the shop's real photos, hand-placed corners in scans.json).
// Outline: "contour" = current contour.ts, "vrai" = true or hand-placed corners. The straightened card and its OCR lines
// do not depend on the variant: they are cached in cache/ at the first run (the outline is frozen there).
// Only the 4 games of the bench are searched (pokemon, yugioh, onepiece, riftbound), even once Lorcana is indexed.
// Usage (from phase0/): node experiences/reflets/evaluer.ts [--sets banc,reflets,intrus,scans] [--conditions contour,vrai]
//   [--variantes base,bouche+masque+orb] [--label x]      -> resultats/<label>/<set>-<condition>.json
//   node experiences/reflets/evaluer.ts --chrono 40 --sets reflets   -> time of the changed steps
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { fichierRef, type Ref } from "../../commun.ts";
import { chargerIndex } from "../../indexer.ts";
import { lireLignes } from "../../ocr.ts";
import { analyser } from "../../texte.ts";
import { DIM, accords, opencv, redresserCarte, type Points } from "../../vision.ts";
import { ART, jetons, pointsOrb, poolerArt, type Empreinte, type Reglage } from "./reflets.ts";

export const DOSSIER = fileURLToPath(new URL(".", import.meta.url));
export const JEUX4 = ["pokemon", "yugioh", "onepiece", "riftbound"] as const;

export type Variante = Reglage & { orb: boolean };
const sans: Reglage = { boucher: false, masquer: false, croissance: 3, part: 1, rogne: 0 };
export const VARIANTES: Record<string, Variante> = {
  base: { ...sans, orb: false },
  "base+orb": { ...sans, orb: true },
  masque: { ...sans, masquer: true, part: 0.25, orb: false },
    bouche: { ...sans, boucher: true, orb: false },
  "bouche+masque": { ...sans, boucher: true, masquer: true, part: 0.25, orb: false },
  "bouche+masque+orb": { ...sans, boucher: true, masquer: true, part: 0.25, orb: true },
  rogne: { ...sans, rogne: 0.15, orb: false },
  "bouche+masque+voisins": { ...sans, boucher: true, masquer: true, part: 0.25, voisins: true, orb: false },
  "voile+bouche+masque": { ...sans, devoiler: true, boucher: true, masquer: true, part: 0.25, orb: false },
  "voile+masque": { ...sans, devoiler: true, masquer: true, part: 0.25, orb: false },
  "voile+bouche+masque+orb": { ...sans, devoiler: true, boucher: true, masquer: true, part: 0.25, orb: true },
};

// Fusion weights of reconnaissance.ts.
const POIDS_TEXTE = 0.12, POIDS_ORB = 0.2;

export type Cas = { fichier: string; jeu: string; id: string; nom: string; coins: [number, number][]; tags?: string[] };
export function charger(set: string): { dossier: string; liste: Cas[] } {
  if (set === "banc") return { dossier: "banc/photos", liste: JSON.parse(fs.readFileSync("banc/verite.json", "utf8")).filter((c: Cas) => (JEUX4 as readonly string[]).includes(c.jeu)) };
  if (set === "scans") return { dossier: "scans", liste: JSON.parse(fs.readFileSync(path.join(DOSSIER, "scans.json"), "utf8")) };
  return { dossier: path.join(DOSSIER, "photos", set), liste: JSON.parse(fs.readFileSync(path.join(DOSSIER, "photos", `${set}.json`), "utf8")) };
}

// ---------- Cached straightened card + OCR lines ----------

async function redresser(photo: Buffer, coins: [number, number][]): Promise<Buffer> {
  const { cv } = await opencv();
  const { data, info } = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, coins.flat()), cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1260, 0, 1260, 1760, 0, 1760]));
  const carte = new cv.Mat();
  cv.warpPerspective(src, carte, M, new cv.Size(1260, 1760));
  const jpeg = await sharp(Buffer.from(carte.data), { raw: { width: 1260, height: 1760, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
  src.delete(); M.delete(); carte.delete();
  return jpeg;
}

type Prep = { carte: Buffer; trouve: boolean; coins: [number, number][] | null; lignes: any[]; kana: number };
async function preparer(set: string, cond: string, dossier: string, c: Cas): Promise<Prep> {
  const base = path.join(DOSSIER, "cache", set, cond, c.fichier);
  if (fs.existsSync(`${base}.json`)) return { carte: fs.readFileSync(base), ...JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) };
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const photo = fs.readFileSync(path.join(dossier, c.fichier));
  const r = cond === "vrai" ? { carte: await redresser(photo, c.coins), trouve: true, coins: c.coins }
    : await redresserCarte(photo).then((x) => ({ carte: x.orientations[0], trouve: x.trouve, coins: x.coins as [number, number][] | null }));
  const { lignes, kana } = await lireLignes(r.carte);
  fs.writeFileSync(base, r.carte);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ trouve: r.trouve, coins: r.coins, lignes, kana }));
  return { ...r, lignes, kana };
}

// ---------- Index (4 games) ----------

const refs: Ref[] = [];
const blocs: Float32Array[] = [];
for (const jeu of JEUX4) { const ix = chargerIndex(jeu)!; refs.push(...ix.refs); blocs.push(ix.vecteurs); }
const index = new Float32Array(refs.length * DIM);
blocs.reduce((o, b) => (index.set(b, o), o + b.length), 0);
const position = new Map(refs.map((r, i) => [`${r.jeu}/${r.id}`, i]));

const similarite = (e: Empreinte, i: number) => {
  const v = e[refs[i].jeu];
  let s = 0;
  for (let d = 0, b = i * DIM; d < DIM; d++) s += v[d] * index[b + d];
  return s;
};
function plusProches(v: Empreinte, k: number): { i: number; sim: number }[] {
  const top: { i: number; sim: number }[] = [];
  for (let i = 0; i < refs.length; i++) {
    const s = similarite(v, i);
    if (top.length < k || s > top[k - 1].sim) {
      top.push({ i, sim: s });
      top.sort((a, b) => b.sim - a.sim);
      top.length = Math.min(top.length, k);
    }
  }
  return top;
}

const cosRefs = (i: number, j: number) => { let t = 0; for (let d = 0; d < DIM; d++) t += index[i * DIM + d] * index[j * DIM + d]; return t; };

const orbRefs = new Map<number, Points>();
// Query keypoints inside a box (fractions of the card).
function dansBoite(q: Points, [x0, y0, x1, y1]: number[]): Points {
  const garde = Array.from({ length: q.n }, (_, i) => i).filter((i) => q.xy[2 * i] >= x0 && q.xy[2 * i] <= x1 && q.xy[2 * i + 1] >= y0 && q.xy[2 * i + 1] <= y1);
  return { n: garde.length, xy: Float32Array.from(garde.flatMap((i) => [q.xy[2 * i], q.xy[2 * i + 1]])), desc: Uint32Array.from(garde.flatMap((i) => [...q.desc.subarray(8 * i, 8 * i + 8)])) };
}
const orbRef = async (i: number) => orbRefs.get(i) ?? orbRefs.set(i, await pointsOrb(fichierRef(refs[i]))).get(i)!;

// ---------- One photo, all variants ----------

export type Mesure = {
  fichier: string; jeu: string; id: string; tags: string[]; variante: string; trouve: boolean; rang: number; o: number; reflet: number;
  top: { jeu: string; id: string; nom: string; sim: number; orb: number; texte: number; score: number; orbArt: number }; // orbArt: matches inside the artwork box
  deux: { sim: number; score: number; orb: number }; // 2nd candidate whose artwork differs (reference cosine < 0.9)
  orbMed: number; ms: number; // median ORB of the other pool candidates of the same game (frame/layout matches)
  // Image only, for an indexed card: similarity of the right card, its rank among the 40 150 by similarity alone, and its
  // margin over the best other artwork of the image shortlist.
  vraie?: { sim: number; rang: number; marge: number };
};

async function mesurer(c: Cas, p: Prep, variantes: string[]): Promise<Mesure[]> {
  const cartes = [p.carte, await sharp(p.carte).rotate(180).toBuffer()];
  const lu = analyser(p.lignes, undefined, p.kana);
  const texte = new Map(lu.candidats.filter((x) => (JEUX4 as readonly string[]).includes(x.jeu)).map((x) => [`${x.jeu}/${x.id}`, x.score]));
  const orbQ = new Map<string, Points>();
  const sorties: Mesure[] = [];
  const groupes = Map.groupBy(variantes, (v) => `${VARIANTES[v].boucher}/${VARIANTES[v].croissance}/${VARIANTES[v].devoiler}`);
  for (const liste of groupes.values()) {
    const J = await jetons(cartes, VARIANTES[liste[0]]);
    for (const nom of liste) {
      const r = VARIANTES[nom];
      const t0 = performance.now();
      const vecteurs = [poolerArt(J, 0, r), poolerArt(J, 1, r)];
      const tops = vecteurs.map((v) => plusProches(v, 20));
      const o = tops[1][0].sim > tops[0][0].sim ? 1 : 0;
      const cleQ = `${o}/${r.orb}`;
      if (!orbQ.has(cleQ)) orbQ.set(cleQ, await pointsOrb(cartes[o], 500, r.orb));
      const q = orbQ.get(cleQ)!;
      const pool = [...new Set([...tops[o].map((t) => t.i), ...[...texte.keys()].map((k) => position.get(k)!)])];
      const cands = await Promise.all(pool.map(async (i) => {
        const sim = similarite(vecteurs[o], i);
        const orb = Math.min(accords(q, await orbRef(i)), 200);
        const t = texte.get(`${refs[i].jeu}/${refs[i].id}`) ?? 0;
        return { i, sim, orb, texte: t, score: sim + POIDS_ORB * orb / 200 + POIDS_TEXTE * t };
      }));
      cands.sort((a, b) => b.score - a.score);
      const a = cands[0];
      const iv = position.get(`${c.jeu}/${c.id}`);
      let vraie: Mesure["vraie"];
      if (iv !== undefined) {
        const s = similarite(vecteurs[o], iv);
        let rang = 0;
        for (let i = 0; i < refs.length; i++) if (similarite(vecteurs[o], i) > s) rang++;
        const autre = tops[o].find((t) => t.i !== iv && cosRefs(t.i, iv) < 0.9);
        vraie = { sim: s, rang, marge: s - (autre?.sim ?? 0) };
      }
      const b = cands.find((x) => x !== a && cosRefs(x.i, a.i) < 0.9) ?? cands[1];
      const meme = cands.filter((x) => x !== a && refs[x.i].jeu === refs[a.i].jeu).map((x) => x.orb).sort((x, y) => x - y);
      sorties.push({
        fichier: c.fichier, jeu: c.jeu, id: c.id, tags: c.tags ?? [], variante: nom, trouve: p.trouve, o,
        rang: cands.findIndex((x) => refs[x.i].jeu === c.jeu && refs[x.i].id === c.id),
        reflet: J.reflet[o].reduce((s, x) => s + Number(x >= 0.25), 0) / J.reflet[o].length,
        top: { jeu: refs[a.i].jeu, id: refs[a.i].id, nom: refs[a.i].nom, sim: a.sim, orb: a.orb, texte: a.texte, score: a.score, orbArt: accords(dansBoite(q, ART[refs[a.i].jeu]), await orbRef(a.i)) },
        deux: { sim: b.sim, score: b.score, orb: b.orb }, orbMed: meme[meme.length >> 1] ?? 0, vraie, ms: J.ms + performance.now() - t0,
      });
    }
  }
  return sorties;
}

if (import.meta.main) {
  const { values: opts } = parseArgs({ options: {
    sets: { type: "string", default: "banc,reflets,intrus,scans" }, conditions: { type: "string", default: "contour,vrai" },
    variantes: { type: "string", default: Object.keys(VARIANTES).join(",") }, label: { type: "string", default: "essai" }, limite: { type: "string" }, chrono: { type: "string" },
  } });
  // --chrono N: time of the changed step only (fingerprint of both orientations), project vs retained (REGLAGE),
  // alternated photo by photo so both see the same machine load. Cards straightened beforehand (cache of the 1st set).
  if (opts.chrono) {
    const vision = await import("../../vision.ts");
    const reflets = await import("./reflets.ts");
    const set = opts.sets!.split(",")[0];
    const { dossier, liste } = charger(set);
    const ms = { avant: [] as number[], apres: [] as number[] };
    for (const [n, c] of liste.slice(0, Number(opts.chrono) + 1).entries()) {
      const p = await preparer(set, "contour", dossier, c);
      const cartes = [p.carte, await sharp(p.carte).rotate(180).toBuffer()];
      for (const cote of n % 2 ? ["apres", "avant"] as const : ["avant", "apres"] as const) {
        const t0 = performance.now();
        if (cote === "avant") await vision.empreintes(cartes);
        else await reflets.empreintes(cartes);
        if (n) ms[cote].push(performance.now() - t0); // the first photo loads the models
      }
    }
    const q = (l: number[], p: number) => [...l].sort((a, b) => a - b)[Math.floor(p * (l.length - 1))].toFixed(0);
    const d = ms.apres.map((x, i) => x - ms.avant[i]);
    console.log(`${ms.avant.length} photos (${set}) : projet médiane ${q(ms.avant, 0.5)} ms (p90 ${q(ms.avant, 0.9)}), retenu ${q(ms.apres, 0.5)} ms (p90 ${q(ms.apres, 0.9)}), surcoût médian ${q(d, 0.5)} ms (p90 ${q(d, 0.9)})`);
    process.exit(0);
  }
  const variantes = opts.variantes!.split(",");
  for (const v of variantes) if (!VARIANTES[v]) throw new Error(`variante inconnue : ${v}`);
  const sortie = path.join(DOSSIER, "resultats", opts.label!);
  fs.mkdirSync(sortie, { recursive: true });
  for (const set of opts.sets!.split(",")) {
    const { dossier, liste } = charger(set);
    for (const cond of opts.conditions!.split(",")) {
      const lignes: Mesure[] = [];
      const t0 = Date.now();
      for (const c of liste.slice(0, opts.limite ? Number(opts.limite) : undefined)) {
        const m = await mesurer(c, await preparer(set, cond, dossier, c), variantes);
        lignes.push(...m);
        process.stdout.write(m[0].rang === 0 ? "." : m[0].rang > 0 ? "o" : "x");
      }
      fs.writeFileSync(path.join(sortie, `${set}-${cond}.json`), JSON.stringify(lignes));
      console.log(`\n${set} ${cond} : ${lignes.length / variantes.length} photos en ${Math.round((Date.now() - t0) / 1000)} s`);
      for (const v of variantes) {
        const l = lignes.filter((x) => x.variante === v);
        console.log(`  ${v.padEnd(20)} top-1 ${(100 * l.filter((x) => x.rang === 0).length / l.length).toFixed(1)} %  top-5 ${(100 * l.filter((x) => x.rang >= 0 && x.rang < 5).length / l.length).toFixed(1)} %`);
      }
    }
  }
}
