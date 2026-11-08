// Shared helpers (pure, no network) for the phase 0 test bench.
import fs from "node:fs";

export const JEUX = ["pokemon", "yugioh", "onepiece", "riftbound", "lorcana"] as const;
export type Jeu = (typeof JEUX)[number];

// One reference card (one artwork) in the local index.
export type Ref = { id: string; jeu: Jeu; nom: string; numero: string; set: string; image: string; codes?: string[] };

export const fichierRef = (r: Pick<Ref, "jeu" | "id">) => `references/${r.jeu}/${r.id.replace(/[^\w.-]/g, "_")}.jpg`;

// Comparison key: lowercase, no accents, alphanumerics only.
export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// "LOB-FR001", "LOB-EN001", "LOB-F001" -> "LOB-001" (YGOPRODeck lists English codes only).
export function codeYgoSansLangue(code: string): string {
  const m = code.toUpperCase().trim().match(/^([A-Z0-9]+)-[A-Z]{0,2}(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : code.toUpperCase().trim();
}

// Language of a Yu-Gi-Oh! set code: LOB-FR001 -> fr, old LOB-F001 -> fr.
const LETTRES_YGO: Record<string, string> = { EN: "en", E: "en", FR: "fr", F: "fr", DE: "de", G: "de", IT: "it", I: "it", SP: "es", S: "es", PT: "pt", P: "pt", JP: "ja", JA: "ja", KR: "ko", K: "ko" };
export function langueCodeYgo(code: string): string | null {
  return LETTRES_YGO[code.toUpperCase().match(/^[A-Z0-9]{2,4}-([A-Z]{1,2})\d{3}$/)?.[1] ?? ""] ?? null;
}

// Frequent card words per language (accents removed), Pokémon + Yu-Gi-Oh! + One Piece + Riftbound wording.
// A word shared by two languages counts for both. No 1-letter words: OCR noise produces them everywhere.
const MOTS: Record<string, string[]> = {
  fr: ["le", "les", "des", "du", "et", "au", "sur", "votre", "vos", "cette", "carte", "cartes", "attaque", "faiblesse", "retraite", "dresseur", "adversaire", "degats", "piochez", "effet", "pendant", "chaque", "niveau", "actif", "banc", "talent", "energie", "monstre", "monstres", "cible", "invocation", "speciale", "terrain", "cimetiere", "detruisez", "personnage"],
  en: ["the", "and", "of", "to", "on", "from", "your", "this", "card", "cards", "attack", "weakness", "retreat", "trainer", "opponent", "damage", "draw", "effect", "during", "each", "you", "stage", "evolves", "active", "bench", "ability", "energy", "monster", "monsters", "target", "summon", "special", "field", "graveyard", "destroy", "character", "characters", "leader", "play", "unit", "units", "battlefield", "might", "conquer", "exhaust", "ready"],
  de: ["der", "die", "das", "und", "ein", "eine", "deine", "deinen", "karte", "karten", "angriff", "schwache", "ruckzug", "gegner", "schaden", "effekt", "wahrend", "jede", "phase", "aktive", "bank", "fahigkeit", "monster", "beschworung", "spezialbeschworung", "spielfeld", "friedhof", "zerstore"],
  it: ["il", "di", "che", "gli", "tuo", "tua", "tuoi", "carta", "carte", "attacco", "debolezza", "ritirata", "allenatore", "avversario", "danni", "effetto", "durante", "ogni", "attivo", "panchina", "abilita", "mostro", "mostri", "evocazione", "terreno", "cimitero", "distruggi"],
  es: ["el", "los", "las", "del", "tu", "tus", "carta", "cartas", "ataque", "debilidad", "retirada", "entrenador", "rival", "dano", "efecto", "durante", "cada", "fase", "activo", "banca", "habilidad", "monstruo", "monstruos", "invocacion", "campo", "cementerio", "destruye"],
  pt: ["os", "do", "da", "dos", "uma", "seu", "sua", "carta", "cartas", "ataque", "fraqueza", "recuo", "treinador", "oponente", "dano", "efeito", "durante", "cada", "ativo", "banco", "habilidade", "monstro", "monstros", "invocacao", "campo", "cemiterio", "destrua"],
};

// Language from OCR text: needs 3 hits and a clear lead, else null (then the caller tries Japanese).
export function langueTexte(texte: string): string | null {
  const mots = texte.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/);
  const scores = Object.entries(MOTS).map(([l, liste]) => [l, mots.filter((m) => liste.includes(m)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [[langue, premier], [, second]] = scores;
  return premier >= 3 && premier >= 1.5 * second ? langue : null;
}

// CSV with ";" (French Excel default) and UTF-8 BOM so Excel keeps accents.
export function ecrireCsv(fichier: string, lignes: Record<string, unknown>[]): void {
  const cols = Object.keys(lignes[0] ?? {});
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texte = [cols.join(";"), ...lignes.map((l) => cols.map((c) => cell(l[c])).join(";"))].join("\r\n");
  fs.writeFileSync(fichier, "﻿" + texte + "\r\n");
}

export function lireCsv(fichier: string): Record<string, string>[] {
  const texte = fs.readFileSync(fichier, "utf8").replace(/^﻿/, "");
  const sep = texte.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const rangees: string[][] = [];
  let rangee: string[] = [];
  let cellule = "";
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i++; }
      else if (c === '"') guillemets = false;
      else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { rangee.push(cellule); cellule = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      rangee.push(cellule); rangees.push(rangee); rangee = []; cellule = "";
    } else cellule += c;
  }
  if (cellule || rangee.length) { rangee.push(cellule); rangees.push(rangee); }
  const [entetes, ...corps] = rangees.filter((r) => r.some((c) => c.trim()));
  return corps.map((r) => Object.fromEntries(entetes.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
