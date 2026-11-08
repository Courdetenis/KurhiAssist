# Phase 0 – Test de reconnaissance locale (option B)

Objectif : mesurer sur de vraies photos de la boutique la précision d'une reconnaissance **100 % locale et gratuite**, du type des applications de scan de cartes. Aucun service payant, aucune clé API, et les photos restent sur l'ordinateur.

Ce banc d'essai est jetable. Seuls les enseignements (méthode, réglages, chiffres) passeront dans l'application.

## Comment ça marche

1. **Contour** : l'outil trouve les 4 bords de la carte (droites de la photo, proportions d'une carte, couleur de la table) et la redresse (OpenCV).
2. **Empreinte d'image** : il calcule une empreinte de l'illustration et la compare à celles d'environ 43 000 cartes de référence (modèle DINOv2, sur le processeur, sans carte graphique).
3. **Lecture du texte** : il lit le **nom**, le **numéro** et la **langue** (PaddleOCR, local) et retrouve la carte par son nom dans 6 langues.
4. **Fusion** : la carte retenue est celle qui ressemble le plus ET dont le nom et le numéro lus correspondent.
5. **Prix** : il affiche les fiches Cardmarket correspondantes (prix indicatifs du jour).

L'utilisateur confirme toujours le résultat. La variante (reverse, 1re édition) et l'état restent à préciser à la main.

## 1. Construire l'index de référence (une fois)

```bash
npm run indexer
```

Durée : environ une heure la première fois. L'outil télécharge les images de référence (Pokémon, Yu-Gi-Oh!, One Piece, Riftbound, Lorcana) dans `references/` (environ 1 Go), puis calcule leurs empreintes dans `index/`. Relancer la commande plus tard ajoute seulement les nouvelles cartes.

## Application de scan sur téléphone

Sur le PC de la boutique (une fois l'index construit) :

```bash
npm run serveur
```

Le terminal affiche une adresse du type `http://192.168.1.12:3000`. Sur le téléphone, connecté au **même Wi-Fi**, ouvrir cette adresse. « Prendre une photo » ouvre l'appareil photo, « Importer » prend une photo existante. L'écran montre :

- la photo redressée à côté de la carte de référence trouvée, avec le taux de ressemblance ;
- le nom, le jeu, le set, le numéro et la langue lue sur la carte ;
- le prix Cardmarket du jour, et la liste des fiches Cardmarket de la carte ;
- les autres cartes possibles : un toucher pour choisir la bonne et voir ses prix ;
- « Ajuster le cadrage » : si le bord de la carte est mal trouvé, placer les 4 coins au doigt et relancer ;
- « Carte non reconnue » quand aucune référence ne correspond assez (jeu non pris en charge, photo inutilisable), au lieu d'une carte fausse.

Au premier lancement, Windows peut demander d'autoriser Node.js sur le réseau : accepter pour les **réseaux privés**. Pour l'ajouter à l'écran d'accueil du téléphone : menu du navigateur, « Ajouter à l'écran d'accueil ».

## Banc d'essai difficile

`banc/` contient 240 photos simulées de comptoir (perspective, reflets, holo, pochettes, flou, lumière faible ou chaude, carte petite, table claire, autre carte dans le cadre), avec la bonne carte, la langue et les coins connus. Pour remesurer après un changement :

```bash
node banc/evaluer.ts --label essai
```

| Version (3 novembre 2026) | Bonne carte 1re | Dans les 5 | Langue | Contour juste | Temps |
|---|---|---|---|---|---|
| Première version | 68 % | 72 % | 56 % | 50 % | 12 s* |
| Version actuelle | **95 %** | **99 %** | **93 %** | **95 %** | **1,2 s** |

\* processeur partagé avec d'autres calculs pendant la mesure.

Échecs restants : surtout des réimpressions à l'illustration identique (promos Riftbound, Professor Juniper), départagées seulement par le numéro lu ou par l'utilisateur, et 3 contours ratés. Détail : `banc/resultats/complet.md`. Rapports des essais : `experiences/*/RAPPORT.md`.

## Essai rapide

```bash
npm run identifier -- --dossier photos-exemple
```

`photos-exemple/` contient 20 photos simulées (cartes officielles tournées sur un fond, éclairage et netteté dégradés). Résultat obtenu le 2 novembre 2026 : bonne carte en 1re position 20 sur 20, langue juste 19 sur 20 (une inconnue), 3,2 s par photo en médiane. Ces photos sont plus faciles que de vraies photos : seules vos photos donneront les vrais chiffres. Supprimer ensuite `resultats/` et `verite.csv`.

## 2. Photos de test

Mettre 100 à 200 photos dans `photos/`, **une carte par photo**, prises au comptoir dans les conditions réelles :

- les 4 jeux, en proportion de vos rachats ;
- plusieurs langues : FR, EN, JP au minimum ;
- cartes nues, en pochette et en toploader ;
- des cas difficiles : reverse, 1re édition, alt art, parallèles, réimpressions, cartes abîmées ;
- la carte doit occuper au moins un quart de la photo, sur un fond uni de préférence.

Formats acceptés : JPEG, PNG, WebP. Les photos iPhone en HEIC sont ignorées. Pour obtenir du JPEG sur iPhone : Réglages > Appareil photo > Formats > « Le plus compatible ».

## 3. Lancer la reconnaissance

```bash
npm run identifier
```

Résultats : `resultats/local.json` et le rapport `resultats/local.html`. Le rapport montre pour chaque photo la carte détectée, le texte lu, les 4 meilleurs candidats avec leur image et les prix Cardmarket. Une photo déjà traitée n'est pas refaite. Pour tout refaire, supprimer `resultats/`.

## 4. Vérifier (étape la plus importante)

1. Ouvrir le rapport HTML à côté de `verite.csv` (Excel).
2. Pour chaque ligne de `verite.csv`, corriger `jeu` et `langue` si besoin.
3. `id_correct` : laisser si le candidat en gras du rapport est la bonne carte. Sinon, coller l'identifiant du bon candidat (affiché dans le rapport). Vider la cellule si la bonne carte n'apparaît nulle part.
4. Mettre `o` dans la colonne `verifie`. Seules ces lignes comptent dans le score.
5. Enregistrer au format « CSV UTF-8 (délimité par des points-virgules) ».

## 5. Score

```bash
npm run score
```

Le tableau `resultats/score.md` donne, par jeu : le taux de contours trouvés, de bon jeu, de bonne langue, de bonne carte en 1re position, dans les 3 et les 10 premières, et le temps moyen par photo.

## Critères de décision proposés

| Mesure | Seuil pour passer en phase 1 avec cette approche |
|---|---|
| Langue | ≥ 95 % |
| Bonne carte dans les 3 premiers candidats | ≥ 90 % |
| Temps par photo | ≤ 5 s |

En dessous, on améliore d'abord le point faible mesuré : cadrage guidé à la prise de vue, empreinte de l'illustration seule, meilleure lecture du numéro.

## Limites connues

- **Pokémon japonais** : l'index contient les images anglaises. Une carte japonaise avec la même illustration est trouvée, mais les sets exclusivement japonais ne le sont pas.
- **One Piece** : les cartes promo ne sont pas encore dans l'index.
- **Variantes** : reverse, 1re édition et tampons ont la même illustration que la carte normale. Ils restent à préciser à la main.
- **Yu-Gi-Oh!** : Cardmarket a une fiche par édition. Le numéro lu aide, mais le choix de l'édition reste à confirmer.
- **Prix** : indicatifs (Cardmarket « trend », toutes langues et tous états confondus).
- **Lorcana** : l'index contient les impressions anglaises (Lorcast) ; la carte est retrouvée par l'illustration et par la ligne « 48/204 · FR · 5 ». Cardmarket ne distingue pas les versions (normale, Enchanted, promo) dans ses fichiers publics : l'appli affiche la fourchette.
- **Scellés** : pas encore reconnus (prévu en phase 4, par code-barres).

## Fichiers

| Fichier | Rôle |
|---|---|
| `indexer.ts` | Listes de cartes, téléchargement des images de référence, empreintes |
| `contour.ts` | Détection des bords de la carte |
| `vision.ts` | Redressement de la carte, empreinte d'image |
| `ocr.ts`, `texte.ts`, `modeles/`, `donnees/` | Lecture du texte (PaddleOCR) et recherche par nom et numéro |
| `reconnaissance.ts` | Reconnaissance d'une photo (partagée par le traitement par lot et l'application) |
| `serveur.ts`, `app.html` | Application de scan pour téléphone |
| `identifier.ts` | Traitement d'un dossier de photos, rapport HTML, `verite.csv` |
| `prix.ts` | Fichiers publics Cardmarket et fiches correspondant à une carte |
| `score.ts` | Comparaison des résultats avec `verite.csv` |
| `commun.ts` | Fonctions partagées (langue, CSV) |
| `banc/` | Banc d'essai : génération de 240 photos difficiles, mesure (`node banc/evaluer.ts`) |
| `scans/` | Chaque scan fait avec l'application (photo + résultat), pour analyser les échecs |
| `experiences/` | Travaux des essais (contour, texte, correspondance) et leurs rapports |
| `test.ts` | Vérification des fonctions partagées (`npm test`) |
| `references/`, `index/`, `cache/` | Données téléchargées ou calculées, régénérables |
