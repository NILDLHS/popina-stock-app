// Tests du moteur de stock : consommation FIFO (DLC la plus proche en premier), recette (BOM), garde-fous.
// Utilise une base SQLite temporaire dediee (APP_DB_PATH) pour ne jamais toucher les donnees de demo.
process.env.APP_DB_PATH = require('node:path').join(__dirname, 'tmp-test.db');
const fs = require('node:fs');
[process.env.APP_DB_PATH, process.env.APP_DB_PATH + '-shm', process.env.APP_DB_PATH + '-wal'].forEach((p) => {
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

const { test, after } = require('node:test');
const assert = require('node:assert');
const db = require('../lib/db');
const { id } = require('../lib/util');
const stock = require('../lib/stock');

const tenantId = id('tenant');
db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, 'Test');
db.prepare(`INSERT INTO units (id, code, label) VALUES ('u_kg','kg','Kilogramme'), ('u_unit','unit','Unite')`).run();
const site = id('site');
db.prepare('INSERT INTO sites (id, tenant_id, name, type) VALUES (?, ?, ?, ?)').run(site, tenantId, 'Site test', 'STORE');
const rawId = id('prod');
db.prepare(`INSERT INTO products (id, tenant_id, sku, name, type, unit_id) VALUES (?, ?, 'RAW1','Matiere 1','RAW','u_kg')`).run(rawId, tenantId);
const finishedId = id('prod');
db.prepare(`INSERT INTO products (id, tenant_id, sku, name, type, unit_id) VALUES (?, ?, 'FIN1','Fini 1','FINISHED','u_unit')`).run(finishedId, tenantId);
const resaleId = id('prod');
db.prepare(`INSERT INTO products (id, tenant_id, sku, name, type, unit_id) VALUES (?, ?, 'RESALE1','Revente 1','FINISHED','u_unit')`).run(resaleId, tenantId);
db.prepare('INSERT INTO recipe_items (id, product_id, ingredient_product_id, quantity, unit_id) VALUES (?, ?, ?, ?, ?)')
  .run(id('ri'), finishedId, rawId, 2, 'u_kg');

after(() => {
  [process.env.APP_DB_PATH, process.env.APP_DB_PATH + '-shm', process.env.APP_DB_PATH + '-wal'].forEach((p) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

test('consumeStockFIFO consomme le lot dont la DLC est la plus proche en premier', () => {
  stock.receiveStock({ tenantId, siteId: site, productId: rawId, quantity: 10, unitId: 'u_kg', lotNumber: 'LOT-LOIN', expiryDate: '2030-01-01', sourceType: 'test' });
  stock.receiveStock({ tenantId, siteId: site, productId: rawId, quantity: 5, unitId: 'u_kg', lotNumber: 'LOT-PROCHE', expiryDate: '2026-01-01', sourceType: 'test' });

  const consumed = stock.consumeStockFIFO({ tenantId, siteId: site, productId: rawId, quantity: 6, unitId: 'u_kg', type: 'LOSS' });

  assert.strictEqual(consumed.length, 2, 'doit puiser dans 2 lots');
  assert.strictEqual(consumed[0].lotNumber, 'LOT-PROCHE', 'le lot avec la DLC la plus proche doit etre consomme en premier');
  assert.strictEqual(consumed[0].quantity, 5);
  assert.strictEqual(consumed[1].lotNumber, 'LOT-LOIN');
  assert.strictEqual(consumed[1].quantity, 1);
});

test('consumeStockFIFO leve InsufficientStockError si le stock est insuffisant et allowNegative=false', () => {
  assert.throws(() => {
    stock.consumeStockFIFO({ tenantId, siteId: site, productId: rawId, quantity: 999, unitId: 'u_kg', type: 'LOSS' });
  }, (err) => err.code === 'INSUFFICIENT_STOCK');
});

test('consumeStockFIFO avec allowNegative=true autorise un stock negatif et le trace', () => {
  const before = stock.getProductStockAtSite(site, rawId);
  const consumed = stock.consumeStockFIFO({ tenantId, siteId: site, productId: rawId, quantity: before + 3, unitId: 'u_kg', type: 'SALE_CONSUME', allowNegative: true });
  const after = stock.getProductStockAtSite(site, rawId);
  assert.ok(after < 0, 'le stock doit pouvoir passer en negatif quand explicitement autorise');
  assert.ok(consumed.some((c) => c.negative), 'la tranche en rupture doit etre signalee');
});

test('consumeSoldProduct consomme les ingredients de la recette proportionnellement a la quantite vendue', () => {
  stock.receiveStock({ tenantId, siteId: site, productId: rawId, quantity: 100, unitId: 'u_kg', lotNumber: 'RESET', sourceType: 'test' });
  const before = stock.getProductStockAtSite(site, rawId);
  stock.consumeSoldProduct({ tenantId, siteId: site, productId: finishedId, quantity: 3, unitId: 'u_unit', referenceType: 'test' });
  const after = stock.getProductStockAtSite(site, rawId);
  assert.strictEqual(before - after, 6, '3 unites vendues x 2kg/unite de recette = 6kg consommes');
});

test('consumeSoldProduct sans recette consomme directement le produit lui-meme (article de revente)', () => {
  stock.receiveStock({ tenantId, siteId: site, productId: resaleId, quantity: 20, unitId: 'u_unit', lotNumber: 'RS1', sourceType: 'test' });
  stock.consumeSoldProduct({ tenantId, siteId: site, productId: resaleId, quantity: 4, unitId: 'u_unit', referenceType: 'test' });
  assert.strictEqual(stock.getProductStockAtSite(site, resaleId), 16);
});
