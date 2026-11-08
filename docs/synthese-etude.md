# Synthèse de l'étude de faisabilité – 2 novembre 2026

Étude complète : [etude-faisabilite.md](etude-faisabilite.md).

> **Mise à jour du 2 novembre 2026 :** la reconnaissance par IA payante (Claude) est remplacée par une reconnaissance locale et gratuite (empreinte d'image + lecture du texte), comme les applications de scan de cartes. Voir l'étude, section 4.

## Verdict

Le projet est faisable. Les lots, les statuts, l'historique, les taux de rachat et les PDF ne posent aucun risque technique. Trois points sont durs et dictent l'architecture :

1. **Prix selon la langue.** L'API officielle de Cardmarket est fermée aux nouvelles demandes. En revanche, Cardmarket publie chaque nuit des fichiers gratuits avec son catalogue (cartes et scellés) et ses prix moyens pour Pokémon, Yu-Gi-Oh!, One Piece et Riftbound (testé le 2 novembre 2026). Limite : ces prix ne séparent ni la langue ni l'état de la carte.
2. **Ventes réellement conclues.** L'API eBay des ventes conclues n'est ouverte que sur approbation. Vinted n'a pas d'API publique pour chercher des annonces et ses conditions interdisent les robots.
3. **Variantes proches.** Reverse, 1re édition, raretés Yu-Gi-Oh!, versions parallèles One Piece : l'IA propose, mais un humain doit valider.

## Réponse proposée

- **Chaque prix devient une observation conservée.** Elle garde sa source, sa date, son lien et son type : vente conclue, annonce, indice Cardmarket ou saisie manuelle.
- **Récupération automatique** des prix Cardmarket et des annonces eBay.
- **Saisie rapide pour le reste.** Un bouton ouvre la recherche déjà filtrée (Cardmarket par langue et état, eBay vendus, Vinted). L'utilisateur saisit ensuite 1 à 5 prix, et chacun reste conservé avec sa source.
- **Pas de scraping**, à cause des conditions des plateformes et du risque de blocage du compte vendeur de la boutique.
- **Reconnaissance en trois temps.** Claude lit la photo (nom, numéro, set, langue), l'application cherche ces éléments dans la base de cartes, puis l'utilisateur confirme d'un tap. La langue se lit sur le texte de la carte, ce qu'une simple comparaison d'images ne sait pas faire.
- **Architecture :** une application web installable (téléphone, tablette, ordinateur), TypeScript, base PostgreSQL, un petit serveur loué. Ajouter un TCG ou une source de prix revient à ajouter un module.
- **Coûts estimés :** environ 2 à 4 centimes par photo avec le modèle Opus 5.5, à peu près deux fois moins avec Sonnet 5.5. L'hébergement coûte 10 à 25 € par mois. Les bases de cartes et les fichiers Cardmarket sont gratuits.
- **Points réglementaires à vérifier avec le comptable :** le registre de police (l'application peut le remplir automatiquement), le plafond de paiement en espèces, la TVA sur la marge et le RGPD pour les données clients.

## Plan

- **Phase 0, test d'environ une semaine :** 100 à 200 vraies photos de la boutique pour mesurer la précision avant d'aller plus loin.
- **Phase 1, version 1 :** identification, prix et lots.
- **Phase 2 :** historique et bouton « Recalculer les prix ». Les données sont conservées dès la version 1 pour que ce soit possible.
- **Phase 3 :** taux de rachat, PDF et registre.
- **Phase 4 :** scan de classeur et scellés.
- **Phase 5 :** sources de prix supplémentaires.

Décisions à prendre (section 12 de l'étude) : budget, nombre d'utilisateurs, volume de cartes, hébergement, photos de test, charte graphique.

## Sources

- [Cardmarket – API (help center)](https://help.cardmarket.com/en/cardmarket-api)
- [eBay Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html)
- [eBay research APIs](https://developer.ebay.com/develop/buying-apps/research-apis)
- [API Vinted officielle : risques](https://friptadium.com/blogs/actualites/api-vinted-officielle-risques)
- [TCGdex](https://tcgdex.dev/)
- [Riftcodex](https://riftcodex.com/blog/riftcodex-is-live)
- [Scrydex – Riftbound](https://scrydex.com/docs/riftbound/cards)
- [Scrydex – tarifs](https://scrydex.com/pricing)
- [OPTCG API](https://optcgapi.com/)
- [Ximilar – pricing via API](https://www.ximilar.com/blog/how-to-automate-pricing-of-cards-comics-via-api/)
- [go-mtgban cardmarket (format du price guide)](https://beta.pkg.go.dev/github.com/mtgban/go-mtgban/cardmarket)
