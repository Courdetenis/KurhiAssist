// Recognition of one photo, 100 % local: card outline (contour.ts) -> image fingerprint vs reference index ->
// text reading (PaddleOCR, texte.ts: name, number, language) -> both evidences fused -> Cardmarket.
// Shared by the batch tool (identifier.ts), the bench (banc/evaluer.ts) and the phone app server (serveur.ts).
import { JEUX, fichierRef, type Ref } from "./commun.ts";
import { chargerIndex } from "./indexer.ts";
import { prixCardmarket, type ProduitCm } from "./prix.ts";
import { lireCarte } from "./texte.ts";
import { DIM, accords, empreintes, pointsOrb, redresserCarte, type Empreinte, type Point } from "./vision.ts";

// ponytail: fixed weights against the fingerprint similarity, set on the synthetic bench; retune on real scans.
const POIDS_TEXTE = 0.12; // text score: name 0-1 + number 0-1
const POIDS_ORB = 0.2; // ORB matches, capped at 200
// ponytail: provisional threshold on the fused score below which the card is reported as not recognised
// (game not indexed, or photo unusable); to calibrate on out-of-index cards.
const SEUIL_RECONNUE = 0.7;

export type Candidat = Omit<Ref, "codes"> & { sim: number; texte: number; score: number; numeroLu: boolean };
export type Resultat = {
  detecte: boolean; reconnue: boolean; coins: [number, number][] | null; langue: string | null; numeros: string[]; texte: string;
  candidats: Candidat[]; cardmarket: ProduitCm[]; note?: string; ms: number; carte: Buffer;
};

// All games in one matrix: the best match also tells the game.
let refs: Ref[] = [];
let index = new Float32Array(0);
let position = new Map<string, number>();

export function chargerReferences(): number {
  const blocs: Float32Array[] = [];
  refs = [];
  for (const jeu of JEUX) {
    const ix = chargerIndex(jeu);
    if (ix) { refs.push(...ix.refs); blocs.push(ix.vecteurs); }
  }
  index = new Float32Array(refs.length * DIM);
  blocs.reduce((o, b) => (index.set(b, o), o + b.length), 0);
  position = new Map(refs.map((r, i) => [`${r.jeu}/${r.id}`, i]));
  return refs.length;
}

export const trouverRef = (jeu: string, id: string) => refs[position.get(`${jeu}/${id}`) ?? -1];

// Each reference is compared with the query's fingerprint for the reference's own game (its artwork box).
const similarite = (e: Empreinte, i: number) => {
  const v = e[refs[i].jeu];
  let s = 0;
  for (let d = 0, b = i * DIM; d < DIM; d++) s += v[d] * index[b + d];
  return s;
};

// ponytail: brute-force scan, ~20 ms for 40 000 cards; an ANN index only if the catalog grows 10x.
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

// coinsImposes: card corners placed by hand (photo pixels), instead of the outline detection.
export async function identifierPhoto(photo: Buffer, coinsImposes?: Point[]): Promise<Resultat> {
  if (!refs.length) throw new Error("Index vide : lancer d'abord npm run indexer.");
  const t0 = Date.now();
  const { orientations, trouve, coins } = await redresserCarte(photo, coinsImposes);
  const vecteurs = await empreintes(orientations);
  const tops = vecteurs.map((v) => plusProches(v, 20));
  const o = tops.reduce((m, t, i) => (t[0].sim > tops[m][0].sim ? i : m), 0);
  const carte = orientations[o];

  // Text: the reader handles upside-down cards itself and searches all games (the image may be wrong about it).
  const lu = await lireCarte(carte);
  const texte = new Map(lu.candidats.map((c) => [`${c.jeu}/${c.id}`, c.score]));

  // Pool = image shortlist + cards found by their printed name and number, each scored on three evidences:
  // fingerprint similarity, local features at the same place (ORB, read from the 300 px reference JPEGs), text.
  const pool = [...new Set([...tops[o].map((t) => t.i), ...lu.candidats.map((c) => position.get(`${c.jeu}/${c.id}`)).filter((i) => i !== undefined)])];
  const [q, ...orb] = await Promise.all([pointsOrb(carte), ...pool.map((i) => pointsOrb(fichierRef(refs[i])))]);
  const candidats: Candidat[] = pool.map((i, n) => {
    const { codes, ...r } = refs[i];
    const sim = similarite(vecteurs[o], i);
    const geo = POIDS_ORB * Math.min(accords(q, orb[n]), 200) / 200;
    const t = texte.get(`${r.jeu}/${r.id}`) ?? 0;
    return { ...r, sim, texte: t, score: sim + geo + POIDS_TEXTE * t, numeroLu: t >= 1.5 };
  }).sort((a, b) => b.score - a.score);
  const top = trouverRef(candidats[0].jeu, candidats[0].id);

  const { produits, note } = await prixCardmarket(top, lu.langue).catch((e) => ({ produits: [], note: `prix indisponibles : ${e.message}` }));
  return {
    detecte: trouve, reconnue: candidats[0].numeroLu || candidats[0].score >= SEUIL_RECONNUE, coins, langue: lu.langue, numeros: lu.numero ? [lu.numero] : [], texte: lu.nom ?? "",
    candidats: candidats.slice(0, 10), cardmarket: produits, note, ms: Date.now() - t0, carte,
  };
}
