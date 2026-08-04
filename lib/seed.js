// Jeu de donnees de demonstration : un groupe avec 1 site de production, 2 magasins, 1 franchise.
const db = require('./db');
const { id } = require('./util');
const stock = require('./stock');


function run() {
  const existing = db.prepare('SELECT COUNT(*) as n FROM tenants').get();
  if (existing.n > 0) {
    console.log('Des donnees existent deja. Utilise `npm run reset-db` pour repartir de zero.');
    return;
  }

  const tenantId = id('tenant');
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, 'Groupe Jean de la Cote');

  const units = [
    ['u_kg', 'kg', 'Kilogramme'],
    ['u_l', 'L', 'Litre'],
    ['u_unit', 'unit', 'Unite'],
    ['u_carton', 'carton', 'Carton'],
  ];
  const insUnit = db.prepare('INSERT INTO units (id, code, label) VALUES (?, ?, ?)');
  for (const u of units) insUnit.run(...u);

  const insSite = db.prepare('INSERT INTO sites (id, tenant_id, name, type, address) VALUES (?, ?, ?, ?, ?)');
  const siteProd = id('site');
  const siteStore1 = id('site');
  const siteStore2 = id('site');
  const siteFranchise = id('site');
  insSite.run(siteProd, tenantId, 'Atelier de production A', 'PRODUCTION', '12 rue de l\'Industrie, Bordeaux');
  insSite.run(siteStore1, tenantId, 'Restaurant Bordeaux Centre', 'STORE', '3 rue de la Cote, Bordeaux');
  insSite.run(siteStore2, tenantId, 'Restaurant Merignac', 'STORE', '8 avenue de l\'Aeroport, Merignac');
  insSite.run(siteFranchise, tenantId, 'Franchise Lyon Part-Dieu', 'FRANCHISEE', '5 rue de la Republique, Lyon');

  const insSupplier = db.prepare('INSERT INTO suppliers (id, tenant_id, name, is_internal, internal_site_id, contact_email, lead_time_days) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const supExternal = id('sup');
  const supInternal = id('sup');
  insSupplier.run(supExternal, tenantId, 'Metro Frais Distribution', 0, null, 'commandes@metrofrais.example', 2);
  insSupplier.run(supInternal, tenantId, 'Atelier de production A (interne)', 1, siteProd, null, 1);

  const insProduct = db.prepare('INSERT INTO products (id, tenant_id, sku, name, type, unit_id, category, is_sold_by_weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const P = {};
  const mk = (sku, name, type, unit, category, weight = 0) => {
    const pid = id('prod');
    insProduct.run(pid, tenantId, sku, name, type, unit, category, weight ? 1 : 0);
    P[sku] = pid;
    return pid;
  };

  // Matieres premieres
  mk('FARINE', 'Farine T55', 'RAW', 'u_kg', 'Epicerie');
  mk('BEURRE', 'Beurre doux', 'RAW', 'u_kg', 'Cremerie');
  mk('POULET', 'Filet de poulet', 'RAW', 'u_kg', 'Boucherie');
  mk('SALADE', 'Salade verte', 'RAW', 'u_kg', 'Fruits & legumes');
  mk('CHEVRE', 'Fromage de chevre', 'RAW', 'u_kg', 'Cremerie');
  mk('TOMATE', 'Tomates', 'RAW', 'u_kg', 'Fruits & legumes');
  mk('PERRIER_BASE', 'Perrier 33cl (bouteille)', 'RAW', 'u_unit', 'Boissons');

  // Produits finis (avec recette) - noms alignes sur les exemples de la doc Popina
  const croissant = mk('CROISSANT', 'Croissant', 'FINISHED', 'u_unit', 'Boulangerie');
  const supreme = mk('SUPREME_POULET', 'Supreme de poulet', 'FINISHED', 'u_unit', 'Plats');
  const salade = mk('SALADE_CHEVRE', 'Salade chevre chaud', 'FINISHED', 'u_unit', 'Entrees');
  // Produit fini vendu au poids (ex: cereales / buffet au poids)
  const buffet = mk('BUFFET_POIDS', 'Buffet salade au poids', 'FINISHED', 'u_kg', 'Entrees', true);
  // Produit de revente simple, sans recette (consomme directement)
  const perrier = mk('PERRIER', 'Perrier 33cl', 'FINISHED', 'u_unit', 'Boissons');

  const insRecipe = db.prepare('INSERT INTO recipe_items (id, product_id, ingredient_product_id, quantity, unit_id) VALUES (?, ?, ?, ?, ?)');
  insRecipe.run(id('ri'), croissant, P.FARINE, 0.06, 'u_kg');
  insRecipe.run(id('ri'), croissant, P.BEURRE, 0.03, 'u_kg');
  insRecipe.run(id('ri'), supreme, P.POULET, 0.2, 'u_kg');
  insRecipe.run(id('ri'), salade, P.SALADE, 0.08, 'u_kg');
  insRecipe.run(id('ri'), salade, P.CHEVRE, 0.09, 'u_kg');
  insRecipe.run(id('ri'), salade, P.TOMATE, 0.05, 'u_kg');
  insRecipe.run(id('ri'), buffet, P.SALADE, 1.0, 'u_kg'); // pour 1kg de buffet vendu -> 1kg de salade consommee (proportionnel au poids)
  insRecipe.run(id('ri'), perrier, P.PERRIER_BASE, 1, 'u_unit');

  // Stock initial : matieres premieres a l'atelier de production, produits finis dans les restaurants
  const in90days = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const in20days = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

  stock.receiveStock({ tenantId, siteId: siteProd, productId: P.FARINE, quantity: 50, unitId: 'u_kg', lotNumber: 'FARINE-0001', expiryDate: in90days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteProd, productId: P.BEURRE, quantity: 20, unitId: 'u_kg', lotNumber: 'BEURRE-0001', expiryDate: in20days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteProd, productId: P.POULET, quantity: 15, unitId: 'u_kg', lotNumber: 'POULET-0001', expiryDate: in3days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteStore1, productId: P.SALADE, quantity: 4, unitId: 'u_kg', lotNumber: 'SALADE-0001', expiryDate: in3days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteStore1, productId: P.CHEVRE, quantity: 3, unitId: 'u_kg', lotNumber: 'CHEVRE-0001', expiryDate: in20days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteStore1, productId: P.TOMATE, quantity: 5, unitId: 'u_kg', lotNumber: 'TOMATE-0001', expiryDate: in3days, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteStore1, productId: P.PERRIER_BASE, quantity: 48, unitId: 'u_unit', lotNumber: 'PERRIER-0001', expiryDate: null, sourceType: 'SEED' });
  stock.receiveStock({ tenantId, siteId: siteStore1, productId: croissant, quantity: 30, unitId: 'u_unit', lotNumber: 'CROIS-0001', expiryDate: in3days, sourceType: 'PRODUCTION_OUTPUT' });
  stock.receiveStock({ tenantId, siteId: siteStore2, productId: P.SALADE, quantity: 2, unitId: 'u_kg', lotNumber: 'SALADE-0002', expiryDate: in3days, sourceType: 'SEED' });

  // Seuils d'alerte (rupture)
  const insThreshold = db.prepare('INSERT INTO stock_thresholds (id, site_id, product_id, min_quantity) VALUES (?, ?, ?, ?)');
  insThreshold.run(id('th'), siteStore1, P.SALADE, 3);
  insThreshold.run(id('th'), siteStore1, P.TOMATE, 3);
  insThreshold.run(id('th'), siteProd, P.POULET, 5);
  insThreshold.run(id('th'), siteStore2, P.SALADE, 3);

  // Config Popina de demonstration (cle/secret factices - a remplacer par les vraies valeurs)
  const popinaSiteId = id('popsite');
  db.prepare(`
    INSERT INTO popina_sites (id, tenant_id, site_id, popina_location_id, api_key, webhook_secret, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(popinaSiteId, tenantId, siteStore1, 'demo-location-bordeaux-centre', '', 'CHANGE_ME_SECRET_DEMO_ONLY');

  const insMap = db.prepare(`
    INSERT INTO popina_product_mapping (id, popina_site_id, popina_product_catalog_id, popina_product_name, product_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  insMap.run(id('map'), popinaSiteId, '81784041-7df2-4c41-b43f-13bd57be3f39', 'Salade chevre chaud', salade);
  insMap.run(id('map'), popinaSiteId, 'd59fce91-0f4e-466c-9b7f-6359207b4b14', 'Supreme de poulet', supreme);
  insMap.run(id('map'), popinaSiteId, 'fac7de3a-2ce6-4078-a6e6-fd7ca9f61911', 'Perrier', perrier);

  console.log('Donnees de demonstration inserees avec succes.');
  console.log(`Tenant: ${tenantId}`);
  console.log(`Site production: ${siteProd}`);
  console.log(`Site Bordeaux Centre (connecte a Popina demo): ${siteStore1}`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
