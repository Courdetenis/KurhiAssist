// Cardmarket public files (catalog + daily price guide) and the Cardmarket products of an identified card.
import fs from "node:fs";
import type { Jeu, Ref } from "./commun.ts";

export type ProduitCm = { idProduct: number; nom: string; trend: number | null; avg30: number | null; lien: string };

const JEUX_CM: Record<Jeu, [number, string]> = { pokemon: [6, "Pokemon"], yugioh: [3, "YuGiOh"], onepiece: [18, "OnePiece"], riftbound: [22, "Riftbound"], lorcana: [19, "Lorcana"] };

async function json(url: string): Promise<any> {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

async function fichierCm(chemin: string): Promise<any> {
  const local = `cache/${chemin.replaceAll("/", "_")}`;
  const frais = fs.existsSync(local) && Date.now() - fs.statSync(local).mtimeMs < 86_400_000;
  if (!frais) {
    const r = await fetch(`https://downloads.s3.cardmarket.com/productCatalog/${chemin}`);
    if (!r.ok) throw new Error(`Cardmarket ${chemin}: HTTP ${r.status}`);
    fs.mkdirSync("cache", { recursive: true });
    fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(local, "utf8"));
}

type Catalogue = { produits: { idProduct: number; name: string }[]; prix: Map<number, any> };
const catalogues = new Map<Jeu, Promise<Catalogue>>();

function catalogue(jeu: Jeu): Promise<Catalogue> {
  if (!catalogues.has(jeu)) {
    const id = JEUX_CM[jeu][0];
    catalogues.set(jeu, Promise.all([
      fichierCm(`productList/products_singles_${id}.json`),
      fichierCm(`priceGuide/price_guide_${id}.json`),
    ]).then(([p, g]) => ({ produits: p.products, prix: new Map(g.priceGuides.map((x: any) => [x.idProduct, x])) })));
  }
  return catalogues.get(jeu)!;
}

function produit(jeu: Jeu, c: Catalogue, idProduct: number, nom: string): ProduitCm {
  const p = c.prix.get(idProduct);
  return {
    idProduct,
    nom,
    // 0 = no sale; foil-only products (Lorcana Enchanted) have only foil prices.
    trend: p?.trend || p?.["trend-foil"] || null,
    avg30: p?.avg30 || p?.["avg30-foil"] || null,
    lien: `https://www.cardmarket.com/fr/${JEUX_CM[jeu][1]}/Products/Search?searchString=${encodeURIComponent(nom)}`,
  };
}

// Prices are indicative here: the Cardmarket price guide mixes all languages and conditions.
export async function prixCardmarket(r: Ref, langue: string | null): Promise<{ produits: ProduitCm[]; note?: string }> {
  const c = await catalogue(r.jeu);
  const parNom = (filtre: (nom: string) => boolean) => c.produits.filter((p) => filtre(p.name)).map((p) => produit(r.jeu, c, p.idProduct, p.name));
  switch (r.jeu) {
    case "pokemon": {
      // TCGdex links each variant (normal, reverse, 1st edition, stamps) to its Cardmarket product.
      const lg = ["fr", "de", "es", "it", "pt"].includes(langue ?? "") ? langue : "en";
      const d = (await json(`https://api.tcgdex.net/v2/${lg}/cards/${r.id}`)) ?? (await json(`https://api.tcgdex.net/v2/en/cards/${r.id}`));
      // Older cards have no per-variant link, only the card-level pricing block.
      const ids = new Set<number>([...(d?.variants_detailed ?? []).map((v: any) => v.thirdParty?.cardmarket), d?.pricing?.cardmarket?.idProduct].filter(Boolean));
      return { produits: [...ids].map((id) => produit("pokemon", c, id, c.produits.find((p) => p.idProduct === id)?.name ?? r.nom)) };
    }
    case "yugioh": {
      const produits = parNom((n) => n === r.nom);
      return { produits, note: produits.length > 1 ? `${produits.length} fiches Cardmarket (une par édition) : choisir l'édition` : undefined };
    }
    case "onepiece":
      return { produits: parNom((n) => n.includes(`(${r.numero})`)) };
    case "riftbound":
      return { produits: parNom((n) => n === r.nom) };
    case "lorcana": {
      // ponytail: name match only (Cardmarket has no collector number); regular and Enchanted prints share the name.
      const produits = parNom((n) => n === r.nom);
      return { produits, note: produits.length > 1 ? `${produits.length} fiches Cardmarket : choisir la version (normale, Enchanted, promo)` : undefined };
    }
  }
}
