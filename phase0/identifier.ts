// Phase 0 batch tool: runs the local recognition on every photo of a folder.
// Writes resultats/local.json + local.html and appends new photos to verite.csv.
// Usage: npm run identifier [-- --dossier photos]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ecrireCsv, fichierRef, lireCsv } from "./commun.ts";
import { chargerReferences, identifierPhoto, type Resultat } from "./reconnaissance.ts";

const { values: opts } = parseArgs({ options: { dossier: { type: "string", default: "photos" } } });

type Entree = Omit<Resultat, "carte"> & { fichier: string };

const nbRefs = chargerReferences();
if (!nbRefs) {
  console.error("Index vide : lancer d'abord npm run indexer (voir README).");
  process.exit(1);
}

fs.mkdirSync("resultats/recadrages", { recursive: true });
const fichierRun = "resultats/local.json";
const resultats: Record<string, Entree> = fs.existsSync(fichierRun) ? JSON.parse(fs.readFileSync(fichierRun, "utf8")) : {};
const tout = fs.readdirSync(opts.dossier);
const photos = tout.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const heic = tout.filter((f) => /\.(heic|heif)$/i.test(f)).length;
if (heic) console.warn(`${heic} photo(s) HEIC ignorée(s) : exporter en JPEG (voir README).`);
const aFaire = photos.filter((f) => !resultats[f]);
console.log(`${nbRefs} cartes de référence. ${photos.length} photos, ${aFaire.length} à traiter.`);

let erreurs = 0;
for (const f of aFaire) {
  try {
    const { carte, ...e } = await identifierPhoto(fs.readFileSync(path.join(opts.dossier, f)));
    fs.writeFileSync(`resultats/recadrages/${f}.jpg`, carte);
    resultats[f] = { fichier: f, ...e };
    fs.writeFileSync(fichierRun, JSON.stringify(resultats, null, 1));
    const c = e.candidats[0];
    console.log(`✓ ${f} → ${c.jeu} ${c.nom} ${c.numero} [${e.langue ?? "?"}] ressemblance ${(c.sim * 100).toFixed(0)} %${c.numeroLu ? " + numéro lu" : ""} (${(e.ms / 1000).toFixed(1)} s)`);
  } catch (err) {
    erreurs++;
    console.error(`✗ ${f} : ${err}`);
  }
}

// ---------- HTML report ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const lignes = photos.filter((f) => resultats[f]).map((f) => {
  const e = resultats[f];
  const cands = e.candidats.slice(0, 4).map((c, i) => `<div class="cand${i ? "" : " top"}"><img src="../${esc(fichierRef(c))}" loading="lazy"><div><code>${esc(c.id)}</code> ${esc(c.jeu)}<br>${esc(c.nom)}<br><small>${esc(c.set)} · ${esc(c.numero)}</small><br>ressemblance ${(c.sim * 100).toFixed(0)} %${c.numeroLu ? " · <b>numéro lu ✓</b>" : ""}</div></div>`).join("");
  const cm = e.cardmarket.slice(0, 4).map((p) => `<a href="${esc(p.lien)}">${p.idProduct}</a> ${esc(p.nom)} : trend ${p.trend ?? "–"} €, moy. 30 j ${p.avg30 ?? "–"} €`).join("<br>");
  return `<tr><td><img class="photo" src="../${esc(opts.dossier)}/${esc(f)}"><br><small>${esc(f)}</small></td>
<td><img class="photo" src="recadrages/${esc(f)}.jpg"><br><small>${e.detecte ? "contour trouvé" : "<b>contour non trouvé</b> (photo entière)"}</small></td>
<td>langue <b>${esc(e.langue ?? "?")}</b><br>numéros lus : ${esc(e.numeros.join(", ") || "aucun")}<br><small class="ocr">${esc(e.texte)}</small></td>
<td>${cands}</td>
<td>${cm || "–"}${e.note ? `<br><i>${esc(e.note)}</i>` : ""}</td>
<td><small>${(e.ms / 1000).toFixed(1)} s</small></td></tr>`;
}).join("\n");
fs.writeFileSync("resultats/local.html", `<!doctype html><meta charset="utf-8"><title>Phase 0 – reconnaissance locale</title>
<style>body{font:14px system-ui;margin:16px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ccc;padding:8px;vertical-align:top}
.photo{max-width:180px;max-height:250px}.cand{display:flex;gap:6px;margin-bottom:6px;opacity:.7}.cand.top{opacity:1;font-weight:600}.cand img{width:70px}.ocr{color:#666;display:block;max-width:260px}</style>
<h1>Phase 0 – reconnaissance locale</h1><p>${Object.keys(resultats).length} photos. Candidat en gras = choix automatique.</p>
<table><tr><th>Photo</th><th>Carte détectée</th><th>Texte lu</th><th>Candidats</th><th>Cardmarket</th><th>Temps</th></tr>${lignes}</table>`);

// ---------- Ground truth to check: new photos are appended, rows already there are never touched ----------
const verite = fs.existsSync("verite.csv") ? lireCsv("verite.csv") : [];
const nouvelles = photos.filter((f) => resultats[f] && !verite.some((v) => v.fichier === f));
if (nouvelles.length) {
  ecrireCsv("verite.csv", [...verite, ...nouvelles.map((f) => {
    const { candidats: [c], langue } = resultats[f];
    return { fichier: f, jeu: c.jeu, nom: c.nom, numero: c.numero, langue, id_correct: c.id, verifie: "" };
  })]);
  console.log(`verite.csv : ${nouvelles.length} ligne(s) ajoutée(s), à vérifier puis marquer "o" dans la colonne verifie (voir README).`);
}
console.log(`Rapport : resultats/local.html${erreurs ? ` · ${erreurs} erreur(s), relancer pour réessayer` : ""}`);
