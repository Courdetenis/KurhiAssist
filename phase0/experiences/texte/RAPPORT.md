# Lecture du texte des cartes : rapport

Banc : 240 photos synthétiques (`banc/verite.json`), chaque photo redressée avec ses VRAIS coins en 1260×1760
(l'OCR est mesuré seul, sans l'erreur de contour). Une carte sur deux est donnée **à l'envers (180°)** à `texte.ts`,
qui doit trouver le sens seul ; l'OCR actuel reçoit toujours la carte à l'endroit (dans l'appli, c'est l'image qui choisit le sens).

- **Actuel** = exactement ce que fait `reconnaissance.ts` : Tesseract eng+fra+deu+ita+spa+por sur la moitié basse,
  `numerosLus`, langue par code YGO / `langueTexte` / passe `jpn`. Il ne lit pas le nom ; sa « recherche texte » =
  cartes du jeu dont le numéro correspond.
- **texte.ts** = PaddleOCR (ONNX, CPU) sur toute la carte + tables de noms par langue + recherche floue.

Mesuré avec `node experiences/texte/evaluer.ts` (résultats complets : `resultats/texte.md`, détail par carte : `resultats/texte.json`).

## Résultats (actuel → texte.ts)

Numéro : Yu-Gi-Oh! non mesurable (les scans YGOPRODeck du banc n'impriment ni code de set ni passcode).
Recherche texte seule = nom + numéro lus, cherchés dans les 40 150 références, jeu connu.
« Au tirage près » = la 1re proposition a le même nom ET le même numéro imprimés que la bonne carte (variante, réimpression,
signature, parallèle : le texte ne peut pas les séparer, l'image si).

| Groupe | Cartes | Langue | Numéro | Nom lu | Recherche 1re | 1re au tirage près | Dans les 5 | 1re sans jeu | ms / carte |
|---|---|---|---|---|---|---|---|---|---|
| **tous** | 240 | 74 % → **95 %** | 11 % → **67 %** | 0 % → **94 %** | 8 % → **74 %** | 8 % → **81 %** | 8 % → **90 %** | 8 % → 74 % | 6745 → **460** |
| pokemon | 101 | 70 % → 90 % | 18 % → 65 % | 0 % → 92 % | 16 % → 74 % | 16 % → 74 % | 18 % → 87 % | 16 % → 74 % | 7783 → 494 |
| yugioh | 60 | 70 % → 97 % | n/a | 0 % → 93 % | 0 % → 93 % | 0 % → 93 % | 0 % → 95 % | 0 % → 92 % | 5440 → 499 |
| onepiece | 48 | 77 % → 98 % | 4 % → 73 % | 0 % → 98 % | 4 % → 58 % | 4 % → 81 % | 4 % → 83 % | 4 % → 58 % | 5587 → 414 |
| riftbound | 31 | 87 % → 100 % | 0 % → 65 % | 0 % → 97 % | 0 % → 61 % | 0 % → 77 % | 0 % → 97 % | 0 % → 61 % | 7679 → 344 |

Par difficulté :

| Tag | Cartes | Langue | Numéro | Nom lu | Recherche 1re | 1re au tirage près | Dans les 5 | ms / carte |
|---|---|---|---|---|---|---|---|---|
| #envers (texte.ts seul) | 120 | 73 % → 94 % | 13 % → 68 % | 0 % → 95 % | 9 % → 73 % | 9 % → 81 % | 10 % → 88 % | 6815 → 473 |
| #flou | 90 | 48 % → 91 % | 3 % → 32 % | 0 % → 90 % | 1 % → 60 % | 1 % → 64 % | 2 % → 79 % | 5734 → 364 |
| #petite | 53 | 58 % → 85 % | 7 % → 63 % | 0 % → 92 % | 6 % → 66 % | 6 % → 70 % | 6 % → 83 % | 6936 → 424 |
| #reflet | 91 | 74 % → 90 % | 11 % → 65 % | 0 % → 91 % | 7 % → 71 % | 7 % → 78 % | 9 % → 87 % | 6490 → 449 |
| #holo | 75 | 71 % → 92 % | 9 % → 64 % | 0 % → 95 % | 5 % → 76 % | 5 % → 81 % | 7 % → 87 % | 7239 → 459 |
| #sombre | 69 | 74 % → 96 % | 14 % → 60 % | 0 % → 93 % | 9 % → 70 % | 9 % → 80 % | 10 % → 90 % | 6917 → 450 |
| #lumiere-chaude | 71 | 75 % → 94 % | 9 % → 66 % | 0 % → 93 % | 7 % → 73 % | 7 % → 79 % | 7 % → 89 % | 6567 → 419 |
| #pochette | 67 | 75 % → 96 % | 12 % → 64 % | 0 % → 94 % | 7 % → 73 % | 7 % → 78 % | 9 % → 91 % | 7499 → 464 |
| #perspective | 103 | 70 % → 96 % | 12 % → 69 % | 0 % → 92 % | 9 % → 71 % | 9 % → 80 % | 9 % → 87 % | 6648 → 458 |
| #tournee | 39 | 69 % → 95 % | 3 % → 72 % | 0 % → 90 % | 3 % → 69 % | 3 % → 79 % | 3 % → 87 % | 6287 → 462 |
| #encombre | 42 | 67 % → 90 % | 6 % → 66 % | 0 % → 88 % | 5 % → 71 % | 5 % → 76 % | 5 % → 83 % | 7365 → 443 |

Pour mémoire, la chaîne complète actuelle (`banc/resultats/base.md`, contour détecté, pas les vrais coins) a 56 % de langue juste.

### Vitesse

Ryzen 7 5700X, **machine chargée pendant toutes les mesures** (un jeu et d'autres tâches node à 80-100 % CPU) :
texte.ts **460 ms / carte en moyenne, médiane 456 ms, 90e centile 701 ms, max 976 ms** (OCR + analyse, chargement exclu) ;
actuel 6,7 s en moyenne (médiane 6,1 s). Premier appel : 2 à 4 s (3 modèles ONNX + tables de noms, une seule fois).
ONNX Runtime à 4 fils ; à 1 fil, ~1,1 s / carte (mesuré sur 16 cartes) : sous l'objectif de 1,5 s même sur un petit CPU 2 cœurs.

## Méthode retenue (`texte.ts` + `ocr.ts`)

1. **Détection** PP-OCRv5 mobile det (4,7 Mo) sur la carte réduite à 640×896, post-traitement DB simplifié
   (seuil 0,3, composantes connexes, boîtes droites agrandies ×1,6 : la carte est déjà redressée).
2. **Sens 0°/180°** : les 4 boîtes les plus larges sont lues dans les deux sens, la confiance moyenne la plus haute gagne
   (120 cartes à l'envers : aucune perte mesurable, 94 % de langue juste).
3. **Reconnaissance** PP-OCRv5 *latin* mobile rec (7,9 Mo, accents fr/de/es/it/pt) de chaque ligne, découpée dans
   l'image pleine résolution, hauteur 48, décodage CTC glouton.
4. **Japonais** : les ≤ 8 lignes les moins sûres sont relues par le modèle PP-OCRv5 multilingue (16,5 Mo) ; ≥ 4 kana ⇒ vote « ja ».
   Testé sur 3 scans japonais TCGdex : 29-37 kana, langue « ja » ; 0 faux positif sur les 240 cartes latines
   (une seule carte en a, la promo bilingue japonais/français 026, voir échecs).
5. **Numéro** : expressions par jeu sur chaque ligne ET sur chaque rangée recollée dans l'ordre de lecture
   (« SFD • 223/221 » et « SVP FR 164 » sortent en deux boîtes) : Pokémon `025/165`, promos `SWSH193`/`SM133`/`SVP 164`,
   YGO `LOB-FR001` (+ passcode 8 chiffres en bas), One Piece `OP10-062`, Riftbound `OGN-030/298`.
   Recherche exacte, puis clé « lâche » (O/0, I/1, S/5, B/8, Z/2, G/6 confondus), puis crédit partiel par distance
   d'édition pour les cartes dont le nom a été lu (« 192/197 » lu pour 192/191).
6. **Nom** : index trigrammes + Levenshtein normalisé sur les noms de toutes les langues (Pokémon : en + fr/de/es/it/pt
   TCGdex ; YGO : en + fr/de/it/pt YGOPRODeck ; One Piece, Riftbound : en). Requêtes = chaque ligne, chaque ligne + voisine
   de droite ou du dessous (noms coupés, « KAI'SA / Daughter of the Void »), PV collés et niveaux « LV.47 » retirés.
   Poids 1 dans la zone du nom du jeu (haut Pokémon/YGO, bas One Piece, milieu Riftbound), 0,7 ailleurs.
7. **Score** = nom (0-1) + numéro (1 exact, 0,8 lâche, ≤ 0,6 partiel) ; égalité ⇒ id le plus court (impression de base).
8. **Langue** = votes : code de langue YGO (3), code Pokémon « MEW FR » en capitales en bas (3), mots outils
   `langueTexte` (2), langue de la table où le nom a été trouvé (2, partagé si le nom est identique dans plusieurs
   langues), PV/HP/KP/PS (1), kana (3). Aucun indice ⇒ `null` (demander au vendeur).

Modèles : Apache-2.0 (PaddleOCR), téléchargés depuis Hugging Face (`webnn/PP-OCRv5-ONNX` pour det + rec multilingue,
`monkt/paddleocr-onnx` pour le rec latin) dans `modeles/` (29 Mo). Noms : API TCGdex et YGOPRODeck, réduits à
`donnees/noms.json` (3,7 Mo). Aucune dépendance npm ajoutée : `onnxruntime-node` 1.30.0 est déjà là (via transformers).

## Essais écartés (mesurés)

Sur les 66 cartes « flou » ou « petite » (une sur deux), analyse identique :

| Variante | Numéro | Recherche 1re | Dans les 5 | OCR ms |
|---|---|---|---|---|
| det PP-OCRv4 736×1024 (1er essai) | 46 % | 62 % | 86 % | 1867 |
| v4 + seuils bas (0,2 / 0,45) | 43 % | 61 % | 85 % | 1749 |
| v4 + renforcement de netteté | 46 % | 62 % | 86 % | 1946 |
| det PP-OCRv5 736×1024 | 50 % | 65 % | 88 % | 1394 |
| **det PP-OCRv5 640×896 (retenu)** | 50 % | 68 % | 88 % | 1277 |
| det PP-OCRv5 896×1248 | 52 % | 67 % | 89 % | 1687 |

(ms mesurés pendant que l'évaluation complète tournait en parallèle : comparables entre eux seulement.)
Lots de 8 lignes en reconnaissance : ~1,6× plus lent que ligne par ligne sur CPU (1255-1404 ms contre 736-934 ms), abandonné.

## Ce qui échoue encore

- **Numéro sur photo floue : 32 %.** Le petit texte du bas disparaît au flou ; le nom reste lu à 90 %. Sans numéro, un nom
  comme « Hypocéan » a des dizaines d'impressions à égalité : c'est l'empreinte image qui doit trancher (la recherche texte
  donne quand même la bonne carte dans les 5 à 79 %).
- **Variantes** (One Piece `_p1`/`_r1`, Riftbound signature / alternate / promo `opp-`) : même nom et même numéro imprimés,
  d'où One Piece 58 % en 1re mais 81 % au tirage près. Le texte ne peut pas faire mieux, l'image oui.
- **Langue (13 erreurs / 240)** : 9 « null » (carte trop floue/petite pour lire une phrase, 2 Énergies de base sans texte),
  1 promo bilingue japonais/français lue « ja », et **3 étiquettes du banc fausses** : 036, 054, 085 sont étiquetées « fr »
  mais l'image TCGdex « fr » est un scan anglais (texte « Evolves from Shelgon »…) ; texte.ts répond « en ».
  Une étiquette de nom l'est aussi : 010 attend « Gabite » (TCGdex n'a pas le nom français) alors que la carte dit « Carmache », bien lu.
- **Suffixes en logo** : « Lokhlass-ex », « Polthégeist V » sont lus sans le « -ex » / « V » (logo) ; le numéro corrige quand il est lu.
- **Banc synthétique** : scans propres dégradés, polices nettes ; les vraies photos (reflets réels, cartes gondolées, mise au
  point ratée) seront plus dures. Le numéro YGO (code de set sous l'illustration, passcode) n'est pas mesuré faute d'être imprimé
  sur les scans du banc ; le code est prévu (`LOB-FR001` donne aussi la langue, poids 3).
- Japonais : seule la *langue* est détectée ; pas de table de noms japonais (les sets japonais TCGdex ont d'autres identifiants),
  donc pas de recherche texte pour une carte japonaise : l'image reste seule.
- Constat annexe : `cache/tesseract` n'existe pas, donc tesseract.js ne peut pas écrire son cache et retélécharge les
  6 traineddata à chaque démarrage (l'écriture échoue en silence).

## Intégration (étapes exactes)

1. Déplacer `experiences/texte/ocr.ts`, `texte.ts`, `modeles/` et `donnees/noms.json` dans `phase0/` (par ex. `phase0/texte/`)
   et corriger l'import `../../commun.ts` de `texte.ts` (les chemins des modèles et des index sont relatifs au fichier :
   ajuster `../../index/` dans `chargerTables`). Ajouter `"onnxruntime-node": "^1.30.0"` aux dépendances de `package.json`
   (déjà installé, mais importé directement désormais).
2. Dans `reconnaissance.ts`, `identifierPhoto` : remplacer le bloc OCR (de `basCarte` jusqu'à la passe japonaise) par
   ```ts
   const lu = await lireCarte(carte, refs[tops[o][0].i].jeu); // carte = orientation choisie par l'image ; 0/180 géré
   const parTexte = new Map(lu.candidats.map((c) => [`${c.jeu}/${c.id}`, c.score]));
   ```
   et remplacer `numeroLu` par un bonus texte : `bonus = (parTexte.get(`${r.jeu}/${r.id}`) ?? 0) >= 1.5 ? BONUS_NUMERO : 0`
   (1,5 = nom + numéro concordants). Si `lu.candidats[0].score >= 1.8` (nom ET numéro lus) et que cette carte n'est pas
   dans les 20 candidats image, l'ajouter en tête : rattrape les cartes dont l'empreinte se trompe.
3. Langue : `const langue = lu.langue;` (code YGO, code Pokémon, mots, nom, kana). `null` ⇒ l'afficher « à confirmer » dans
   l'appli plutôt que deviner (prix différent). Supprimer la passe `lireTexte(..., "japonais")`.
4. `numeros: lu.numero ? [lu.numero] : []`, `texte: lu.nom ?? ""` dans le `Resultat`. Une fois l'intégration validée sur les
   vraies photos, `lireTexte`/`fermerLecture` et la dépendance `tesseract.js` peuvent partir.
5. Charger tôt : appeler `lireCarte` une fois au démarrage du serveur (2 à 4 s de chargement des modèles et des tables).
6. Relancer `node banc/evaluer.ts` pour mesurer la chaîne complète (contour détecté) et ajuster `BONUS_NUMERO`.

## Fichiers

- `texte.ts` : `lireCarte(carte, jeu?)` (contrat demandé) et `analyser(lignes, jeu?, kana?)` (analyse seule, rejouable).
- `ocr.ts` : PaddleOCR ONNX (détection, reconnaissance, sens 0/180, contrôle kana).
- `evaluer.ts` : comparaison actuel / texte.ts sur le banc (`--limite`, `--label`, `--refaire-base`) ; résultats dans `resultats/`.
- `redresser.ts` : redressement par les vrais coins, mis en cache dans `tmp/cartes/` (88 Mo, supprimable).
- `tmp/rejouer.ts` (rejoue l'analyse sur les lignes stockées, sans OCR), `tmp/sous.ts` (OCR sur un sous-ensemble),
  `tmp/chrono.ts` (chronométrage seul) : outils de réglage.
