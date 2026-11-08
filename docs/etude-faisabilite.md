# Kurhinotama – Assistant de rachat TCG : étude de faisabilité

Date : 2 novembre 2026 · Statut : proposition à valider (aucun code écrit)

## 1. Verdict

Le projet est faisable. Le cœur (lots, statuts, historique, taux de rachat, PDF) ne pose aucun risque technique.
Trois sujets sont durs et dictent l'architecture :

1. **Prix par langue.** Aucune source officielle accessible ne donne automatiquement un prix Cardmarket filtré par langue et par état.
2. **Ventes réellement conclues.** L'API eBay des ventes conclues est en accès restreint. Vinted n'a pas d'API publique et interdit le scraping.
3. **Variantes visuelles.** Reverse, 1re édition, raretés Yu-Gi-Oh!, parallèles One Piece : la reconnaissance photo propose, l'humain valide.

Conséquence : l'application doit traiter chaque prix comme une **observation datée, sourcée et typée** (vente conclue, annonce, indice agrégé, saisie manuelle). Elle doit aussi rendre la saisie manuelle d'une observation aussi rapide qu'un clic sur un lien.

## 2. Faits vérifiés (2 novembre 2026)

| Sujet | Constat | Source |
|---|---|---|
| API Cardmarket officielle | Fermée : « not accepting applications for access to the Cardmarket API » | [help.cardmarket.com](https://help.cardmarket.com/en/cardmarket-api) |
| Fichiers publics Cardmarket | Catalogue produits (cartes + scellés) et price guide JSON, mis à jour chaque nuit, accessibles sans clé. Vérifié pour Yu-Gi-Oh! (jeu 3), Pokémon (6), One Piece (18), Riftbound (22). Champs : `avg`, `low`, `trend`, `avg1`, `avg7`, `avg30` (+ variantes holo). **Aucun champ langue ni état.** | `downloads.s3.cardmarket.com/productCatalog/...` (testé) |
| Qualité du price guide | Valeurs aberrantes possibles (ex. un `low` à 100 000 € pour un `avg` à 2 103 €) | même fichier |
| eBay Browse API | Annonces actives, accessible aux développeurs, marketplace EBAY_FR | developer.ebay.com |
| eBay Marketplace Insights | Ventes conclues sur 90 jours, mais « limited release », sur approbation | [developer.ebay.com](https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html) |
| Vinted | API « Pro Integrations » réservée aux vendeurs pros pour leur propre stock, sans recherche catalogue. CGU contre bots et scraping (source secondaire, à confirmer) | [friptadium.com](https://friptadium.com/blogs/actualites/api-vinted-officielle-risques) |
| TCGdex (Pokémon) | Gratuit, FR/EN/DE/ES/IT/PT, images, variantes (`firstEdition`, `holo`, `reverse`), bloc `pricing.cardmarket` | [tcgdex.dev](https://tcgdex.dev/) |
| Riftbound | Riftcodex (gratuit, sans clé), Piltover Archive, Scrydex | [riftcodex.com](https://riftcodex.com/blog/riftcodex-is-live) |
| One Piece | optcgapi.com (gratuit, anglais), catalogue Cardmarket (numéro inclus dans le nom, ex. `Roronoa Zoro (OP01-001)`) | [optcgapi.com](https://optcgapi.com/) |
| Reconnaissance commerciale | Ximilar (Pokémon, Riftbound… ; tarif « business » pour les prix), Scrydex (endpoint Vision, plans à crédits) | [ximilar.com](https://www.ximilar.com/blog/how-to-automate-pricing-of-cards-comics-via-api/), [scrydex.com](https://scrydex.com/pricing) |

## 3. Bases de cartes

| TCG | Base principale | Langues | Remarques |
|---|---|---|---|
| Pokémon | TCGdex | FR, EN + européennes | Japonais à vérifier. Prix Cardmarket déjà rattachés. |
| Yu-Gi-Oh! | YGOPRODeck API | EN, noms FR via paramètre de langue | Codes de set + raretés par impression. Images à télécharger en local (pas de hotlink). |
| One Piece | optcgapi + catalogue Cardmarket | EN (JP à couvrir à part) | Le numéro `OPxx-yyy` simplifie l'appariement. |
| Riftbound | Riftcodex | EN | Jeu récent, petit catalogue. |
| Scellés (tous) | Catalogue Cardmarket `nonsingles` | — | ETB, displays, boosters, decks déjà référencés avec un prix. |

**Pivot de prix commun : l'identifiant produit Cardmarket (`idProduct`).** Chaque carte reconnue est rattachée à un `idProduct`. Ce rattachement est le travail le plus délicat de la phase 1 (réimpressions, promos, variantes). Il se fait une fois par carte puis il est mémorisé.

## 4. Reconnaissance photo

### Options comparées

| Approche | Forces | Faiblesses |
|---|---|---|
| **IA vision (Claude)** lit la carte et renvoie un JSON (nom, numéro, set, langue, rareté, tampon 1re édition) | Lit le texte, donc **détecte la langue** (critère obligatoire). Aucun index à construire. Couvre les 4 TCG et les scellés. | Coût par photo. Peut hésiter entre variantes visuellement proches. |
| Empreinte d'image (embeddings) + recherche dans un index d'images de référence | Rapide, quasi gratuit à l'usage, robuste sur l'illustration | Ne voit pas la langue (même illustration). Index à construire par jeu et par langue. |
| API commerciale (Ximilar, Scrydex Vision) | Prêt à l'emploi | Couverture incomplète selon les jeux, coût, dépendance |

### Décision (2 novembre 2026) : reconnaissance locale et gratuite

Choix retenu : **empreinte d'image + lecture du texte**, comme les applications de scan de cartes, sans service payant. Raisons : aucun coût à l'usage, et l'application doit pouvoir tourner sur un PC modeste.

1. L'application trouve le contour de la carte et la redresse.
2. Elle compare l'empreinte de l'image à un index local d'environ 40 000 cartes de référence (modèle DINOv2, sur processeur).
3. Elle lit le texte (OCR) pour la langue et le numéro, qui départage les réimpressions à illustration identique.
4. L'utilisateur confirme d'un tap, ou corrige. Variante et état restent manuels.

L'IA vision payante (Claude) reste une option ajoutable plus tard comme moteur alternatif, si la phase 0 montre un manque de précision.

### Scan de classeur

Une page de classeur standard contient 9 cartes. Le découpage se fait par détection des contours, avec la grille 3×3 comme repli. Ensuite chaque carte suit le flux unitaire. Les reflets des pochettes sont la vraie difficulté : il faudra un guide de prise de vue (angle, lumière) et un recadrage manuel possible.

### Scellés

La reconnaissance du visuel et du texte de la boîte suffit dans la plupart des cas. La lecture du code-barres EAN (API native du navigateur) est un plus. Une table EAN → produit Cardmarket se construit au fil des rachats.

## 5. Prix : sources et mode d'accès

| Source | Données | Accès retenu | Type de prix |
|---|---|---|---|
| Cardmarket price guide | `trend`, `avg`, `avg1/7/30`, `low` par produit | Import automatique quotidien (fichiers publics) | Indice issu des ventes, **toutes langues et états confondus** |
| Cardmarket offres filtrées (langue, état) | Prix des offres visibles | Lien profond pré-filtré + saisie rapide | Annonces |
| eBay annonces | Prix, état, liens | Browse API (automatique) | Annonces |
| eBay ventes conclues | Prix vendus | Marketplace Insights si eBay approuve. Sinon lien profond « vendus » + saisie rapide | Ventes réelles |
| Vinted | Annonces | Lien profond de recherche + saisie rapide. Pas d'automatisation. | Annonces |
| Option payante (à évaluer) | Scrydex, PriceCharting, Ximilar | Selon budget | Variable |

**Saisie rapide** : depuis la fiche article, un bouton ouvre la recherche pré-remplie (Cardmarket filtré langue/état, eBay vendus, Vinted). L'utilisateur lit les prix et saisit 1 à 5 valeurs. Chaque valeur devient une observation avec source, date, lien, type et langue. C'est la solution conforme pour les données que les plateformes ne donnent pas par API.

Écarté : le scraping de Cardmarket, eBay ou Vinted (CGU, protections anti-bot, risque de blocage du compte vendeur de la boutique). Les services tiers de scraping (Apify, etc.) portent le même risque juridique. Ils ne sont donc pas retenus par défaut.

## 6. Estimation et indice de fiabilité

Chaque observation porte : source, type (vente / annonce / indice / manuel), prix, devise, date, langue, état, lien, quantité.

Calcul proposé, volontairement simple et explicable :

1. Filtrer les observations compatibles (même langue et même état, sinon ajustées par coefficient).
2. Si au moins une vente réelle existe : **médiane pondérée par la récence** des ventes.
3. Sinon : `trend` Cardmarket corrigé des coefficients langue et état. Les annonces servent de plafond.
4. Écarter les valeurs aberrantes (hors 0,5×–2× la médiane).

Les coefficients d'état sont paramétrables (exemple : NM 100 %, EX 85 %, GD 70 %, LP 55 %, PL 40 %). Les coefficients de langue le sont par jeu.

| Indice | Condition (exemple) |
|---|---|
| Élevé | ≥ 5 ventes de moins de 30 jours, même langue, dispersion faible |
| Moyen | 2 à 4 ventes, ou indice Cardmarket avec langue confirmée manuellement |
| Faible | Indice Cardmarket seul (langue non distinguée) ou annonces seules |
| Très faible | 1 seule observation |

L'écran affiche toujours le nombre d'observations, leur type et leur date. Les seuils se règlent après la phase 1 avec des données réelles.

## 7. Architecture technique

```
Téléphone / tablette / PC (application web installable, PWA)
        │  photos, saisies
        ▼
Serveur applicatif (TypeScript)
  ├─ Lots, articles, clients, statuts, numérotation
  ├─ Identification : Claude vision → recherche base de cartes → candidats
  ├─ Prix : sources (Cardmarket fichiers, eBay API, saisie manuelle)
  ├─ Estimation + indice de fiabilité
  ├─ Taux de rachat, PDF
  └─ Tâche nocturne : import catalogue + price guide Cardmarket
        │
        ├─ PostgreSQL (lots, articles, observations, historique)
        └─ Stockage photos (disque ou stockage objet compatible S3)
```

| Choix | Recommandation | Raison |
|---|---|---|
| Client | PWA (web installable) | Un seul code pour téléphone, tablette et PC. Accès caméra. Pas de store ni de compte développeur Apple. |
| Langage | TypeScript de bout en bout (Next.js) | Un seul langage pour l'interface et le serveur |
| Base | PostgreSQL | Relationnel (lots, articles) + JSON pour les réponses brutes des sources |
| Photos | Disque du serveur avec sauvegarde, ou stockage objet S3 | Simple, peu coûteux |
| Reconnaissance | Locale : OpenCV (contour), DINOv2 (empreinte), Tesseract (texte) | Gratuite, sans clé API, fonctionne sur processeur seul |
| Hébergement | Un VPS (Docker Compose) + sauvegarde quotidienne hors site | Une seule machine, coût fixe faible |

### Modularité

Deux points d'extension seulement :

- **Jeu** : comment chercher une carte dans la base de ce jeu et la rattacher à un `idProduct` Cardmarket. Ajouter un TCG = ajouter un module jeu.
- **Source de prix** : pour un article, renvoyer une liste d'observations. Ajouter une source = ajouter un module source.

## 8. Modèle de données (principe)

- **Client** : nom, contact, pièce d'identité si exigée (voir §10).
- **Lot** : numéro unique (`KUR-2026-0001`), client, statut (`en_cours`, `en_attente`, `accepte`, `refuse`, `rachete`, `archive`), dates, notes.
- **Article** : lot, type (carte / scellé), jeu, référence base de cartes, `idProduct` Cardmarket, nom, set, numéro, langue, rareté, variante, édition, état, quantité, photos, prix de rachat forcé (optionnel).
- **Estimation** : article, date, valeur marché, indice de fiabilité, détail du calcul. **Ajout seulement, jamais modifiée.**
- **Observation** : estimation, source, type, prix, date, lien, langue, état. **Ajout seulement.**
- **Règle de taux** : jeu, catégorie, tranche de valeur, taux, priorité.

« Recalculer les prix » crée une nouvelle estimation par article. Les anciennes restent consultables, ce qui permet de comparer les évolutions dans le temps. Ce modèle est en place dès la phase 1, même si l'écran de comparaison arrive en phase 2.

## 9. Coûts estimés

| Poste | Estimation mensuelle |
|---|---|
| Reconnaissance locale | 0 €. Environ 1 Go d'images de référence sur le disque. |
| Hébergement VPS + sauvegardes | 10 à 25 € |
| Cardmarket fichiers, TCGdex, YGOPRODeck, Riftcodex, optcgapi | 0 € |
| eBay Browse API | 0 € (quotas) |
| Options payantes (Scrydex, Ximilar, PriceCharting) | Selon devis, uniquement si la phase 0 ou la phase 1 le justifie |
| Nom de domaine | ~1 € |

Option non retenue : une IA vision en ligne (Claude) coûterait de 0,05 à 4 centimes par photo selon le modèle.

## 10. Difficultés et points réglementaires

**Techniques**

- Prix par langue non automatisables de façon conforme. Solution : coefficients + saisie rapide + indice de fiabilité honnête.
- Rattachement carte ↔ produit Cardmarket : variantes, promos, réimpressions.
- Variantes visuelles fines (reverse, 1re édition, raretés Yu-Gi-Oh!, parallèles et alt arts).
- Photos de classeur : reflets, perspective.
- Couverture japonaise plus faible dans les bases gratuites.
- Les bases tierces gratuites peuvent changer ou disparaître. Le cache local des données réduit ce risque.

**Réglementaires (à valider avec votre comptable ou un juriste)**

- **Plateformes** : respect des CGU de Cardmarket, eBay et Vinted. Usage interne des fichiers Cardmarket, sans redistribution.
- **Registre des objets mobiliers (registre de police)** : un professionnel qui rachète des objets d'occasion à des particuliers doit tenir ce registre (identité du vendeur, description, prix). L'application peut le produire automatiquement.
- **Paiement en espèces** : plafond légal pour un paiement par un professionnel, à vérifier.
- **TVA sur la marge** des biens d'occasion : impact sur la marge théorique affichée.
- **RGPD** : données clients et pièces d'identité. Durée de conservation, accès restreint, sauvegardes chiffrées.

## 11. Plan de développement

| Phase | Contenu | Livrable |
|---|---|---|
| **0. Test de faisabilité** (~1 semaine) | Index local d'images de référence. 100 à 200 photos réelles de la boutique (4 TCG, plusieurs langues, cartes en pochette). Mesure : contour, jeu, langue, bonne carte en 1re et dans les 3 premières, temps. Test du rattachement Cardmarket. | Rapport chiffré, décision de poursuite |
| **1. Version 1** | PWA, connexion, lots (numéro, statuts, plusieurs lots en parallèle), photo et import, identification unitaire avec correction, Pokémon + Yu-Gi-Oh! + One Piece, import Cardmarket quotidien, annonces eBay, liens profonds + saisie rapide, estimation + indice, total du lot, doublons et quantités, recherche de dossiers | Utilisable au comptoir |
| **2. Historique** | Bouton « Recalculer les prix », comparaison des estimations dans le temps, écran historique des rachats | Suivi des lots qui reviennent |
| **3. Rachat et documents** | Règles de taux, prix proposé, marge théorique, ajustement manuel, PDF interne et bon de rachat client aux couleurs Kurhinotama, registre de police | Rachat de bout en bout |
| **4. Scan de classeur et scellés** | Découpage d'une page en 9 cartes, lecture EAN, Riftbound | Gain de temps sur les gros lots |
| **5. Sources avancées** | eBay ventes conclues (si approuvé), source payante si utile, statistiques | Meilleure fiabilité |

Ordre logique : chaque phase est utilisable seule. La phase 0 peut arrêter ou réorienter le projet à moindre coût.

## 12. Décisions à prendre

1. Budget mensuel acceptable pour l'IA et d'éventuelles sources payantes.
2. Nombre d'utilisateurs : vous seul ou aussi des employés.
3. Volume mensuel approximatif de cartes rachetées.
4. Hébergement : VPS géré par nous, ou service managé.
5. Fourniture des photos de test pour la phase 0.
6. Charte graphique Kurhinotama (logo, couleurs) pour les PDF.
