# Stock Multi-Sites — MVP (avec intégration Popina)

Application de gestion de stock multi-sites pour la restauration : réception fournisseurs (externes et internes), production interne avec nomenclature (BOM), transferts inter-sites (magasins, franchisés, clients), traçabilité par lot/DLC, et intégration temps réel avec la caisse **Popina** via webhooks.

Construite comme demandé dans le prompt de spécification (`prompt-app-gestion-stock-restauration.md`), en couvrant le **cœur MVP** : référentiels, stock, réception, production, transferts, intégration Popina. La facturation avancée, les royalties franchisés et les notifications multi-canaux ne sont **pas** implémentées dans cette V1 (voir "Ce qui n'est pas fait" plus bas).

## Pourquoi une stack "zéro dépendance" et pas Next.js/Prisma comme envisagé ?

Le prompt d'origine laissait la stack ouverte. L'environnement dans lequel ce code a été généré n'avait pas accès aux registres de paquets (npm/pip bloqués par la politique réseau du bac à sable), rendant impossible l'installation de Next.js, Prisma, etc. Le choix a donc été fait de construire une application **Node.js pure**, sans aucune dépendance externe :

- **Serveur HTTP** : module natif `node:http` + un petit routeur maison (`lib/router.js`)
- **Base de données** : `node:sqlite` (SQLite intégré à Node.js depuis la 22.5, aucune installation requise)
- **Rendu** : HTML généré côté serveur (pas de framework front), CSS classique dans `public/style.css`
- **Tests** : `node --test` (runner de tests intégré à Node.js)

Avantage direct : **zéro `npm install`**, l'app tourne immédiatement avec `node server.js`. Inconvénient : moins de confort de dev qu'avec un framework. Si vous reprenez ce projet dans un environnement avec accès réseau complet, migrer vers Next.js + Prisma/PostgreSQL (comme évoqué dans le prompt d'origine) est tout à fait recommandé pour la suite — l'architecture (séparation `lib/` métier, `routes/` HTTP) est volontairement simple à porter.

## Prérequis

- **Node.js >= 22.5** (pour `node:sqlite`). Vérifiez avec `node -v`.

## Démarrage rapide

```bash
npm run seed      # crée data/app.db et insère un jeu de données de démonstration
npm start         # démarre le serveur sur http://localhost:3000
```

Ouvrez http://localhost:3000. Un groupe de démonstration est préchargé : un atelier de production, deux restaurants, une franchise, des produits avec recettes, et un site connecté à Popina (fictif).

Pour repartir de zéro : `npm run reset-db && npm run seed`.

Pour lancer les tests automatisés (moteur de stock + sécurité webhook Popina) :

```bash
npm test
```

## Tour des modules

| Module | Ce qu'il couvre |
|---|---|
| **Sites** | Magasins, points de production, franchisés, clients externes, entrepôts |
| **Produits & recettes** | Matières premières / semi-finis / produits finis, nomenclature (BOM) — quantité d'ingrédient consommée par unité produite/vendue |
| **Stock** | Niveau de stock par site, détail par lot avec DLC, ajustement d'inventaire, déclaration de perte |
| **Fournisseurs** | Externes et internes (un site de production = un fournisseur pour les autres sites) |
| **Commandes fournisseurs** | Création, ajout de lignes supplémentaires, réception partielle/totale (incrémente le stock avec numéro de lot et DLC) |
| **Commande rapide** (`/purchase-orders/quick`) | Réapprovisionnement multi-produits en une seule soumission (cas d'une boutique qui commande chaque jour au labo) : stock actuel et seuil affichés par produit, quantité suggérée automatiquement |
| **Production** | Ordre de fabrication : consomme automatiquement les matières premières selon la recette, produit un lot de produit fini |
| **Transferts** | Brouillon → envoi (décrémente le site émetteur) → réception (incrémente le site destinataire), avec prix de cession optionnel |
| **Mouvements** | Journal d'audit complet et immuable de tous les mouvements de stock, export CSV |
| **Popina** | Configuration des sites connectés, mapping produits (ajout/retrait), réception des webhooks, journal de synchro |
| **Import CSV** | Import en masse (sites, produits, stock initial), export/sauvegarde complète de la base (fichier SQLite) |

Le stock affiché est calculé à partir du **grand livre des mouvements** (`stock_movements`), pas seulement de la somme des lots : ça garantit que le stock reste cohérent même en cas de vente Popina dépassant le stock réellement connu (situation courante en démarrage, tant que le stock initial et les recettes ne sont pas parfaitement calés).

## Intégration Popina : comment ça marche ici

Conformément à la doc officielle (`docs.pragma-project.dev`, résumée en Annexe 9 du prompt d'origine) :

- L'**API Popina est en lecture seule** aujourd'hui : impossible d'y écrire un niveau de stock. Cette app reste donc la seule source de vérité sur les quantités.
- Le décrément de stock se fait via le **webhook `order.paid`** envoyé par Popina à chaque commande encaissée.

### Configurer un vrai site Popina

1. Aller sur **Popina → Sites connectés**, renseigner l'identifiant de location Popina (fourni par le support Popina) et éventuellement la clé API.
2. Un secret webhook est généré automatiquement. L'URL à donner à Popina est affichée : `https://votre-domaine/webhooks/popina/{id}`.
3. Aller sur **Popina → Mapping produits** et associer chaque `productCatalogId` du catalogue Popina à un produit interne (avec ou sans recette).
4. Configurer ce même webhook (URL + secret) côté support Popina pour l'événement `order.paid`.

**URL générale (multi-sites)** : certains comptes Popina n'exposent qu'une seule URL de webhook par intégration plutôt qu'une par établissement. Dans ce cas, utilisez `https://votre-domaine/webhooks/popina` (sans identifiant) — le site interne est retrouvé automatiquement via le `locationId` présent dans chaque commande reçue. Chaque site connecté garde son propre secret HMAC ; donnez à Popina le secret correspondant à chaque location.

### Tester sans compte Popina réel

La page **Popina → Simuler une vente** (accessible depuis "Mapping") envoie un vrai webhook `order.paid`, correctement signé en HMAC-SHA256, vers l'endpoint local — exactement comme le ferait Popina. C'est le moyen de vérifier bout en bout que le décrément de stock fonctionne, sans avoir de terminal de caisse.

### Ce qui est géré dans le traitement du webhook (voir `lib/popina.js`)

- Vérification de signature HMAC-SHA256 (`x-popina-hmac-signature`), rejet sinon (401)
- Idempotence via `x-popina-webhook-id` (un même webhook rejoué n'est traité qu'une fois)
- Respect de `stockImpactIndicator` (additions splittées : seule la ligne "parent" décrémente le stock)
- Lignes `isCanceled` ignorées
- Produits vendus au poids (`weight`) : consommation proportionnelle au poids réel
- `isLoss`/`lossReason` : tracé comme perte plutôt que comme vente
- Produits Popina non mappés : n'interrompt pas le traitement, journalisé en statut `UNMAPPED` pour action corrective
- Réponse toujours envoyée sous les 30s comme l'exige Popina
- `order.canceled` : si la commande avait déjà décrémenté du stock (webhook `order.paid` reçu avant), les mouvements de vente correspondants sont automatiquement annulés (stock recrédité). Testable via *Popina → Simuler une vente*, qui propose un bouton d'annulation juste après une simulation.

### Ce qui n'est **pas** encore fait côté Popina

- Appel réel à l'API REST Popina (catalogue, orders, reports) : le code de webhook est testé et fonctionnel, mais aucun appel sortant vers `api.pragma-project.dev` n'a pu être testé dans cet environnement (accès réseau restreint). Le mapping produit se fait donc manuellement pour l'instant plutôt que par import automatique du catalogue.
- Gestion de l'événement `order.call` (reçu mais ignoré/journalisé, non traité — utile pour un suivi live avant paiement)
- Reconciliation automatique via l'endpoint Reports (rapprochement stock théorique/réel de fin de service)

## Proteger l'acces (avant tout hebergement partage)

L'app n'a pas de systeme de comptes utilisateurs, mais un mot de passe global peut etre active pour bloquer l'acces sans identifiants. Definissez deux variables d'environnement avant de lancer le serveur :

```bash
BASIC_AUTH_USER=admin BASIC_AUTH_PASS=un-mot-de-passe-solide npm start
```

Sans ces deux variables, l'app reste ouverte (comportement par defaut, pratique en local) et un avertissement s'affiche au demarrage. Une fois definies, toutes les pages demandent une authentification HTTP Basic (popup du navigateur) — sauf le endpoint webhook Popina (`/webhooks/popina/:id`), qui reste public car il est deja securise par sa propre signature HMAC (voir section Popina ci-dessus). Sur un hebergeur (Render, Railway...), definissez ces deux variables dans la configuration d'environnement du service.

## Heberger sur Render (lien partageable)

Le depot inclut un [render.yaml](render.yaml) (Blueprint Render) qui provisionne en un clic le service web **et** un disque persistant pour la base SQLite (indispensable : sans disque persistant, la base serait recreee vide a chaque redeploiement/reveil du service).

1. **Poussez le code sur GitHub** (ou GitLab/Bitbucket) — Render deploie depuis un depot Git. Ce dossier n'est pas encore un depot git ; demandez-moi si vous voulez que je l'initialise.
2. Sur [render.com](https://render.com), **New > Blueprint**, connectez le depot. Render lit `render.yaml` et propose de creer le service + le disque.
3. Render vous demandera les valeurs de `BASIC_AUTH_USER` et `BASIC_AUTH_PASS` (marquees `sync: false` dans le blueprint, donc jamais commitees) — definissez un identifiant/mot de passe solides ici.
4. **Plan requis : "Starter" (payant), pas "Free"** — le tier gratuit de Render n'accepte pas de disque persistant et met le service en veille apres inactivite (ce qui reinitialiserait les donnees a chaque reveil). Verifiez les tarifs actuels sur render.com.
5. Une fois deploye, ouvrez le **Shell** du service (onglet "Shell" dans le dashboard Render) et lancez `npm run seed` une seule fois pour charger les donnees de demonstration (ou importez directement vos propres donnees via `/import`, voir plus haut).
6. Configurez le webhook Popina (section Popina ci-dessus) avec l'URL publique fournie par Render : `https://votre-service.onrender.com/webhooks/popina/{id}`.

La version de Node est fixee via [.node-version](.node-version) (`22`, compatible avec `node:sqlite`).

## Ce qui n'est pas fait (V2, voir le prompt d'origine)

- **RBAC (roles/permissions par utilisateur)** : non implemente. Une authentification HTTP Basic globale existe (voir "Proteger l'acces" ci-dessous) mais ne distingue pas les roles/personas de la section 3 du prompt.
- **Facturation franchisés/clients, royalties** : les transferts supportent un prix de cession optionnel mais aucune facture n'est générée.
- **Notifications** (email, push) : les alertes existent uniquement à l'écran (tableau de bord), pas de canal sortant.
- **Mode hors-ligne / PWA** : non implémenté (décision prise volontairement pour cette V1, voir le prompt).
- **Multi-tenant commercial** (self-signup, facturation SaaS) : le modèle de données est prêt (`tenant_id` partout), mais aucune UI de gestion multi-groupes.
- **Export comptable** : non implémenté dans cette V1 (prévu générique CSV/Excel dans le prompt).

## Structure du projet

```
lib/            logique métier (db, stock, popina, alerts, render, util, router)
routes/         un fichier par domaine fonctionnel (sites, products, stock, ...)
public/         CSS
test/           tests node:test (moteur de stock, sécurité webhook Popina)
data/           base SQLite (générée, ignorée par git)
server.js       point d'entrée HTTP
```
