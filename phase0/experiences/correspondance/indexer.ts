// Builds the fingerprint index of one pass (see PASSES in correspondance.ts) from the local reference images.
// Resumable: what is already in the index is skipped. --sous-ensemble = screening subset (bench cards, every
// card sharing a bench card's name, 10 % random others) into index-sous/.
// Usage (from phase0/): node experiences/correspondance/indexer.ts --passe dv2s_ent [--sous-ensemble] [--fils 8]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { JEUX, type Ref } from "../../commun.ts";
import { chargerIndex } from "../../indexer.ts";
import { DOSSIER, FILS, PASSES, encoder, imageRef } from "./correspondance.ts";

const { values: opts } = parseArgs({ options: { passe: { type: "string", default: "dv2s_ent" }, "sous-ensemble": { type: "boolean" }, fils: { type: "string", default: "0" }, lot: { type: "string", default: "16" } } });
const passe = PASSES[opts.passe!];
FILS.n = Number(opts.fils);
const sortie = path.join(DOSSIER, opts["sous-ensemble"] ? "index-sous" : "index", passe.nom);
fs.mkdirSync(sortie, { recursive: true });

let garder = (_: Ref) => true;
if (opts["sous-ensemble"]) {
  const verite: { jeu: string; id: string; nom: string }[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8"));
  const noms = new Set(verite.map((c) => `${c.jeu}/${c.nom}`));
  const ids = new Set(verite.map((c) => `${c.jeu}/${c.id}`));
  // Deterministic 10 % sample from the id hash.
  const hache = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  garder = (r) => ids.has(`${r.jeu}/${r.id}`) || noms.has(`${r.jeu}/${r.nom}`) || hache(r.id) % 10 === 0;
}

const t0 = Date.now();
let faits = 0;
for (const jeu of JEUX) {
  const refs = chargerIndex(jeu)!.refs.filter(garder);
  const fBin = path.join(sortie, `${jeu}.bin`), fJson = path.join(sortie, `${jeu}.json`);
  const vecteurs = new Map<string, Float32Array>();
  if (fs.existsSync(fJson)) {
    const anciens: Ref[] = JSON.parse(fs.readFileSync(fJson, "utf8"));
    const b = fs.readFileSync(fBin);
    const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const t = v.length / anciens.length;
    anciens.forEach((r, i) => vecteurs.set(r.id, v.slice(i * t, (i + 1) * t)));
  }
  const sauver = () => {
    const presentes = refs.filter((r) => vecteurs.has(r.id));
    const t = vecteurs.values().next().value?.length ?? 0;
    const bin = new Float32Array(presentes.length * t);
    presentes.forEach((r, i) => bin.set(vecteurs.get(r.id)!, i * t));
    fs.writeFileSync(fJson, JSON.stringify(presentes));
    fs.writeFileSync(fBin, Buffer.from(bin.buffer));
  };
  const aFaire = refs.filter((r) => !vecteurs.has(r.id));
  const L = Number(opts.lot);
  for (let i = 0; i < aFaire.length; i += L) {
    const lot = aFaire.slice(i, i + L);
    const s = await encoder(lot.map(imageRef), passe);
    lot.forEach((r, j) => {
      const D = s[j].cls.length;
      const v = new Float32Array(3 * D);
      v.set(s[j].cls, 0); v.set(s[j].moy, D); v.set(s[j].art[jeu], 2 * D);
      vecteurs.set(r.id, v);
    });
    faits += lot.length;
    if ((i / L) % 50 === 49) { sauver(); console.log(`  ${jeu} ${i + L}/${aFaire.length} (${Math.round((Date.now() - t0) / faits)} ms/carte)`); }
  }
  sauver();
  console.log(`${jeu} : ${refs.length} cartes`);
}
console.log(`${passe.nom} : ${faits} empreintes en ${Math.round((Date.now() - t0) / 1000)} s (${faits ? Math.round((Date.now() - t0) / faits) : 0} ms/carte)`);
