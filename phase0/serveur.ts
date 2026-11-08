// Phone scanner app: serves app.html, runs the local recognition on uploaded photos, serves reference images.
// Usage: npm run serveur, then open the printed address on the phone (same Wi-Fi as this PC).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prixCardmarket } from "./prix.ts";
import { chargerReferences, identifierPhoto, trouverRef } from "./reconnaissance.ts";
import { lireCarte } from "./texte.ts";
import { empreintes, type Point } from "./vision.ts";

const PORT = Number(process.env.PORT ?? 3000);
const TAILLE_MAX = 25 * 1024 * 1024; // a phone photo is 3-8 MB; the page already shrinks it before sending

const nbRefs = chargerReferences();
if (!nbRefs) {
  console.error("Index vide : lancer d'abord npm run indexer (voir README).");
  process.exit(1);
}

function lireCorps(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    req.on("data", (m: Buffer) => {
      taille += m.length;
      if (taille > TAILLE_MAX) { ko(new Error("photo trop lourde")); req.destroy(); } else morceaux.push(m);
    });
    req.on("end", () => ok(Buffer.concat(morceaux)));
    req.on("error", ko);
  });
}

const json = (res: http.ServerResponse, code: number, corps: unknown) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corps));
};

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync("app.html"));
    } else if (req.method === "GET" && url.pathname.startsWith("/references/")) {
      // Only files inside references/: the normalized path must stay under it.
      const fichier = path.normalize(decodeURIComponent(url.pathname.slice(1)));
      if (!fichier.startsWith(`references${path.sep}`) || !fs.existsSync(fichier)) return json(res, 404, { erreur: "image introuvable" });
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=604800" });
      res.end(fs.readFileSync(fichier));
    } else if (req.method === "POST" && url.pathname === "/api/scan") {
      // ?coins=x1,y1,...,x4,y4: corners placed by hand in the app (top-left, top-right, bottom-right, bottom-left).
      const v = url.searchParams.get("coins")?.split(",").map(Number);
      if (v && (v.length !== 8 || !v.every(Number.isFinite))) return json(res, 400, { erreur: "coins invalides" });
      const coinsManuels = v && [0, 2, 4, 6].map((i) => [v[i], v[i + 1]] as Point);
      const photo = await lireCorps(req);
      const { carte, texte, ...r } = await identifierPhoto(photo, coinsManuels);
      // Every real scan is kept with its result: these photos are the test set that matters (hand-placed corners
      // are the outline's ground truth).
      const nom = `scans/${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.mkdirSync("scans", { recursive: true });
      fs.writeFileSync(`${nom}.jpg`, photo);
      fs.writeFileSync(`${nom}.json`, JSON.stringify({ ...r, texte, coinsManuels: !!coinsManuels }, null, 1));
      const apercu = await sharp(carte).resize(480).jpeg({ quality: 82 }).toBuffer();
      console.log(`scan → ${r.candidats[0].jeu} ${r.candidats[0].nom} [${r.langue ?? "?"}] ${(r.ms / 1000).toFixed(1)} s`);
      json(res, 200, { ...r, texte, carte: `data:image/jpeg;base64,${apercu.toString("base64")}` });
    } else if (req.method === "GET" && url.pathname === "/api/prix") {
      const ref = trouverRef(url.searchParams.get("jeu") ?? "", url.searchParams.get("id") ?? "");
      if (!ref) return json(res, 404, { erreur: "carte inconnue" });
      json(res, 200, await prixCardmarket(ref, url.searchParams.get("langue")));
    } else if (req.method === "GET" && url.pathname === "/api/etat") {
      json(res, 200, { cartes: nbRefs });
    } else {
      json(res, 404, { erreur: "introuvable" });
    }
  } catch (e) {
    console.error(`${req.method} ${url.pathname} : ${e}`);
    json(res, 500, { erreur: e instanceof Error ? e.message : String(e) });
  }
});

// Load the models now, so the first scan at the counter does not wait 3-4 s for them.
const blanche = await sharp({ create: { width: 1260, height: 1760, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
await Promise.all([empreintes([blanche]), lireCarte(blanche)]);

serveur.listen(PORT, "0.0.0.0", () => {
  const adresses = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => `http://${a!.address}:${PORT}`);
  console.log(`${nbRefs} cartes de référence chargées.`);
  console.log(`Sur ce PC : http://localhost:${PORT}`);
  console.log(`Sur le téléphone (même Wi-Fi) : ${adresses.join("  ou  ") || "adresse réseau introuvable"}`);
});
