Rapport comparatif · 8 novembre 2026

# KurhiRachat contre KurhiAssist

Deux projets pour le rachat de cartes TCG au comptoir. Ce rapport décrit chacun, compare ce qu'ils font tous les deux, et mesure leur reconnaissance photo sur les mêmes 246 photos.

## La réponse courte

- KurhiRachat est une appli Android complète. Elle reconnaît les cartes par une IA de vision (Gemini ou Claude), puis les cherche dans les bases de cartes publiques.
- KurhiAssist est un prototype de « phase 0 ». Il reconnaît les cartes sur un PC, sans IA payante : il compare l'illustration à 43 600 images de référence et lit le texte de la carte.
- **Sur les 6 vraies photos de comptoir** (4 cartes différentes), les deux moteurs trouvent la bonne carte 6 fois sur 6. KurhiRachat va plus loin sur ces photos : il lit le code, le passcode, la rareté et la 1re édition, donc il donne l'impression exacte (`SUDA-FR088`, Super Rare, 1re édition) là où KurhiAssist donne la carte et une fourchette de prix.
- **Sur le banc de 240 photos dégradées**, KurhiAssist met la bonne carte en tête 98 % du temps. KurhiRachat propose la bonne carte 99 % du temps, mais il la donne directement dans seulement 55 % des cas. Le reste du temps, il faut toucher le bon choix dans une liste : rareté pour Yu-Gi-Oh!, version pour One Piece et Riftbound, et jusqu'à une vingtaine de choix pour Pokémon quand le numéro est illisible.
- **Langue** : KurhiRachat lit la bonne langue 98 % du temps, KurhiAssist 92 %.
- **Mon avis** : KurhiRachat est le meilleur produit aujourd'hui. KurhiAssist a la meilleure idée pour départager les cartes de même nom quand le numéro est illisible. Le meilleur moteur garde la lecture par IA de KurhiRachat et y ajoute l'empreinte d'image de KurhiAssist comme arbitre. Aucun des deux n'a encore été mesuré sur 100 à 200 vraies photos de la boutique.

1 · Les deux projets

## Deux projets, deux stades

|  | KurhiRachat | KurhiAssist |
| --- | --- | --- |
| Nature | Appli Expo / React Native (SDK 58), Android, avec Expo Go ou un APK | Banc d'essai « phase 0 » : scripts Node sur PC, plus une page web pour le téléphone |
| Où tourne la reconnaissance | Sur le téléphone, qui envoie la photo à Google (Gemini) ou à Anthropic (Claude) | Sur le PC de la boutique, en local. Le téléphone ouvre `http://IP-du-PC:3000` sur le même Wi-Fi. |
| Jeux couverts | Pokémon, Yu-Gi-Oh!, One Piece, Riftbound | Les mêmes, plus Lorcana |
| Réseau | Obligatoire du début à la fin (IA, bases de cartes, Cardmarket) | La reconnaissance marche hors ligne. Les prix demandent Internet. |
| Coût par photo | Gemini Flash : gratuit dans la limite d'un quota par jour. Claude Haiku 5.5 : environ 0,05 centime. Claude Opus 5.5 : environ 1,5 à 2,5 centimes (estimations, voir la méthode). | 0 €, mais le PC doit rester allumé |
| Place sur disque | Quelques Mo de bases en cache sur le téléphone | 5,6 Go dans `phase0/`, dont 1,5 Go d'images de référence, 1,6 Go de `references.zip` en double et 1,8 Go d'expériences |
| Mesures existantes | 66 tests unitaires et des bancs de recherche texte. Aucun banc photo de bout en bout avant ce rapport. | Banc de 240 photos synthétiques, 20 photos d'exemple synthétiques, 7 scans réels |
| Qualité du code | `npm test` : 66 sur 66. Docs `HANDOFF.md` en partie périmée. | `npm test` OK, `tsc --strict` sans erreur. Aucun test sur le contour, l'empreinte, la fusion ni les prix. |

KurhiRachat fait aussi les lots, les clients, les PDF, les factures, les prix eBay et Vinted et les scellés. KurhiAssist ne les a pas, donc ce rapport ne les compare pas.

2 · Reconnaissance photo

## Comment chacun reconnaît une carte

### KurhiRachatlire, puis chercher

1. La photo est réduite (1 568 px de large pour Claude, 1 800 px pour Gemini) et envoyée à l'IA avec un prompt et un schéma JSON imposé.
2. L'IA recopie ce qui est imprimé : nom, code (`PAF`, `SUDA-FR088`, `OP05-119`), numéro, passcode Yu-Gi-Oh!, langue, 1re édition, reverse. Elle a pour consigne de ne jamais deviner un code illisible.
3. Plusieurs cartes sur la photo, comme une page de classeur, donnent une ligne par carte.
4. `resolveFromPhoto` cherche par le code et par le nom en parallèle. Le code n'est gardé que s'il désigne la même carte que le nom. Pour Yu-Gi-Oh!, le passcode passe d'abord.
5. Les bases sont lues en direct : TCGdex, YGOPRODeck, les catalogues Cardmarket, optcgapi et Riftcodex.
6. Si rien n'est trouvé, l'IA relit la photo en entier. Plusieurs candidats donnent une liste à toucher : la rareté ou la version n'est jamais choisie d'office.

### KurhiAssistregarder, puis lire

1. Le contour de la carte est trouvé avec OpenCV (droites, proportions 63 × 88, couleur de la table), puis la carte est redressée. Si besoin, l'utilisateur place les 4 coins au doigt.
2. L'empreinte de l'illustration est calculée avec DINOv2-small (384 valeurs) et comparée aux 43 651 références des 5 jeux, en environ 20 ms.
3. PaddleOCR lit toute la carte : nom, numéro, codes, mots de la langue, kana.
4. La langue est décidée par un vote : code imprimé, mots-outils, table de noms, PV / HP, kana.
5. Les candidats de l'image et du texte sont réunis. Score = ressemblance + 0,2 × points ORB communs + 0,12 × texte.
6. La carte en tête est montrée avec 6 autres possibles. « Carte non reconnue » s'affiche si le score est sous 0,7 et qu'aucun numéro n'est lu.

La différence de fond : KurhiRachat s'appuie sur le texte imprimé. Il sait donc dire l'impression exacte, la langue et l'édition quand le texte est net, mais hésite entre les cartes de même nom quand le numéro est illisible. KurhiAssist s'appuie sur l'illustration. Il départage bien les cartes de même nom d'illustrations différentes, mais pas les rééditions à l'illustration identique, ni la rareté, ni l'édition.

3 · Mesure

## Le banc face-à-face

Les mêmes 246 photos sont passées dans les deux moteurs :

- les 240 photos du banc de KurhiAssist (101 Pokémon, 60 Yu-Gi-Oh!, 48 One Piece, 31 Riftbound), qui simulent un comptoir avec perspective, reflets, holo, pochettes, flou, lumière faible et autre carte dans le cadre ;
- les 6 vraies photos prises avec l'appli KurhiAssist le 3 novembre, sans la carte Lorcana que KurhiRachat ne gère pas.

Les deux moteurs sont jugés au niveau de la carte : la bonne carte, pas forcément la bonne rareté ni la bonne version.

| Groupe | Photos | Rachat : bonne carte directe | Rachat : bonne carte proposée | Rachat : langue | Assist : bonne carte en tête | Assist : dans les 5 | Assist : langue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tout | 246 | 55 % | 99 % | 98 % | 98 % | 99 % | 92 % |
| Pokémon | 103 | 76 % | 98 % | 96 % | 97 % | 98 % | 87 % |
| Yu-Gi-Oh! | 64 | 30 % | 98 % | 100 % | 100 % | 100 % | 95 % |
| One Piece | 48 | 48 % | 100 % | 100 % | 98 % | 100 % | 96 % |
| Riftbound | 31 | 48 % | 100 % | 100 % | 100 % | 100 % | 97 % |
| Vraies photos | 6 | 100 % | 100 % | 100 % | 100 % | 100 % | 83 % |

Rachat, du premier coup Rachat, proposée dans la liste Assist, en tête Assist, dans les 5

Pokémon

Rachat

76 / 98 %

Assist

97 / 98 %

Yu-Gi-Oh!

Rachat

30 / 98 %

Assist

100 / 100 %

One Piece

Rachat

48 / 100 %

Assist

98 / 100 %

Riftbound

Rachat

48 / 100 %

Assist

100 / 100 %

### Ce que veulent dire ces chiffres

- **Pourquoi KurhiRachat est si souvent « en liste ».** C'est voulu pour Yu-Gi-Oh! et One Piece : 43 listes Yu-Gi-Oh! sur 45 ne contiennent que la bonne carte en plusieurs raretés (médiane : 3 choix), et One Piece propose ses versions (normale, alt art, manga, SP). KurhiAssist ne donne pas cette information : pour Yu-Gi-Oh!, il affiche une fourchette de prix entre éditions.
- **Le vrai point faible de KurhiRachat, c'est Pokémon sans numéro lisible.** Sur les photos floues ou petites du banc, l'IA a lu le numéro de 76 cartes sur 103. Sans numéro, la recherche par nom donne presque toujours une liste de toutes les cartes de ce nom : 16 choix en médiane, jusqu'à 28. Là, l'illustration de KurhiAssist départage mieux.
- **Sur les vraies photos, le texte est lisible.** L'IA a lu le code, le passcode, la rareté et la 1re édition à chaque fois, et KurhiRachat a donné l'impression exacte du premier coup, 6 fois sur 6. KurhiAssist a trouvé la carte 6 fois sur 6, mais sans la rareté ni l'édition, et il a manqué la langue une fois.
- **Mauvaise carte donnée sans liste** : 1 photo sur 246 pour KurhiRachat (*Chaos Barian's Change*, lu correctement mais confondu par la recherche avec *Barian's Chaos Draw*). Pour KurhiAssist, la carte en tête est fausse sur 4 photos sur 246, en comptant au niveau de la carte. KurhiAssist montre toujours le résultat et 6 autres possibles à confirmer.

**Ce banc avantage KurhiAssist.** Ses photos sont fabriquées à partir des mêmes illustrations officielles que son index d'images. Pour One Piece et Riftbound, c'est la même image. Toutes les cartes du banc sont dans son index, et ses réglages ont été choisis sur ce banc. Sur ses scans réels, la ressemblance tombe de 0,97 à environ 0,8. Le contour n'était juste que sur 1 scan sur 7, et sur 44 % d'un banc synthétique plus réaliste fait dans ses propres expériences.

4 · Échecs

## Où chacun se trompe

### KurhiRachat

- Numéro Pokémon illisible : longue liste de cartes de même nom. 2 photos sans la bonne carte dans la liste (Gabite lu « Carmache » sans numéro, Shaymin promo lu « Shaymin LV.X »).
- Recherche Yu-Gi-Oh! par nom : *Chaos Barian's Change* devient *Barian's Chaos Draw* `LED9-005`. Le nom était bien lu ; c'est la recherche qui se trompe.
- Photo avec une 2e carte dans le cadre : 9 photos lues avec 2 cartes, donc 2 lignes dont une à supprimer. La bonne carte était toujours dans les lignes.
- Promos Riftbound à l'illustration identique : la carte est juste, mais la version (promo ou set) se choisit dans une liste.

### KurhiAssist

- Rééditions à l'illustration identique : 7 échecs sur 11 en id exact (promos Riftbound `opp-` contre la carte de set, Professor Juniper, Koby `P-014`).
- Contour raté : Machamp VMAX pris pour Noivern BREAK ; Mismagius pris pour une carte Lorcana ; Issho pris pour Silvers Rayleigh.
- Langue : 87 % seulement sur Pokémon (cartes françaises contre un index anglais) ; langue non lue sur un des scans réels.
- Le seuil « Carte non reconnue » (0,7) ne rejette presque rien : des cartes d'autres jeux obtiennent 0,73 à 0,92. Le seuil mesuré dans ses propres expériences, 0,935 à 0,95, n'a pas été intégré.

5 · Point par point

## Les fonctions présentes des deux côtés

| Fonction | KurhiRachat | KurhiAssist | Avantage |
| --- | --- | --- | --- |
| Reconnaissance d'une carte isolée, photo nette | Impression exacte (code, rareté, 1re édition) du premier coup sur les 6 vraies photos | Bonne carte sur les 6 vraies photos, sans rareté ni édition | Rachat |
| Photo floue, petite, code illisible | Bonne carte proposée 99 % du temps, mais souvent dans une liste ; Pokémon sans numéro : 16 choix en médiane | Bonne carte en tête 98 % du temps sur le banc, qui lui est favorable | Assist |
| Langue | Lue par l'IA : 98 %. Si illisible, FR par défaut, sans recoupement avec le code imprimé. | Vote sur le texte lu : 92 % ; Pokémon 87 %. Coréen non géré. | Rachat |
| Édition, rareté, versions | 1re édition et reverse lus sur la photo ; rareté Yu-Gi-Oh!, versions One Piece et Riftbound, Overframe proposées en liste avec image | Une référence par illustration ; reverse, 1re édition, rareté et version Metal à régler à la main | Rachat |
| Rééditions à même illustration | Départagées par le code lu | Départagées seulement si le numéro est lu par l'OCR | Rachat |
| Bases de cartes et nouvelles extensions | Lues en direct, nouvelles extensions sans rien faire ; repli Cardmarket quand TCGdex est en retard | Index figé au 2 novembre ; `npm run indexer` ajoute les nouveautés à la main (environ 1 h la première fois) | Rachat |
| Couverture | 4 jeux ; japonais Pokémon par le nom anglais | 5 jeux (Lorcana en plus) ; index en anglais seulement, pas de sets Pokémon exclusivement japonais | Assist |
| Prix Cardmarket | Offres réelles lues sur la page Cardmarket, filtrées par langue, état, édition et variante, plus le guide public pour trier les cartes à moins de 0,50 € | Prix « trend » et moyenne 30 jours du guide public, toutes langues et tous états confondus ; fourchette quand il y a plusieurs fiches ; un tiers des Riftbound sans prix | Rachat |
| Fiabilité des prix | Lent (une page par carte, 3 à 5 s de pause), fragile face à l'anti-robot Cardmarket | Rapide, mais les prix restent figés en mémoire tant que le serveur tourne | Égalité |
| Au comptoir | Bouton photo dès l'accueil, page de classeur entière, doublons fusionnés, correction par recherche texte, notes « à vérifier » | Une carte par photo, coins ajustables au doigt, 6 autres possibles ; pas de saisie de langue, d'état ni de recherche par nom | Rachat |
| Vitesse | Recherche dans les bases : 0,24 s en médiane, plus le temps de l'IA (non mesuré ici) | 1,2 s par photo sur le banc, 1,2 à 3 s sur les vraies photos | Assist |
| Coût | 0 € avec le quota gratuit de Gemini ; quelques centimes par 100 photos avec Haiku ; environ 2 centimes par photo avec Opus | 0 € | Assist |
| Vie privée, réseau | Photo envoyée à Google ou Anthropic ; en gratuit, Google peut s'en servir | Photo gardée sur le PC ; HTTP sans mot de passe sur le Wi-Fi local | Assist |
| Déploiement | Téléphone seul, Expo Go ou APK | PC allumé et même Wi-Fi obligatoires ; 5,6 Go | Rachat |

6 · Différences propres à KurhiAssist

## Ce que KurhiAssist apporte en plus

- **Reconnaissance gratuite et privée**, sans clé ni quota, qui marche sans Internet.
- **Reconnaissance par l'illustration** : elle tranche entre les cartes de même nom quand le texte est illisible, et elle marche quelle que soit la langue (Pokémon français contre index anglais : 97 % sur le banc).
- **Cadrage manuel** : placer les 4 coins au doigt et relancer.
- **Lorcana**, absent de KurhiRachat.
- **Démarche mesurée** : un banc reproductible et des rapports d'essais, y compris ceux qui ont échoué.

À noter : KurhiRachat a déjà essayé l'empreinte d'image. Son `HANDOFF.md` mentionne un essai sur 34 cartes contre 2 000 images : 19 en tête, 29 dans les 20 premières. Le code de cet essai n'est pas dans le dépôt.

7 · À corriger

## Problèmes relevés en lisant le code

### KurhiRachat

- Le doute d'authenticité n'est demandé que dans la relecture complète. La lecture rapide, qui suffit presque toujours, ne le demande pas : l'alerte « Authenticité à vérifier » ne s'affiche presque jamais.
- Recherche Yu-Gi-Oh! par nom qui donne une mauvaise carte sans liste (*Chaos Barian's Change*).
- Langue illisible : FR par défaut, sans recoupement avec le `FR` de `SUDA-FR088`. Or c'est la langue qui filtre le prix Cardmarket.
- La relecture complète n'a pas de délai et avale ses erreurs.
- Les photos ne sont jamais effacées du téléphone.
- `HANDOFF.md` ne suit plus le code (index 2 jours et non 7, guide sous 0,50 € et non 1 €).

### KurhiAssist

- Seuil « Carte non reconnue » à 0,7 au lieu des 0,935 à 0,95 mesurés.
- Contour fragile sur les vraies photos (1 juste sur 7).
- Prix gardés en mémoire jusqu'au redémarrage du serveur ; une coupure au premier scan bloque les prix d'un jeu.
- 147 doublons Riftbound (versions Metal) dans l'index.
- `phase0/.env` contient une clé API Anthropic en clair que rien n'utilise. Elle n'a plus de crédit : supprime-la ou révoque-la.
- Les corrections de l'utilisateur ne sont pas enregistrées, donc aucune vérité terrain ne s'accumule.
- La campagne de 100 à 200 vraies photos prévue en phase 0 n'a pas eu lieu (`photos/` est une copie des photos d'exemple).

8 · Suite

## Ce que je recommande

1. **Prendre 100 à 200 vraies photos au comptoir** : 4 jeux, FR, EN, JP, cartes nues, en pochette et en toploader, holo, rééditions. C'est la seule mesure qui départagera vraiment les deux moteurs ; les scripts de ce rapport peuvent les rejouer.
2. **Garder KurhiRachat comme base** : il couvre tout le parcours de rachat, lit l'impression exacte et la langue, et prend ses prix sur les offres filtrées.
3. **Y ajouter l'empreinte d'image de KurhiAssist comme arbitre**, seulement quand l'IA n'a pas lu de numéro et que la liste dépasse quelques choix. Les images de référence sont déjà dans KurhiAssist. Il reste à choisir où calculer l'empreinte : sur un petit serveur, ou dans le téléphone avec un modèle plus léger.
4. **Corriger les points de la section 7**, en priorité l'alerte d'authenticité et la recherche Yu-Gi-Oh! qui donne une mauvaise carte.
5. **Mesurer le modèle par défaut.** L'appli utilise Gemini Flash par défaut, qui n'a pas pu être testé ici (pas de clé).

9 · Méthode et limites

## Comment ces chiffres ont été obtenus

- **KurhiAssist** : son propre banc relancé le 8 novembre (`node banc/evaluer.ts`), avec le même résultat que le 3 novembre. Ses 6 vraies photos ont été repassées avec le code actuel.
- **KurhiRachat** : la clé API trouvée dans KurhiAssist n'a plus de crédit (« credit balance is too low »), donc l'API Claude n'a pas pu être appelée.
  - La lecture des photos a été faite par Claude Opus 5.5, le modèle « le plus précis » proposé dans l'appli, avec le prompt et le schéma exacts de `src/vision.js`.
  - Les photos ont été réduites comme dans l'appli, renommées au hasard pour ne rien révéler de la réponse, et lues une fois chacune.
  - Chaque lecture est ensuite passée dans le vrai code de KurhiRachat (`resolveFromPhoto`), comme dans l'appli.

  Ce n'est pas un appel API réel : les réglages (effort « low », sortie JSON imposée) peuvent donner des écarts.
- **Pas testés** : Gemini Flash (modèle par défaut de l'appli), Claude Haiku 5.5, le temps de réponse de l'IA, la relecture complète automatique.
- **Coûts** : estimés avec les tarifs publics (Opus 5.5 : 4 $ / 20 $ par million de jetons en entrée / sortie ; Haiku 5.5 : 0,10 $ / 0,50 $). Une photo représente environ 2 500 à 3 500 jetons en entrée et 300 à 500 en sortie. Rien n'a été facturé pendant ce test.
- **Vraies photos** : seulement 6, de 4 cartes différentes (1 Pokémon, 3 Yu-Gi-Oh!), toutes en français et toutes avec un reflet de flash. C'est trop peu pour conclure.

Rapport établi à partir du code de KurhiRachat (branche `feat/phase1-checking-lots`, commit `43b8a2f`) et de KurhiAssist (`phase0/`, fichiers du 7 novembre 2026). Ce comparatif n'a modifié aucun des deux projets, sauf l'ajout des résultats `banc/resultats/face-a-face-2026-11-08.json` et `.md` dans KurhiAssist.