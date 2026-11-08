// Builds the local reference index: card list per game -> image download (references/) -> fingerprint (index/).
// Run once, then again to add new sets: what is already downloaded or indexed is skipped.
// Usage: npm run indexer [-- --jeux pokemon,onepiece] [--limite 50]
import fs from "node:fs";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { JEUX, codeYgoSansLangue, fichierRef, type Jeu, type Ref } from "./commun.ts";
import { DIM, empreintes } from "./vision.ts";

async function json(url: string): Promise<any> {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (essai >= 3) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (essai >= 3) throw new Error(`${url} : ${e}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * essai));
  }
}

const LISTES: Record<Jeu, () => Promise<Ref[]>> = {
  async pokemon() {
    const [cartes, sets] = await Promise.all([json("https://api.tcgdex.net/v2/en/cards"), json("https://api.tcgdex.net/v2/en/sets")]);
    const infos = new Map<string, any>(sets.map((s: any) => [s.id, s]));
    return cartes
      .filter((c: any) => c.image && !c.image.includes("/tcgp/")) // TCG Pocket is a video game, not paper cards
      .map((c: any) => {
        const s = infos.get(c.id.slice(0, c.id.lastIndexOf("-")));
        return { id: c.id, jeu: "pokemon", nom: c.name, numero: `${c.localId}/${s?.cardCount?.official ?? "?"}`, set: s?.name ?? "", image: `${c.image}/low.jpg` };
      });
  },
  async yugioh() {
    const { data } = await json("https://db.ygoprodeck.com/api/v7/cardinfo.php");
    return data.flatMap((c: any) => {
      const codes = [...new Set<string>((c.card_sets ?? []).map((s: any) => codeYgoSansLangue(s.set_code)))];
      // One reference per artwork: alternate artworks have their own image id.
      return (c.card_images ?? []).map((img: any) => ({
        id: String(img.id), jeu: "yugioh", nom: c.name, numero: codes[0] ?? "", set: `${codes.length} édition(s)`, image: img.image_url_small, codes,
      }));
    });
  },
  async onepiece() {
    const listes = await Promise.all(["allSetCards", "allSTCards"].map((l) => json(`https://optcgapi.com/api/${l}/`)));
    const refs = new Map<string, Ref>();
    for (const c of listes.flat()) {
      refs.set(c.card_image_id, { id: c.card_image_id, jeu: "onepiece", nom: c.card_name, numero: c.card_set_id, set: c.set_name, image: c.card_image });
    }
    return [...refs.values()];
  },
  async riftbound() {
    const premiere = await json("https://api.riftcodex.com/cards?page=1&size=100");
    const pages = [premiere, ...(await Promise.all(Array.from({ length: premiere.pages - 1 }, (_, i) => json(`https://api.riftcodex.com/cards?page=${i + 2}&size=100`))))];
    return pages.flatMap((p) => p.items).filter((c: any) => c.media?.image_url).map((c: any) => ({
      id: c.riftbound_id, jeu: "riftbound", nom: c.name, numero: `${c.set?.set_id}-${String(c.collector_number).padStart(3, "0")}`, set: c.set?.label ?? "", image: c.media.image_url,
    }));
  },
  async lorcana() {
    // Lorcast lists English prints only; the art is the same in every language. numero = "<set>-<number>", as
    // printed at the bottom left: "48/204 · FR · 5".
    const { results: sets } = await json("https://api.lorcast.com/v0/sets");
    const refs: Ref[] = [];
    for (const s of sets) {
      await new Promise((ok) => setTimeout(ok, 150)); // Lorcast asks for at most 10 requests per second
      for (const c of await json(`https://api.lorcast.com/v0/sets/${encodeURIComponent(s.code)}/cards`)) {
        const image = c.image_uris?.digital?.normal;
        if (image) refs.push({ id: c.id, jeu: "lorcana", nom: c.version ? `${c.name} - ${c.version}` : c.name, numero: `${s.code}-${c.collector_number}`, set: s.name, image });
      }
    }
    return refs;
  },
};

// YGOPRODeck blacklists clients above 20 requests per second: 4 workers x 1 request per 250 ms stays under.
const DEBIT: Partial<Record<Jeu, { parallele: number; pauseMs: number }>> = { yugioh: { parallele: 4, pauseMs: 250 }, lorcana: { parallele: 6, pauseMs: 100 } };

async function telecharger(jeu: Jeu, refs: Ref[]): Promise<Ref[]> {
  const { parallele, pauseMs } = DEBIT[jeu] ?? { parallele: 12, pauseMs: 0 };
  let suivant = 0;
  let echecs = 0;
  await Promise.all(Array.from({ length: parallele }, async () => {
    while (suivant < refs.length) {
      const r = refs[suivant++];
      if (fs.existsSync(fichierRef(r))) continue;
      if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
      try {
        const reponse = await fetch(r.image);
        if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
        // 300 px wide is plenty for a 224 px fingerprint and keeps the folder small.
        await sharp(Buffer.from(await reponse.arrayBuffer())).resize(300).flatten({ background: "#fff" }).jpeg({ quality: 85 }).toFile(fichierRef(r));
      } catch {
        echecs++;
      }
      if (suivant % 1000 === 0) console.log(`  images : ${suivant}/${refs.length}`);
    }
  }));
  if (echecs) console.warn(`  ${echecs} image(s) introuvable(s), ignorée(s).`);
  return refs.filter((r) => fs.existsSync(fichierRef(r)));
}

function sauver(jeu: Jeu, refs: Ref[], vecteurs: Map<string, Float32Array>): void {
  const presentes = refs.filter((r) => vecteurs.has(r.id));
  const bin = new Float32Array(presentes.length * DIM);
  presentes.forEach((r, i) => bin.set(vecteurs.get(r.id)!, i * DIM));
  fs.writeFileSync(`index/${jeu}.json`, JSON.stringify(presentes));
  fs.writeFileSync(`index/${jeu}.bin`, Buffer.from(bin.buffer));
}

export function chargerIndex(jeu: Jeu): { refs: Ref[]; vecteurs: Float32Array } | null {
  if (!fs.existsSync(`index/${jeu}.json`)) return null;
  const b = fs.readFileSync(`index/${jeu}.bin`);
  return { refs: JSON.parse(fs.readFileSync(`index/${jeu}.json`, "utf8")), vecteurs: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
}

if (import.meta.main) {
  const { values: opts } = parseArgs({
    options: { jeux: { type: "string", default: JEUX.join(",") }, limite: { type: "string" } },
  });
  fs.mkdirSync("index", { recursive: true });
  for (const jeu of opts.jeux.split(",") as Jeu[]) {
    const t0 = Date.now();
    console.log(`${jeu} : liste des cartes...`);
    let refs = (await LISTES[jeu]()).filter((r) => r.id && r.image); // a few source entries have no image
    if (opts.limite) refs = refs.slice(0, Number(opts.limite));
    fs.mkdirSync(`references/${jeu}`, { recursive: true });
    console.log(`${jeu} : ${refs.length} images de référence.`);
    refs = await telecharger(jeu, refs);

    const existant = chargerIndex(jeu);
    const vecteurs = new Map<string, Float32Array>(existant?.refs.map((r, i) => [r.id, existant.vecteurs.slice(i * DIM, (i + 1) * DIM)]) ?? []);
    const aFaire = refs.filter((r) => !vecteurs.has(r.id));
    for (let i = 0; i < aFaire.length; i += 16) {
      const lot = aFaire.slice(i, i + 16);
      const v = await empreintes(lot.map((r) => fs.readFileSync(fichierRef(r))));
      lot.forEach((r, j) => vecteurs.set(r.id, v[j][r.jeu])); // a reference is indexed with its own game's artwork box
      if ((i / 16) % 60 === 59) { sauver(jeu, refs, vecteurs); console.log(`  empreintes : ${i + 16}/${aFaire.length}`); }
    }
    sauver(jeu, refs, vecteurs);
    console.log(`${jeu} : ${vecteurs.size} cartes indexées en ${Math.round((Date.now() - t0) / 1000)} s.`);
  }
}
