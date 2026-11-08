// Replays the real scans of scans/ through the current pipeline (auto outline, and hand corners when given).
// Usage (from phase0/): node experiences/essai-scans.ts
import fs from "node:fs";
import { chargerReferences, identifierPhoto } from "../reconnaissance.ts";
import type { Point } from "../vision.ts";

// Hand-placed corners (photo pixels, TL TR BR BL), measured on the photos.
const MAIN: Record<string, Point[]> = {
  "2026-11-03T20-12-06-159Z": [[336, 521], [1416, 521], [1416, 2030], [336, 2030]],
};

chargerReferences();
for (const f of fs.readdirSync("scans").filter((f) => f.endsWith(".jpg")).sort()) {
  const nom = f.replace(".jpg", "");
  const photo = fs.readFileSync(`scans/${f}`);
  for (const coins of MAIN[nom] ? [undefined, MAIN[nom]] : [undefined]) {
    const r = await identifierPhoto(photo, coins);
    const c = r.candidats[0];
    console.log(`${nom} ${coins ? "main" : "auto"} → ${r.reconnue ? "" : "[NON RECONNUE] "}${c.jeu} ${c.id} ${c.nom} sim ${c.sim.toFixed(3)} score ${c.score.toFixed(3)} num ${r.numeros[0] ?? "-"} langue ${r.langue ?? "-"} ${r.ms} ms`);
  }
}
