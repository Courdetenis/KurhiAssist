# Correspondance d'image : rapport

But : retrouver la bonne carte parmi les **40 150 références** (Pokémon 19 664, Yu-Gi-Oh! 14 823, One Piece 4 212,
Riftbound 1 451) à partir d'une carte déjà redressée, sur CPU, en local.

## Méthode de mesure

- Banc : les 240 photos de `banc/photos` (101 Pokémon dont 86 en français contre un index de scans anglais, 60 Yu-Gi-Oh!,
  48 One Piece, 31 Riftbound).
- Pour isoler la correspondance du contour, chaque photo est redressée en 1260 × 1760 avec ses **vrais coins**
  (`vrai`), puis avec chaque coin déplacé de **2,5 %** (`bruite`) et de **5 %** (`bruite5`) de la diagonale dans une
  direction aléatoire (contour imparfait). Images mises en cache dans `cache/`.
- Toujours les deux sens (0° et 180°) : le score d'une référence est le meilleur des deux.
- Colonnes : top-1 / top-5 / top-20 = bonne carte exacte (même id) à ces rangs. « Même image » = la 1re proposée est
  la bonne ou une autre référence dont l'empreinte de base est quasi identique (cos > 0,97 : réimpressions, foils,
  doublons). « Même nom » = la 1re a le bon nom.
- Tous les chiffres ci-dessous sont mesurés sur l'index **complet** de 40 150 références (sauf la section criblage).

## Résultats (index complet, 240 photos)

| Variante | Vrais coins t1 / t5 / t20 | Coins ±2,5 % | Coins ±5 % | t1 « même image » (vrai / 2,5 / 5) |
|---|---|---|---|---|
| **Base** (projet : DINOv2-small CLS, carte écrasée 224² + recadrage centre du processeur) | 97 / 100 / 100 | 88 / 97 / 98 | 81 / 91 / 95 | 98 / 90 / 83 |
| Base + rerang ORB (top-20) | 98 / 100 / 100 | 93 / 98 / 98 | 91 / 95 / 95 | 99 / 95 / 93 |
| DINOv2-small, carte entière 224×308 (proportions gardées), CLS | 94 / 99 / 99 | 89 / 96 / 98 | 88 / 95 / 99 | 97 / 91 / 90 |
| idem, moyenne des jetons de la **zone d'illustration** | 97 / 100 / 100 | 95 / 100 / 100 | 96 / 100 / 100 | 99 / 98 / 98 |
| idem, CLS + illustration | 97 / 100 / 100 | 95 / 100 / 100 | 95 / 99 / 100 | 99 / 98 / 98 |
| **Retenu : illustration + rerang ORB (top-20)** | **98 / 100 / 100** | **96 / 100 / 100** | **97 / 100 / 100** | **100 / 99 / 99** |

### Par jeu, top-1 (top-5)

| Jeu | Base vrai | Retenu vrai | Base ±2,5 % | Retenu ±2,5 % | Base ±5 % | Retenu ±5 % |
|---|---|---|---|---|---|---|
| Pokémon (101) | 97 (100) | 99 (100) | 84 (96) | 99 (100) | 74 (86) | 99 (100) |
| Yu-Gi-Oh! (60) | 100 (100) | 100 (100) | 93 (97) | 98 (100) | 87 (95) | 100 (100) |
| One Piece (48) | 96 (98) | 96 (100) | 92 (96) | 94 (100) | 85 (92) | 94 (100) |
| Riftbound (31) | 90 (100) | 90 (100) | 84 (100) | 87 (100) | 84 (97) | 87 (100) |

### Par difficulté, coins ±2,5 %, top-1 (top-5) — les pires de la base

| Tag | n | Base | Retenu |
|---|---|---|---|
| encombre | 42 | 81 (98) | 100 (100) |
| flou | 90 | 84 (96) | 97 (100) |
| petite | 53 | 85 (89) | 98 (100) |
| reflet | 91 | 85 (95) | 98 (100) |
| fond-bois | 63 | 86 (94) | 97 (100) |
| fond-gris | 64 | 86 (98) | 92 (100) |
| perspective | 103 | 88 (94) | 94 (100) |
| sombre | 69 | 88 (97) | 96 (100) |
| lumiere-chaude | 71 | 90 (100) | 94 (100) |

À ±5 % : petite 72 → 96, flou 72 → 98, sombre 74 → 96, fond-bois 75 → 97, tournee 77 → 97, pochette 78 → 100.
Tableaux complets (tous tags, 3 conditions) : `resultats/final-base.md` et `resultats/final-dv2s.md`.

### Échecs restants du retenu (±2,5 %, 9 sur 240)

8 sur 9 sont une **autre impression du même nom** à illustration identique ou quasi identique : Oran Berry ex9 ↔ ex1,
Raizo / Koby / Luffy P-055 « Reprint » ↔ « Jolly Roger Foil », Riftbound « Overnumbered » ↔ « Signature », doublons
Riftbound à image identique (Challenge, Lux, Gem Jammer). L'image seule ne peut pas trancher : c'est le travail de
l'OCR du numéro (bonus `BONUS_NUMERO` déjà présent dans `reconnaissance.ts`). 1 vraie confusion : Fog Warning →
Cloudy Skies of Grey (Yu-Gi-Oh!, rang 2). Dans tous les cas la bonne carte est dans les 5 premières.

## Vitesse et coût

- **Requête complète** `identifierImage` (2 passes DINOv2 0°/180° en un lot, balayage des 40 150, ORB sur la requête +
  20 références lues sur disque, aucun cache) : **médiane 469-496 ms, p90 505-578 ms** (41 requêtes, une sur deux à
  l'envers ; Ryzen 7 5700X partagé avec d'autres tâches). Base dans les mêmes conditions (2 sens, sans ORB) : 162 ms en
  moyenne. Le surcoût vient surtout de l'ORB (21 extractions en WebAssembly). Large marge sous 1,5 s.
- **Construction de l'index** (empreintes seulement, images déjà locales) : 5 205 cartes en 1 259 s + 34 945 en 4 210 s,
  soit **~91 min pour 40 150 cartes** sur la machine très chargée (jeu + 3-5 autres jobs node) ; débit mesuré ensuite
  sur machine plus calme : 76 ms/carte, soit ~51 min projetées.
- **Taille** : le fichier d'essai garde 3 blocs (CLS | moyenne | illustration) = 185 Mo ; le réglage retenu n'utilise
  que le bloc illustration : 384 float32 par carte = **61,7 Mo, comme l'index actuel**. L'ORB n'a pas d'index : il est
  calculé à la volée sur les JPEG 300 px de `references/`.
- Modèle : le même `onnx-community/dinov2-small` fp32 (88 Mo), aucune nouvelle dépendance.

## Ce qui marche et pourquoi

1. **Moyenne des jetons de l'illustration** (même passe que la carte entière, zéro coût de plus) : la zone
   d'illustration par jeu (`ART` dans `correspondance.ts`) ne contient ni le texte (qui change entre FR et EN) ni les
   bords (qui bougent quand le contour est imparfait). Le CLS, lui, encode toute la carte, fond compris : il perd
   9 points à ±2,5 % et 16 à ±5 %. Avec l'illustration, le top-5 reste à 100 % même à ±5 %.
2. **Rerang géométrique guidé** : ORB (500 points, 300 px) sur la requête et sur les 20 premières références ; comme les
   deux cartes sont redressées, un appariement ne compte que si ses deux points sont au même endroit (±7 % de la carte),
   ou à l'endroit miroir pour une carte à l'envers, distance de Hamming ≤ 48 et nette avance sur le 2e voisin.
   Score final = similarité + 0,2 × min(accords, 200) / 200. Gagne 1 à 5 points de top-1 selon la condition.

## Ce qui n'a pas marché

- Moyenne de **tous** les jetons de la carte : s'effondre avec un contour imparfait (84 % contre 94 % au criblage,
  ±2,5 %) car le fond entre dans l'image.
- CLS proportions gardées sans recadrage : un peu moins bon que la base (94 contre 97 en vrais coins) ; le recadrage
  centre du processeur de la base enlève justement le bord.
- ORB **limité à l'illustration** : moins bon que sur la carte entière (base ±5 %, K 30 : 210 contre 219 bonnes sur 240) ; les
  500 coins les plus forts sont surtout dans le texte et le cadre, certaines illustrations lisses en ont moins de 5.
- Seuil de Hamming 64 : moins bon que 48. Classement par ORB seul (sans similarité) : pas meilleur que la fusion (230 / 225 / 214 contre 234 / 224 / 219 sur la base).
- `BFMatcher.knnMatch` d'OpenCV.js : ~30 ms par paire en WebAssembly, trop lent pour 20-30 candidats ; remplacé par
  l'appariement guidé en JS (~2,5 ms par paire).
- Non essayés faute de CPU (la machine était partagée avec un jeu et 3-5 autres jobs) : DINOv2-base, CLIP/SigLIP,
  gris-monde, augmentations, références haute résolution.

## Criblage sur sous-ensemble (5 205 réf. : cartes du banc + toutes les cartes de même nom + 10 % au hasard)

**DINOv3-S/16** (`onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX`, 224×304, 266 jetons) : son CLS est aussi
robuste au contour imparfait que la moyenne illustration de DINOv2 (98 % top-1 dans les 3 conditions, le
sous-ensemble est saturé) et ses marges sont plus larges (écart bonne carte / meilleure fausse, en écarts-types,
5e centile à ±5 % : CLS DINOv3 1,02, CLS+illustration DINOv3 0,94, illustration DINOv2 0,60, base −0,27). Pas indexé
sur les 40 150 faute de temps CPU. C'est la piste suivante la plus prometteuse : `node
experiences/correspondance/indexer.ts --passe dv3s_ent` puis `evaluer.ts --configs "dv3s_ent:1,0,1"`.

## Réserves

- Les réglages de fusion ORB (K 20, ±7 %, Hamming 48, β 0,2, plafond 200) ont été choisis sur ce même banc (grille de
  4 × 6 × 5 × 3) : le gain ORB est un peu optimiste. Ce sont aussi les meilleurs pour la base, et les voisins sont à
  ±1-2 photos. Le résultat sans réglage (illustration seule : 97 / 95 / 96) est la mesure non biaisée.
- Le banc sous-estime l'écart scan / carte imprimée : pour One Piece, Yu-Gi-Oh! et Riftbound la requête est la même
  image numérique que la référence (en plus grand) ; les références One Piece et donc les requêtes portent le
  filigrane « SAMPLE » que les vraies cartes n'ont pas. Seul Pokémon FR contre index EN teste un vrai écart de contenu.
- Les durées sont mesurées sur une machine partagée (5700X, 8 cœurs) ; un PC modeste à 4 cœurs devrait rester sous
  1 s par requête, non mesuré.

## Fichiers

- `correspondance.ts` : `identifierImage(carte, k)` (accepte une carte droite ou à l'envers), passe d'empreintes,
  index, ORB guidé.
- `indexer.ts` : construction de l'index (`--passe dv2s_ent`, reprise possible, `--sous-ensemble` pour le criblage).
- `evaluer.ts` : banc (base contre variantes, 3 conditions, `--orb N` pour le rerang, `--fusion` pour fixer le réglage,
  `--chrono N` pour le temps de bout en bout).
- `index/dv2s_ent/` (index complet), `index-sous/` (criblage), `resultats/` (JSON par requête + tableaux), `cache/`
  (cartes redressées et points ORB du banc, 549 Mo, effaçable), `.cache/` (modèles).

Reproduire :

```
node experiences/correspondance/indexer.ts --passe dv2s_ent
node experiences/correspondance/evaluer.ts --configs base --conditions vrai,bruite,bruite5 --orb 30 --label base-complet-orb
node experiences/correspondance/evaluer.ts --configs "dv2s_ent:1,0,0;dv2s_ent:0,0,1;dv2s_ent:1,0,1" --conditions vrai,bruite,bruite5 --orb 30 --label complet-dv2s
node experiences/correspondance/evaluer.ts --depuis complet-dv2s --fusion '{"r":0,"beta":0.2,"cap":200,"k":20}' --label final-dv2s
node experiences/correspondance/evaluer.ts --chrono 41 --conditions bruite
```

## Intégration dans le projet

1. **`vision.ts`** : remplacer le corps de `empreintes()` par `pixels()` + `encoder()` de `correspondance.ts` (copier
   `ART`, `pixels`, `normer`, `encoder`, ~50 lignes) : redimensionnement 224×308 `fit: "fill"`, normalisation ImageNet,
   **sans** `AutoProcessor` (il recadre le centre), appel direct `model({ pixel_values })`. La fonction rend, par image,
   un vecteur de 384 par jeu : `Record<Jeu, Float32Array>` (moyenne normalisée des jetons dans `ART[jeu]`).
   Copier aussi `pointsOrb`, `bits` et `accords` (~60 lignes, OpenCV.js déjà chargé par `opencv()`).
2. **`indexer.ts`** : stocker pour chaque référence le vecteur de son propre jeu :
   `lot.forEach((r, j) => vecteurs.set(r.id, v[j][jeu]))`. Même format, même `DIM` (384), même taille. Supprimer
   `index/*.bin` et `index/*.json` puis relancer `npm run indexer` (images déjà là : empreintes seules, ~50-90 min).
   Ou copier directement le bloc illustration de `experiences/correspondance/index/dv2s_ent/<jeu>.bin` (3e tiers de
   chaque ligne de 1 152 floats ; les `.json` sont dans le même ordre que `index/<jeu>.json`).
3. **`reconnaissance.ts`**, `plusProches` : le vecteur requête dépend du jeu de la référence ; les références sont
   concaténées par jeu dans l'ordre de `JEUX`, donc boucler par bloc de jeu avec `q = v[jeu]`. Le demi-tour peut être
   fait sans relire l'image en inversant les plans du tenseur (`pixels(..., rot180)`), les deux sens en un seul lot.
4. **`reconnaissance.ts`**, après le choix de l'orientation : rerang des 20 premiers :
   `const q = await pointsOrb(carte)` puis pour chaque candidat
   `sim += 0.2 * Math.min(accords(q, await pointsOrb(fichierRef(ref)), 0.07, 48), 200) / 200`, re-trier, puis le
   bonus du numéro OCR comme aujourd'hui (il reste nécessaire pour départager les réimpressions à illustration
   identique, qui sont l'essentiel des erreurs restantes ; avec le bonus ORB jusqu'à 0,2, garder `BONUS_NUMERO` ≥ 0,1).
5. Les orientations « photo entière » (`entiere`, quand aucun contour n'est trouvé) n'ont pas de zone d'illustration
   fiable : la moyenne illustration y vaut peu, ce cas dépend du détecteur de contour.
