# Contour de la carte : rapport

Banc : `banc/photos` (240 photos synthétiques 1500 × 2000) et `banc/verite.json`.
Mesure : `node experiences/contour/evaluer.ts`. La commande compare l'actuel `redresserCarte` (vision.ts) au nouveau `trouverCarte` (experiences/contour/contour.ts).
Erreur = distance moyenne entre les coins trouvés et les vrais, divisée par la diagonale de la carte. « Juste » = erreur < 3 %.

## Résultat (passe complète du 3 novembre, 240 photos)

| Groupe | Photos | Juste avant | Juste après | Erreur médiane avant | après | ms avant | ms après |
|---|---|---|---|---|---|---|---|
| tous | 240 | 50 % | 95 % | 2.9 % | 0.2 % | 248 | 101 |
| encombre | 42 | 31 % | 88 % | 5.8 % | 0.2 % | 250 | 123 |
| flou | 90 | 46 % | 93 % | 3.3 % | 0.2 % | 244 | 104 |
| fond-bois | 63 | 49 % | 97 % | 3.0 % | 0.2 % | 249 | 99 |
| fond-clair | 49 | 41 % | 92 % | 3.4 % | 0.2 % | 244 | 95 |
| fond-gris | 64 | 59 % | 95 % | 2.3 % | 0.2 % | 251 | 107 |
| fond-tapis | 64 | 50 % | 95 % | 2.9 % | 0.2 % | 247 | 100 |
| holo | 75 | 60 % | 93 % | 2.5 % | 0.2 % | 248 | 101 |
| lumiere-chaude | 71 | 55 % | 94 % | 2.7 % | 0.2 % | 248 | 99 |
| perspective | 103 | 40 % | 92 % | 3.6 % | 0.2 % | 250 | 100 |
| petite | 53 | 4 % | 94 % | - | 0.3 % | 245 | 65 |
| pochette | 67 | 55 % | 91 % | 2.7 % | 2.1 % | 251 | 103 |
| reflet | 91 | 52 % | 92 % | 2.9 % | 0.2 % | 246 | 102 |
| sombre | 69 | 39 % | 93 % | 7.0 % | 0.2 % | 251 | 98 |
| tournee | 39 | 38 % | 92 % | 3.6 % | 0.2 % | 251 | 102 |

Pour « petite », la médiane d'avant vaut « - » : plus de la moitié de ces photos n'avaient aucun contour, car le seuil de 15 % de l'image écartait les petites cartes.

### Temps

La colonne « ms avant » couvre tout `redresserCarte`, y compris les 4 redressements et les encodages JPEG. Elle n'est donc pas comparable terme à terme avec « ms après ». Pendant toutes les mesures, le processeur (Ryzen 7 5700X) était chargé à 100 % par d'autres tâches.

Mesures au calme relatif, en gardant le meilleur de 3 passes :
- Photos du banc (1500 × 2000), 40 photos : 80 ms en médiane, 122 ms au 90e centile, 170 ms au maximum.
- Photo de 3000 × 4000 px : 80 ms pour `trouverCarte`, contre 324 ms pour `redresserCarte`.

Le décodage se fait directement à 640 px grâce à la réduction au chargement du JPEG par sharp. La taille de la photo compte donc peu.

L'objectif de 400 ms reste tenu avec une bonne marge sur un processeur deux à trois fois plus lent.

### Ratés restants (12)

- **Pochette, bord de la pochette retenu** : 084, 160, 182, 200, avec une erreur de 3.1 à 3.2 %. C'est le cas général des cartes en pochette : on trouve le bord de la pochette, ce qui donne 1.3 à 2.9 % d'erreur et passe le plus souvent sous les 3 %. La médiane du groupe « pochette » est de 2.1 %.
- **Carte qui sort de l'image d'un côté entier** : 076, 104, 215. Un côté entièrement invisible ne peut pas être retrouvé.
- **Autre carte collée ou chevauchante** : 024, 150.
- **Bord blanc sur table claire, contraste quasi nul** : 165, 184.
- **Petite carte holo** : 011.

## Méthode retenue (contour.ts)

1. La photo est décodée à 640 px, avec la rotation EXIF appliquée.
2. Les bords sont détectés par un Canny (20, 60) sur les 3 couleurs, qui garde le canal le plus fort : le jaune Pokémon sur du bois brun ressort.
3. Des droites sont tirées de ces bords (Hough), et les segments alignés sont fusionnés. On garde les 60 droites les plus longues. Un segment compte pleinement quand il a la table d'un seul côté. Sans cette règle, les veines du bois ou les rayures d'un tapis évincent les côtés de la carte.
4. Tout quadrilatère formé de deux paires de droites à peu près parallèles est noté sur plusieurs critères :
   - la force du bord le long de chaque côté (sommes cumulées, donc en temps constant) ;
   - le ratio 63:88, avec une tolérance pour la perspective ;
   - la taille, pour que la carte l'emporte sur son propre cadre d'illustration ;
   - la position par rapport au centre ;
   - la couleur juste à l'extérieur de chaque côté, qui doit être celle de la table (médiane d'un anneau au bord de la photo) ;
   - la couleur juste à l'intérieur, qui doit être la même bordure sur les 4 côtés.

   Le meilleur quadrilatère est trouvé avec élagage, car chaque facteur est ≤ 1.
5. **Élargissement** : chaque côté est poussé vers l'extérieur, jusqu'à 10 % de la largeur, sur un bord parallèle plus faible lorsque ces conditions sont réunies :
   - au-delà de ce bord, la couleur est nettement plus celle de la table ;
   - elle reste uniforme tout le long du côté, ce qui exclut une autre carte posée à côté.

   C'est ce qui rattrape une carte blanche sur table blanche ou une carte noire sur tapis sombre. Le profil est moyenné sur tout le côté, si bien qu'un bord faible ressort du bruit.
6. **Affinage** : la position sub-pixel de chaque côté est mesurée sur ses deux moitiés, puis les coins sont placés à l'intersection des côtés. Cela gère les coins arrondis, les coins hors de l'image et une carte en partie cachée.

## Ce qui a été essayé

Les chiffres donnent le taux de contours justes sur les 240 photos, à chaque étape.

| Essai | Juste | Verdict |
|---|---|---|
| Contours (findContours) + approxPolyN + quadrilatère noté (appui, ratio, aire, centre) | 78 %, médiane 0.7 % | Abandonné : la carte coupée par le bord de l'image ou fusionnée avec la carte voisine ne forme pas de contour fermé. |
| Quadrilatères de droites de Hough, appui sur les bords Canny | 80 % | Le cadre intérieur ou une droite intérieure gagnait souvent. |
| + refit par moindres carrés sur les maxima pixel par pixel | 80 % (83 % sans) | Abandonné, remplacé par l'affinage moyenné par demi-côté, qui fait passer la médiane de 0.34 à 0.21 %. |
| + couleurs des bandes (table dehors, même bordure dedans) | 88 % | Gardé. |
| + élargissement vers l'extérieur | 91 % | Gardé. |
| Couleur extérieure comparée à la couleur de la table plutôt qu'aux autres côtés | 93 % | Gardé. |
| 60 droites au lieu de 40 / 80 droites | 93.8 % / identique | 60 gardé. |
| Garde « table uniforme au-delà » dans l'élargissement | 94.6 % | Gardé ; corrige les élargissements sur la carte voisine. |
| Canny 20/60 (contre 30/90, 15/45, 40/120) | 95.4 % (contre 94.6, 95.0, 92.9) | 20/60 gardé. |
| Taille de travail 512 / 800 / 640 px | 92.1 % / 92.9 % / 94.6 % (même réglage) | 640 gardé. |
| Tolérance de ratio 0.18 / 0.35 / 0.25 | 94.6 % / 95.0 % / 95.4 % | 0.25 gardé. |
| Reprise des 4 ou 8 meilleurs candidats, élargis puis notés à nouveau | 92.5 à 94.6 %, plus lent | Abandonné. |
| Exigence « même bordure dedans » assouplie (sigma 80) ou supprimée | 92.1 à 93.3 % | Abandonné. |
| **Passage de la pochette au bord de la carte** (bande intérieure = table éclaircie) | pochette 91 → 94 %, médiane pochette 2.1 → 0.28 %, mais **total 95.4 → 90.4 %** | Abandonné : les bordures blanches ou argentées (One Piece, Pokémon série EV) sur fond plus sombre sont prises pour une pochette. Ce sont des cartes très courantes. |
| Tri des droites par longueur qui sépare table et carte | banc 95.4 → 95.0 % (une photo) ; photos-exemple sur carton rayé : 3 cartes de plus justes à l'œil (04, 15, 17) | Gardé : des veines ou des rayures marquées sur la table sont un cas réel. |

Pistes non essayées :
- **GrabCut** : non essayé.
- **Modèle ONNX** (coins de document, segmentation) : non essayé. Le CV classique atteint 95 % en environ 100 ms, et les ratés restants (pochette, côté hors de l'image) ne seraient pas réglés par un détecteur de document générique.

### Limites à connaître

- **Réglages et banc** : les réglages ont été choisis sur ce même banc, il y a donc un risque d'optimisme. Les deux moitiés du banc donnent 93.3 % pour les photos paires et 97.5 % pour les impaires, ce qui donne l'ordre de grandeur du bruit.
- **Photos synthétiques** :
  - les coins des cartes sont carrés (scans) ;
  - les pochettes sont un liseré translucide ;
  - il n'y a pas d'ombre portée.
- **Contrôle sur `photos-exemple/`** (autre générateur, fond carton rayé, sans vérité terrain) : 17 photos sur 20 ont un contour juste à l'œil.
  - 01 et 03 sont ratées : la carte touche le haut de l'image, et le quadrilatère descend jusqu'à une rayure.
  - 16 n'a aucun contour : carte One Piece à bord blanc sur fond clair.
- **Toploader** : avec une marge d'environ 10 %, le bord du toploader peut être retenu. Ce cas n'est pas dans le banc.

## Intégration recommandée (vision.ts)

1. Mettre `trouverCarte` et ses fonctions dans vision.ts, ou l'importer. Le code n'utilise que `opencv()` et sharp, sans nouvelle dépendance.
2. Dans `redresserCarte`, remplacer tout le bloc de détection : du `const k = 800 / …` jusqu'au calcul de `coins`, c'est-à-dire Canny, contours, seuil de 15 %, approxPolyDP / minAreaRect. Le remplacer par `const { coins } = await trouverCarte(photo)`.
   - `coins` est déjà donné en pixels de la photo après rotation EXIF, dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche, sens horaire.
   - Pour le redressement, le ramener à l'échelle de l'image décodée à 2400 px : multiplier par `info.width / largeurPhoto`.
3. Garder le redressement (`warpPerspective`), le quart de tour quand la carte est couchée, et le repli sur la photo entière quand `coins` est null.
   - Le `ordonner` actuel (sommes / différences extrêmes) peut renvoyer deux fois le même point pour une carte tournée à 45° : utiliser l'ordre fourni par `trouverCarte`.
4. Au passage, `largeurPhoto` est calculée par un décodage et un réencodage complets de la photo (`sharp(await tournee.clone().toBuffer()).metadata()`). `sharp(photo).metadata()` avec l'orientation EXIF suffit, comme dans contour.ts.
5. Avec une pochette, la carte redressée garde un liseré de 2 à 3 %. C'est sans gravité pour l'empreinte DINOv2, mais à vérifier sur la lecture du numéro (OCR) en bas de carte.

## Fichiers

- `experiences/contour/contour.ts` : `trouverCarte(photo)` → `{ coins, ms }`.
- `experiences/contour/evaluer.ts` : comparaison avant/après sur le banc. `--rapide` réutilise la colonne « avant » déjà mesurée, `--limite N` limite le nombre de photos.
- `experiences/contour/resultats.json` : détail photo par photo de la dernière passe.
