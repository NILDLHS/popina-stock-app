// Import en masse (CSV) des referentiels et du stock initial. Chaque fonction traite les lignes
// une par une et retourne un rapport {created, updated, errors: [{line, message}]} : une ligne en
// erreur n'empeche pas le traitement des suivantes.
const db = require('./db');
const { id } = require('./util');
const stockLib = require('./stock');

const SITE_TYPE_ALIASES = {
  magasin: 'STORE', restaurant: 'STORE', store: 'STORE',
  production: 'PRODUCTION', atelier: 'PRODUCTION',
  franchise: 'FRANCHISEE', franchisee: 'FRANCHISEE',
  client: 'CLIENT', client_externe: 'CLIENT',
  entrepot: 'WAREHOUSE', warehouse: 'WAREHOUSE',
};

const PRODUCT_TYPE_ALIASES = {
  matiere_premiere: 'RAW', matierepremiere: 'RAW', raw: 'RAW',
  semi_fini: 'SEMI', semifini: 'SEMI', semi: 'SEMI',
  produit_fini: 'FINISHED', produitfini: 'FINISHED', finished: 'FINISHED',
};

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function truthy(s) {
  const v = normalizeKey(s);
  return v === '1' || v === 'oui' || v === 'true' || v === 'yes';
}

function importSites(records, tenantId) {
  const report = { created: 0, updated: 0, errors: [] };
  const findByName = db.prepare('SELECT * FROM sites WHERE tenant_id = ? AND lower(name) = lower(?)');
  const insert = db.prepare('INSERT INTO sites (id, tenant_id, name, type, address) VALUES (?, ?, ?, ?, ?)');
  const update = db.prepare('UPDATE sites SET type = ?, address = ? WHERE id = ?');

  records.forEach((rec, i) => {
    const line = i + 2; // ligne 1 = en-tete
    const name = rec.nom || rec.name;
    if (!name) { report.errors.push({ line, message: 'Colonne "nom" manquante ou vide.' }); return; }
    const rawType = rec.type;
    const type = SITE_TYPE_ALIASES[normalizeKey(rawType)] || (['PRODUCTION', 'STORE', 'FRANCHISEE', 'CLIENT', 'WAREHOUSE'].includes(String(rawType).toUpperCase()) ? String(rawType).toUpperCase() : null);
    if (!type) { report.errors.push({ line, message: `Type "${rawType}" inconnu (attendu : magasin, production, franchise, client ou entrepot).` }); return; }
    const address = rec.adresse || rec.address || null;

    const existing = findByName.get(tenantId, name);
    if (existing) {
      update.run(type, address, existing.id);
      report.updated++;
    } else {
      insert.run(id('site'), tenantId, name, type, address);
      report.created++;
    }
  });
  return report;
}

function resolveUnitId(code) {
  if (!code) return null;
  const row = db.prepare('SELECT * FROM units WHERE lower(code) = lower(?)').get(code.trim());
  if (row) return row.id;
  const unitId = id('unit');
  db.prepare('INSERT INTO units (id, code, label) VALUES (?, ?, ?)').run(unitId, code.trim(), code.trim());
  return unitId;
}

function importProducts(records, tenantId) {
  const report = { created: 0, updated: 0, errors: [] };
  const findBySku = db.prepare('SELECT * FROM products WHERE tenant_id = ? AND upper(sku) = upper(?)');
  const insert = db.prepare('INSERT INTO products (id, tenant_id, sku, name, type, unit_id, category, is_sold_by_weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const update = db.prepare('UPDATE products SET name = ?, type = ?, unit_id = ?, category = ?, is_sold_by_weight = ? WHERE id = ?');

  records.forEach((rec, i) => {
    const line = i + 2;
    const sku = rec.sku;
    const name = rec.nom || rec.name;
    if (!sku || !name) { report.errors.push({ line, message: 'Colonnes "sku" et "nom" requises.' }); return; }
    const rawType = rec.type;
    const type = PRODUCT_TYPE_ALIASES[normalizeKey(rawType)] || (['RAW', 'SEMI', 'FINISHED'].includes(String(rawType).toUpperCase()) ? String(rawType).toUpperCase() : null);
    if (!type) { report.errors.push({ line, message: `Type "${rawType}" inconnu (attendu : matiere_premiere, semi_fini ou produit_fini).` }); return; }
    const unitCode = rec.unite || rec.unit;
    if (!unitCode) { report.errors.push({ line, message: 'Colonne "unite" manquante (ex: kg, L, unit, carton).' }); return; }
    const unitId = resolveUnitId(unitCode);
    const category = rec.categorie || rec.category || null;
    const soldByWeight = truthy(rec.vendu_au_poids || rec.is_sold_by_weight) ? 1 : 0;

    const existing = findBySku.get(tenantId, sku);
    if (existing) {
      update.run(name, type, unitId, category, soldByWeight, existing.id);
      report.updated++;
    } else {
      insert.run(id('prod'), tenantId, sku.toUpperCase(), name, type, unitId, category, soldByWeight);
      report.created++;
    }
  });
  return report;
}

function importStock(records, tenantId) {
  const report = { created: 0, updated: 0, errors: [] };
  const findSite = db.prepare('SELECT * FROM sites WHERE tenant_id = ? AND lower(name) = lower(?)');
  const findProduct = db.prepare('SELECT * FROM products WHERE tenant_id = ? AND upper(sku) = upper(?)');

  records.forEach((rec, i) => {
    const line = i + 2;
    const siteName = rec.site;
    const sku = rec.produit_sku || rec.sku;
    const qtyRaw = rec.quantite || rec.quantity;
    if (!siteName || !sku || !qtyRaw) { report.errors.push({ line, message: 'Colonnes "site", "produit_sku" et "quantite" requises.' }); return; }
    const quantity = parseFloat(String(qtyRaw).replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) { report.errors.push({ line, message: `Quantite invalide : "${qtyRaw}".` }); return; }

    const site = findSite.get(tenantId, siteName);
    if (!site) { report.errors.push({ line, message: `Site "${siteName}" introuvable (verifiez l'orthographe exacte).` }); return; }
    const product = findProduct.get(tenantId, sku);
    if (!product) { report.errors.push({ line, message: `Produit avec SKU "${sku}" introuvable.` }); return; }

    const expiryDate = (rec.dlc || rec.expiry_date || '').trim() || null;
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      report.errors.push({ line, message: `Date DLC invalide : "${expiryDate}" (format attendu AAAA-MM-JJ).` });
      return;
    }
    const lotNumber = (rec.lot || rec.lot_number || '').trim() || null;

    stockLib.receiveStock({
      tenantId, siteId: site.id, productId: product.id, quantity, unitId: product.unit_id,
      lotNumber, expiryDate, sourceType: 'CSV_IMPORT', sourceRef: `import-${Date.now()}-L${line}`,
    });
    report.created++;
  });
  return report;
}

module.exports = { importSites, importProducts, importStock };
