// Text reading of a straightened card (1260x1760, upright or upside down): name, collector number / set code,
// language, and a text-only lookup among the reference cards. OCR = PaddleOCR ONNX (ocr.ts), 100 % local.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JEUX, type Jeu, langueCodeYgo, langueTexte, norm, type Ref } from "../../commun.ts";
import { type Ligne, lireLignes } from "./ocr.ts";

const chemin = (p: string) => fileURLToPath(new URL(p, import.meta.url));

type Entree = { cle: string; nom: string; refs: number[]; langues: Set<string> }; // one distinct normalised name
type Table = { refs: Ref[]; entrees: Entree[]; parCle: Map<string, Entree>; tri: Map<string, number[]>; numeros: Map<string, number[]>; laches: Map<string, number[]> };
let tables: Map<Jeu, Table> | undefined;

// Printed name without the index's edition suffixes: "Nami (033)", "Issho - EB04-022", "Ahri - Inquisitive (Overnumbered)".
export const nomImprime = (nom: string) => nom.replace(/\s*\([^)]*\)/g, "").replace(/\s-\s[A-Z]{1,3}\d{2}-\d{3}$/, "");
const trigrammes = (s: string) => Array.from({ length: Math.max(1, s.length - 2) }, (_, i) => s.slice(i, i + 3));

// Number keys: "025/165" -> "25/165", "LOB-EN001" -> "LOB-001", "OGN • 030/298" -> "OGN-030", passcode -> "#89631139".
const sansZeros = (s: string) => s.replace(/(^|[^0-9])0+(?=\d)/g, "$1");
// OCR swaps look-alike characters; the loose key folds them on both sides (index and reading).
const lache = (s: string) => s.toUpperCase().replace(/[OQD]/g, "0").replace(/[IL|T]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6").replace(/[^A-Z0-9/#-]/g, "");

function clesNumero(r: Ref): string[] {
  if (r.jeu === "yugioh") return [...(r.codes ?? []), `#${r.id}`];
  if (r.jeu === "pokemon") {
    const promo = r.numero.toUpperCase().match(/^([A-Z]+\d+)\//)?.[1]; // black star promos print "SWSH193" alone
    if (r.id.startsWith("svp-")) return [sansZeros(r.numero), sansZeros(`SVP${r.id.slice(4)}`)]; // "SVP FR 164"
    return promo ? [sansZeros(r.numero.toUpperCase()), sansZeros(promo)] : [sansZeros(r.numero.toUpperCase())];
  }
  return [r.numero.toUpperCase()];
}

function chargerTables(): Map<Jeu, Table> {
  const noms: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync(chemin("donnees/noms.json"), "utf8"));
  const t = new Map<Jeu, Table>();
  for (const jeu of JEUX) {
    const refs: Ref[] = JSON.parse(fs.readFileSync(chemin(`../../index/${jeu}.json`), "utf8"));
    const parCle = new Map<string, Entree>();
    const numeros = new Map<string, number[]>(), laches = new Map<string, number[]>();
    const ajouter = (m: Map<string, number[]>, k: string, i: number) => { const l = m.get(k); if (!l) m.set(k, [i]); else if (l.at(-1) !== i) l.push(i); };
    refs.forEach((r, i) => {
      const variantes: [string, string][] = [["en", r.nom]];
      for (const l of ["fr", "de", "es", "it", "pt"]) { const n = noms[`${jeu}-${l}`]?.[r.id]; if (n) variantes.push([l, n]); }
      for (const [langue, nom] of variantes) {
        if (nom === "???") continue;
        const formes = [nomImprime(nom)];
        if (jeu === "riftbound" && nom.includes(" - ")) formes.push(nom.split(" - ")[0]); // champion name alone
        for (const forme of formes) {
          const cle = norm(forme);
          if (cle.length < 2) continue;
          let e = parCle.get(cle);
          if (!e) parCle.set(cle, (e = { cle, nom: forme, refs: [], langues: new Set() }));
          if (e.refs.at(-1) !== i) e.refs.push(i);
          e.langues.add(langue);
        }
      }
      for (const k of clesNumero(r)) { ajouter(numeros, k, i); ajouter(laches, lache(k), i); }
    });
    const entrees = [...parCle.values()];
    const tri = new Map<string, number[]>();
    entrees.forEach((e, j) => { for (const g of new Set(trigrammes(e.cle))) { const l = tri.get(g); if (l) l.push(j); else tri.set(g, [j]); } });
    t.set(jeu, { refs, entrees, parCle, tri, numeros, laches });
  }
  return t;
}

function levenshtein(a: string, b: string): number {
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prec = cour;
  }
  return prec[b.length];
}

// Best names for one OCR string: trigram shortlist, then normalised edit similarity.
function nomsProches(t: Table, q: string, k = 40): { e: Entree; sim: number }[] {
  if (q.length < 3) return [];
  const compte = new Map<number, number>();
  for (const g of new Set(trigrammes(q))) for (const j of t.tri.get(g) ?? []) compte.set(j, (compte.get(j) ?? 0) + 1);
  return [...compte].sort((a, b) => b[1] - a[1]).slice(0, k)
    .map(([j]) => { const e = t.entrees[j]; return { e, sim: 1 - levenshtein(q, e.cle) / Math.max(q.length, e.cle.length) }; })
    .filter((x) => x.sim >= 0.5);
}

// Where the name is printed (vertical centre, 0 = top): Pokémon / Yu-Gi-Oh! top band, One Piece bottom, Riftbound middle.
const ZONE_NOM: Record<Jeu, [number, number]> = { pokemon: [0, 0.12], yugioh: [0, 0.11], onepiece: [0.8, 0.95], riftbound: [0.45, 0.75] };

type Numero = { jeu: Jeu; cle: string; langue?: string | null };
// Collector numbers / set codes found in the lines, per game pattern. Lines of one row are also joined in reading
// order: the detector often splits "SFD • 223/221" or "SVP FR 164" in two boxes.
function numerosLignes(lignes: Ligne[]): Numero[] {
  const rangs: Ligne[][] = [];
  for (const l of [...lignes].sort((a, b) => a.y0 + a.y1 - b.y0 - b.y1)) {
    const r = rangs.at(-1), h = l.y1 - l.y0;
    if (r && Math.abs(r[0].y0 + r[0].y1 - l.y0 - l.y1) / 2 < h / 2) r.push(l); else rangs.push([l]);
  }
  const joints = rangs.filter((r) => r.length > 1).map((r) => ({ texte: r.sort((a, b) => a.x0 - b.x0).map((l) => l.texte).join(" "), y0: r[0].y0 }));
  const n: Numero[] = [];
  for (const l of [...lignes, ...joints]) {
    const t = l.texte.toUpperCase();
    for (const m of t.matchAll(/([A-Z]{0,4}\d{1,3}[A-Z]?)\s*\/\s*([A-Z]{0,4}\d{1,3})/g)) n.push({ jeu: "pokemon", cle: sansZeros(`${m[1]}/${m[2]}`) });
    for (const m of t.matchAll(/\b(SWSH|SM|XY|BW|DP|HGSS)\s?(\d{1,3})\b(?!\s*\/)/g)) n.push({ jeu: "pokemon", cle: sansZeros(m[1] + m[2]) });
    for (const m of t.matchAll(/\bSVP\s?(?:[A-Z]{2})?\s?(\d{1,3})\b(?!\s*\/)/g)) n.push({ jeu: "pokemon", cle: sansZeros(`SVP${m[1]}`) });
    for (const m of t.matchAll(/\b([A-Z0-9]{2,5})\s?-\s?([A-Z]{0,2})\s?(\d{3})\b/g)) n.push({ jeu: "yugioh", cle: `${m[1]}-${m[3]}`, langue: langueCodeYgo(`${m[1]}-${m[2]}${m[3]}`) });
    for (const m of t.matchAll(/\b(\d{8})\b/g)) if (l.y0 > 0.85) n.push({ jeu: "yugioh", cle: `#${Number(m[1])}` });
    for (const m of t.matchAll(/\b((?:OP|ST|EB|PRB)\s?\d{2}|P)\s?-\s?(\d{3})(?!\d)/g)) n.push({ jeu: "onepiece", cle: `${m[1].replace(/\s/g, "")}-${m[2]}` });
    for (const m of t.matchAll(/\b([A-Z]{3})\s*[^A-Z0-9/]{0,3}\s*(\d{3})[A-Z*]?\s*\/\s*\d{2,3}/g)) n.push({ jeu: "riftbound", cle: `${m[1]}-${m[2]}` });
  }
  return n;
}

// Pokémon prints the set code and the language next to the number on recent cards: "MEW FR 025/165".
const CODES_LANGUE: Record<string, string> = { FR: "fr", EN: "en", DE: "de", IT: "it", ES: "es", PT: "pt" };
const MOTS_PV: Record<string, string> = { PV: "fr", HP: "en", KP: "de", PS: "it" };

export type Lecture = { langue: string | null; nom: string | null; numero: string | null; candidats: { jeu: string; id: string; score: number }[]; ms: number };

export async function lireCarte(carte: Buffer, jeu?: string): Promise<Lecture> {
  const t0 = Date.now();
  tables ??= chargerTables();
  const { lignes, kana } = await lireLignes(carte);
  return { ...analyser(lignes, jeu, kana), ms: Date.now() - t0 };
}

// Parsing and lookup, separate from the OCR so the bench can replay it on stored lines.
// kana = kana characters the multilingual model found (Japanese card).
export function analyser(lignes: Ligne[], jeu?: string, kana = 0): Omit<Lecture, "ms"> {
  tables ??= chargerTables();
  const jeux = JEUX.filter((j) => !jeu || j === jeu);
  const scores = new Map<string, { jeu: Jeu; i: number; nom: number; num: number; e?: Entree; cle?: string; lu?: string }>();
  const point = (j: Jeu, i: number) => {
    const k = `${j}/${i}`;
    let s = scores.get(k);
    if (!s) scores.set(k, (s = { jeu: j, i, nom: 0, num: 0 }));
    return s;
  };

  // Names: each line, and each line joined with its right neighbour or a line just below (split names,
  // Riftbound "KAI'SA / LEGEND / Daughter of the Void"). Glued HP and Pokémon levels are cut: "Heatran LV.47", "Hisui220".
  const requetes: { q: string; y: number }[] = [];
  const nettoyer = (t: string) => t.replace(/\s*\bL?V\.?\s?(\d+|X)\s*$/i, "").replace(/\d+\s*$/, "");
  lignes.forEach((l) => {
    const y = (l.y0 + l.y1) / 2;
    requetes.push({ q: norm(l.texte), y });
    if (nettoyer(l.texte) !== l.texte) requetes.push({ q: norm(nettoyer(l.texte)), y });
    const h = l.y1 - l.y0;
    for (const b of lignes) {
      if (b === l) continue;
      const memeRang = Math.abs(b.y0 - l.y0) < h * 0.5 && b.x0 > l.x0 && b.x0 - l.x1 < h * 1.5;
      const dessous = b.y0 > l.y0 && b.y0 - l.y1 < h * 2.5 && Math.abs(b.x0 - l.x0) < 0.15;
      if (memeRang || dessous) for (const q of new Set([norm(l.texte + b.texte), norm(l.texte + nettoyer(b.texte))])) requetes.push({ q, y });
    }
  });
  for (const j of jeux) {
    const t = tables.get(j)!;
    const [ya, yb] = ZONE_NOM[j];
    for (const r of requetes) {
      const poids = r.y >= ya && r.y <= yb ? 1 : 0.7;
      for (const { e, sim } of nomsProches(t, r.q)) {
        const v = sim * poids;
        for (const i of e.refs) {
          const s = point(j, i);
          if (v > s.nom || (v === s.nom && e.cle.length > s.e!.cle.length)) { s.nom = v; s.e = e; } // "Jinx Demolitionist" over "Jinx"
        }
      }
    }
  }

  // Numbers: exact key, else loose key (look-alike characters folded).
  const numeros = numerosLignes(lignes).filter((n) => jeux.includes(n.jeu));
  for (const n of numeros) {
    const t = tables.get(n.jeu)!;
    const exacts = t.numeros.get(n.cle);
    for (const i of exacts ?? t.laches.get(lache(n.cle)) ?? []) {
      const s = point(n.jeu, i);
      if ((exacts ? 1 : 0.8) > s.num) { s.num = exacts ? 1 : 0.8; s.cle = clesNumero(t.refs[i]).find((k) => lache(k) === lache(n.cle)); }
    }
  }

  // Near miss on the number of a card whose name was read ("192/197" for 192/191): partial credit by edit similarity.
  for (const s of scores.values()) {
    if (s.num >= 0.8 || s.nom < 0.6) continue;
    for (const n of numeros) {
      if (n.jeu !== s.jeu) continue;
      for (const k of clesNumero(tables.get(s.jeu)!.refs[s.i])) {
        const a = lache(n.cle), b = lache(k);
        const v = 0.6 * (1 - levenshtein(a, b) / Math.max(a.length, b.length));
        if (v >= 0.35 && v > s.num) { s.num = v; s.lu = n.cle; }
      }
    }
  }

  // Ties (alternate arts share name and number): the base print, i.e. the shortest id, first.
  const classes = [...scores.values()].map((s) => ({ ...s, score: s.nom + s.num, id: tables!.get(s.jeu)!.refs[s.i].id }))
    .sort((a, b) => b.score - a.score || a.id.length - b.id.length);
  const top = classes[0];
  const refTop = top && tables.get(top.jeu)!.refs[top.i];

  // Language votes: printed codes, name language, function words, Pokémon HP label.
  const votes = new Map<string, number>();
  const voter = (l: string | null | undefined, v: number) => { if (l) votes.set(l, (votes.get(l) ?? 0) + v); };
  for (const n of numeros) if (!refTop || n.jeu === refTop.jeu) voter(n.langue, 3);
  for (const l of lignes) {
    // Capitals only, so flavour text ("est EN jeu", "mur DE glace") does not count.
    const m = /^[^a-z]*$/.test(l.texte) && l.texte.match(/(?:^|\s)[A-Z][A-Z0-9]{1,4} ?(FR|EN|DE|IT|ES|PT)(?:\s|$)/);
    if (m && l.y0 > 0.85) voter(CODES_LANGUE[m[1]], 3);
    if (refTop?.jeu === "pokemon" && l.y1 < 0.12) for (const w of l.texte.toUpperCase().split(/[^A-Z]+/)) voter(MOTS_PV[w], 1);
  }
  const texte = lignes.map((l) => l.texte).join("\n");
  voter(langueTexte(texte), 2);
  if (top?.e && top.nom >= 0.75 && top.e.langues.size < 6) for (const l of top.e.langues) voter(l, 2 / top.e.langues.size);
  if (kana >= 4) voter("ja", 3); // bilingual promos (Japanese + French) keep their Latin language
  const langue = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const numero = top?.cle ?? top?.lu ?? numeros.find((n) => !refTop || n.jeu === refTop.jeu)?.cle ?? null;
  return {
    langue,
    nom: top?.e?.nom ?? null, // dictionary spelling of the name read
    numero,
    candidats: classes.slice(0, 10).map((s) => ({ jeu: s.jeu, id: s.id, score: Math.round(s.score * 1000) / 1000 })),
  };
}
