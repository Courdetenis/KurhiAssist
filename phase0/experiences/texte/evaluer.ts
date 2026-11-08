// Compares the current OCR (Tesseract on the lower half, as in reconnaissance.ts) with texte.ts (PaddleOCR + name
// tables) on the bench, each photo straightened with its TRUE corners. Every other card is fed upside down to
// texte.ts (it must find the orientation; the current OCR relies on the image match for that and gets it upright).
// Usage (from phase0/): node experiences/texte/evaluer.ts [--limite 240] [--label texte] [--refaire-base]
import fs from "node:fs";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { codeYgoSansLangue, estJaponais, langueCodeYgo, langueTexte, memeNumero, norm, numerosLus, type Ref } from "../../commun.ts";
import { analyser, nomImprime } from "./texte.ts";
import { lireLignes } from "./ocr.ts";
import { carteRedressee, type Cas } from "./redresser.ts";

const { values: opts } = parseArgs({ options: { limite: { type: "string" }, label: { type: "string", default: "texte" }, "refaire-base": { type: "boolean" } } });
const verite: Cas[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8")).slice(0, opts.limite ? Number(opts.limite) : undefined);
const DOSSIER = "experiences/texte/resultats";
fs.mkdirSync(DOSSIER, { recursive: true });

const refs = new Map<string, Ref>();
for (const jeu of ["pokemon", "yugioh", "onepiece", "riftbound"]) for (const r of JSON.parse(fs.readFileSync(`index/${jeu}.json`, "utf8"))) refs.set(`${jeu}/${r.id}`, r);
const noms: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync("experiences/texte/donnees/noms.json", "utf8"));

function similarite(a: string, b: string): number {
  const x = norm(a), y = norm(nomImprime(b));
  if (!x || !y) return 0;
  let prec = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cour = [i];
    for (let j = 1; j <= y.length; j++) cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prec = cour;
  }
  return 1 - prec[y.length] / Math.max(x.length, y.length);
}

// Number read right? YGO bench scans carry no set code nor passcode: not measurable (null).
function numeroJuste(c: Cas, lus: string[]): boolean | null {
  const r = refs.get(`${c.jeu}/${c.id}`)!;
  if (c.jeu === "yugioh") return null;
  // Promos print no total: "SWSH193/307" is printed "SWSH193", svp-164 "SVP FR 164".
  const promo = /^[A-Z]+\d/i.test(r.numero) ? r.numero.split("/")[0] : c.id.startsWith("svp-") ? `SVP${c.id.slice(4)}` : null;
  return lus.some((n) => memeNumero(n, r.numero) || (promo !== null && memeNumero(n, promo)));
}

// Same printed card (alternate art, reprint, signature...): same game, printed name and number. Text cannot tell them apart.
function equivalente(c: Cas, x: { jeu: string; id: string }): boolean {
  const a = refs.get(`${c.jeu}/${c.id}`)!, b = refs.get(`${x.jeu}/${x.id}`);
  return !!b && a.jeu === b.jeu && norm(nomImprime(a.nom)) === norm(nomImprime(b.nom)) && memeNumero(a.numero, b.numero);
}

// True name in the card's language (TCGdex French name for French Pokémon cards).
const vraiNom = (c: Cas) => noms[`${c.jeu}-${c.langue}`]?.[c.id] ?? refs.get(`${c.jeu}/${c.id}`)!.nom;

// ---------- Current OCR, replayed exactly (own traineddata cache, to stay in this folder) ----------
const tess = { cachePath: "experiences/texte/cache-tesseract" };
let latin: any, japonais: any;
async function actuel(c: Cas, carte: Buffer) {
  const t0 = Date.now();
  latin ??= await createWorker(["eng", "fra", "deu", "ita", "spa", "por"], 1, tess);
  const bas = await sharp(carte).extract({ left: 0, top: 880, width: 1260, height: 880 }).toBuffer();
  const texte = (await latin.recognize(bas)).data.text as string;
  const numeros = numerosLus(texte);
  let langue = c.jeu === "yugioh" ? numeros.map(langueCodeYgo).find(Boolean) ?? null : null;
  langue ??= langueTexte(texte);
  if (!langue) {
    japonais ??= await createWorker(["jpn"], 1, tess);
    if (estJaponais((await japonais.recognize(bas)).data.text)) langue = "ja";
  }
  // Text-only lookup with what it reads: the cards of the game whose number matches (index order), no name.
  const candidats = [...refs.values()].filter((r) => r.jeu === c.jeu && numeros.some((n) => (r.codes ? r.codes.includes(codeYgoSansLangue(n)) : memeNumero(r.numero, n))))
    .slice(0, 10).map((r) => ({ jeu: r.jeu, id: r.id }));
  return { langue, numeros, nom: null as string | null, candidats, candidatsSansJeu: candidats, ms: Date.now() - t0 };
}

// ---------- texte.ts ----------
analyser([]); // loads the name tables once, outside the timing
async function nouveau(c: Cas, carte: Buffer, envers: boolean) {
  const entree = envers ? await sharp(carte).rotate(180).jpeg({ quality: 92 }).toBuffer() : carte;
  const t0 = Date.now();
  const { lignes, kana } = await lireLignes(entree); // = lireCarte(entree, c.jeu), lines kept for the no-game variant
  const r = analyser(lignes, c.jeu, kana);
  const ms = Date.now() - t0;
  return { ...r, numeros: r.numero ? [r.numero] : [], candidatsSansJeu: analyser(lignes, undefined, kana).candidats, ms, lignes, kana };
}

const fichierBase = `${DOSSIER}/actuel-cartes.json`;
const cacheBase: Record<string, any> = !opts["refaire-base"] && fs.existsSync(fichierBase) ? JSON.parse(fs.readFileSync(fichierBase, "utf8")) : {};
const lignes: any[] = [];
for (const [k, c] of verite.entries()) {
  const carte = await carteRedressee(c);
  const base = (cacheBase[c.fichier] ??= await actuel(c, carte));
  const neuf = await nouveau(c, carte, k % 2 === 1);
  const rang = (cands: { jeu: string; id: string }[]) => cands.findIndex((x) => x.jeu === c.jeu && x.id === c.id);
  const ligne = (r: any) => ({
    langue: r.langue, langueOk: r.langue === c.langue, numeros: r.numeros, numeroOk: numeroJuste(c, r.numeros),
    nom: r.nom, nomOk: r.nom ? similarite(r.nom, vraiNom(c)) >= 0.8 : false, rang: rang(r.candidats), rangSansJeu: rang(r.candidatsSansJeu), equivalent: !!r.candidats[0] && equivalente(c, r.candidats[0]), ms: r.ms,
  });
  lignes.push({ fichier: c.fichier, jeu: c.jeu, id: c.id, vraiNom: vraiNom(c), langue: c.langue, tags: c.tags, envers: k % 2 === 1, actuel: ligne(base), texte: ligne(neuf), lignesLues: neuf.lignes, kana: neuf.kana });
  process.stdout.write(rang(neuf.candidats) === 0 ? "." : "x");
  if (k % 20 === 19) fs.writeFileSync(fichierBase, JSON.stringify(cacheBase));
}
fs.writeFileSync(fichierBase, JSON.stringify(cacheBase));
await latin?.terminate();
await japonais?.terminate();
console.log();

// ---------- Tables ----------
type Stat = { n: number; nNum: number; langue: number; num: number; nom: number; top1: number; top1Eq: number; top5: number; top1SansJeu: number; ms: number };
const vide = (): Stat => ({ n: 0, nNum: 0, langue: 0, num: 0, nom: 0, top1: 0, top1Eq: 0, top5: 0, top1SansJeu: 0, ms: 0 });
const groupes = new Map<string, { actuel: Stat; texte: Stat }>();
for (const l of lignes) {
  for (const g of ["tous", l.jeu, ...l.tags.filter((t: string) => !t.startsWith("fond")).map((t: string) => `#${t}`), ...(l.envers ? ["#envers (texte.ts)"] : [])]) {
    const s = groupes.get(g) ?? { actuel: vide(), texte: vide() };
    for (const m of ["actuel", "texte"] as const) {
      const r = l[m], x = s[m];
      x.n++;
      x.nNum += Number(r.numeroOk !== null);
      x.langue += Number(r.langueOk);
      x.num += Number(r.numeroOk === true);
      x.nom += Number(r.nomOk);
      x.top1 += Number(r.rang === 0);
      x.top1Eq += Number(r.equivalent);
      x.top5 += Number(r.rang >= 0 && r.rang < 5);
      x.top1SansJeu += Number(r.rangSansJeu === 0);
      x.ms += r.ms;
    }
    groupes.set(g, s);
  }
}
const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)} %` : "n/a");
const ordre = (a: string, b: string) => (a === "tous" ? -1 : b === "tous" ? 1 : a.startsWith("#") === b.startsWith("#") ? a.localeCompare(b) : a.startsWith("#") ? 1 : -1);
let md = `# Lecture du texte : actuel (Tesseract) → texte.ts (PaddleOCR)\n\n${lignes.length} cartes redressées avec les vrais coins. Chaque case : actuel → texte.ts. Numéro : Yu-Gi-Oh! exclu (les scans du banc n'impriment ni code de set ni passcode). Recherche texte seule = nom + numéro dans les 40 150 références, jeu connu ; « 1re sans jeu » = jeu inconnu ; « 1re au tirage près » = la 1re a le même nom et le même numéro imprimés que la bonne (variante, réimpression : seule l'image les sépare).\n\n| Groupe | Cartes | Langue | Numéro | Nom lu | Recherche 1re | 1re au tirage près | Dans les 5 | 1re sans jeu | ms / carte |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const [g, { actuel: a, texte: t }] of [...groupes].sort((x, y) => ordre(x[0], y[0]))) {
  const f = (k: keyof Stat, n: keyof Stat = "n") => `${pct(a[k], a[n])} → ${pct(t[k], t[n])}`;
  md += `| ${g} | ${a.n} | ${f("langue")} | ${f("num", "nNum")} | ${f("nom")} | ${f("top1")} | ${f("top1Eq")} | ${f("top5")} | ${f("top1SansJeu")} | ${Math.round(a.ms / a.n)} → ${Math.round(t.ms / t.n)} |\n`;
}
md += `\n## Échecs texte.ts (bonne carte absente de la 1re place, jeu connu)\n\n${lignes.filter((l) => l.texte.rang !== 0).map((l) => `- ${l.fichier} ${l.jeu}/${l.id} « ${l.vraiNom} » ${l.langue} : nom lu « ${l.texte.nom ?? "-"} », numéro ${l.texte.numeros.join(",") || "-"}, langue ${l.texte.langue ?? "-"}, rang ${l.texte.rang} [${l.tags.join(", ")}${l.envers ? ", envers" : ""}]`).join("\n")}\n`;
fs.writeFileSync(`${DOSSIER}/${opts.label}.json`, JSON.stringify(lignes, null, 1));
fs.writeFileSync(`${DOSSIER}/${opts.label}.md`, md);
console.log(md.split("\n## Échecs")[0]);
process.exit(0);
