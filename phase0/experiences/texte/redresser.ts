// Bench helper: straightens each photo with its TRUE corners to 1260x1760 (like redresserCarte), cached on disk,
// so the OCR is measured apart from outline detection.
import fs from "node:fs";
import sharp from "sharp";
import { HAUTEUR, LARGEUR, opencv } from "../../vision.ts";

export type Cas = { fichier: string; jeu: string; id: string; nom: string; langue: string; coins: [number, number][]; tags: string[] };

const DOSSIER = "experiences/texte/tmp/cartes";

export async function carteRedressee(c: Cas): Promise<Buffer> {
  const sortie = `${DOSSIER}/${c.fichier}`;
  if (fs.existsSync(sortie)) return fs.readFileSync(sortie);
  const { cv } = await opencv();
  const { data, info } = await sharp(fs.readFileSync(`banc/photos/${c.fichier}`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
  const M = cv.getPerspectiveTransform(
    cv.matFromArray(4, 1, cv.CV_32FC2, c.coins.flat()),
    cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, LARGEUR, 0, LARGEUR, HAUTEUR, 0, HAUTEUR]),
  );
  const carte = new cv.Mat();
  cv.warpPerspective(src, carte, M, new cv.Size(LARGEUR, HAUTEUR));
  const jpeg = await sharp(Buffer.from(carte.data), { raw: { width: LARGEUR, height: HAUTEUR, channels: 4 } }).removeAlpha().jpeg({ quality: 92 }).toBuffer();
  src.delete(); M.delete(); carte.delete();
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(sortie, jpeg);
  return jpeg;
}

if (import.meta.main) {
  const verite: Cas[] = JSON.parse(fs.readFileSync("banc/verite.json", "utf8"));
  for (const c of verite) await carteRedressee(c);
  console.log(`${verite.length} cartes dans ${DOSSIER}`);
  process.exit(0);
}
