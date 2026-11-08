// Self-check of the pure helpers. Run: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codeYgoSansLangue, ecrireCsv, langueCodeYgo, langueTexte, lireCsv, norm } from "./commun.ts";
import { analyser } from "./texte.ts";

assert.equal(norm("Pokémon  1re Édition!"), "pokemon1reedition");
assert.equal(norm(null), "");

assert.equal(codeYgoSansLangue("LOB-FR001"), "LOB-001");
assert.equal(codeYgoSansLangue("LOB-EN001"), "LOB-001");
assert.equal(codeYgoSansLangue("LOB-F001"), "LOB-001");
assert.equal(codeYgoSansLangue("sdk-001"), "SDK-001");

assert.equal(langueCodeYgo("LOB-FR001"), "fr");
assert.equal(langueCodeYgo("LOB-G001"), "de");
assert.equal(langueCodeYgo("SDK-001"), null);
assert.equal(langueCodeYgo("OP01-001"), null);

assert.equal(langueTexte("Cherchez dans votre deck une carte Énergie de base, puis attachez-la à ce Pokémon. Mélangez ensuite votre deck. Faiblesse Résistance Retraite"), "fr");
assert.equal(langueTexte("This legendary dragon is a powerful engine of destruction. Few have faced this creature and lived to tell the tale."), "en");
assert.equal(langueTexte("Durchsuche dein Deck nach einer Karte und lege die Karte auf deine Hand. Schwäche Resistenz Rückzug"), "de");
assert.equal(langueTexte("| ; 4 d 7 ? > 4"), null);
assert.equal(langueTexte("MONSTER REBORN Target 1 monster in either GY; Special Summon it."), "en");
assert.equal(langueTexte("Évolution de Venipatte Choc Venin Le Pokémon Actif de votre adversaire est maintenant Empoisonné. Faiblesse Résistance Retraite"), "fr");

// Text lookup on lines as the OCR returns them (positions as a share of the card): French Pikachu from 151.
const lu = analyser([
  { texte: "Pikachu", conf: 0.99, x0: 0.08, y0: 0.03, x1: 0.3, y1: 0.07 },
  { texte: "MEW FR 025/165", conf: 0.95, x0: 0.05, y0: 0.94, x1: 0.3, y1: 0.96 },
]);
assert.equal(lu.candidats[0]?.id, "sv03.5-025");
assert.equal(lu.langue, "fr");

// French Lorcana card: the bottom line gives number, language and set.
const elsa = analyser([
  { texte: "ELSA", conf: 0.99, x0: 0.06, y0: 0.5, x1: 0.2, y1: 0.54 },
  { texte: "Le cinquième esprit", conf: 0.95, x0: 0.06, y0: 0.54, x1: 0.4, y1: 0.57 },
  { texte: "48/204 · FR · 5", conf: 0.9, x0: 0.04, y0: 0.95, x1: 0.2, y1: 0.97 },
]);
assert.equal(elsa.numero, "5-48");
assert.equal(elsa.langue, "fr");

const f = path.join(os.tmpdir(), "phase0-test.csv");
ecrireCsv(f, [{ a: 'Dragon "Blanc"; 1re', b: "ligne\nsuivante", c: "" }, { a: "é", b: "2", c: "x" }]);
assert.deepEqual(lireCsv(f), [{ a: 'Dragon "Blanc"; 1re', b: "ligne\nsuivante", c: "" }, { a: "é", b: "2", c: "x" }]);
fs.writeFileSync(f, "a,b\r\n1,2\r\n"); // Excel export with commas
assert.deepEqual(lireCsv(f), [{ a: "1", b: "2" }]);

console.log("OK");
