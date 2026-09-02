// Integration Popina : verification de signature webhook + logique de decrement de stock
// Reference : voir Annexe technique du prompt (docs.pragma-project.dev)
const crypto = require('node:crypto');
const db = require('./db');
const { id } = require('./util');
const stock = require('./stock');

function computeHmac(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = computeHmac(rawBody, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signatureHeader), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getPopinaSiteByLocationId(popinaLocationId) {
  return db.prepare('SELECT * FROM popina_sites WHERE popina_location_id = ? AND is_active = 1').get(popinaLocationId);
}

function getPopinaSite(id_) {
  return db.prepare('SELECT * FROM popina_sites WHERE id = ?').get(id_);
}

function logSync(popinaSiteId, eventType, webhookId, status, message) {
  db.prepare(`
    INSERT INTO popina_sync_log (id, popina_site_id, event_type, webhook_id, status, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id('psl'), popinaSiteId, eventType || null, webhookId || null, status, message || null);
}

function alreadyProcessed(webhookId) {
  if (!webhookId) return false;
  const row = db.prepare(`SELECT 1 FROM popina_sync_log WHERE webhook_id = ? AND status = 'OK'`).get(webhookId);
  return !!row;
}

function findMapping(popinaSiteId, popinaProductCatalogId) {
  return db.prepare(`
    SELECT * FROM popina_product_mapping WHERE popina_site_id = ? AND popina_product_catalog_id = ?
  `).get(popinaSiteId, popinaProductCatalogId);
}

// Traite un evenement order.paid : parcourt productRowList + menuRowList (produits imbriques dans les menus),
// applique les regles Popina (stockImpactIndicator, isCanceled, isLoss) puis decremente le stock.
function handleOrderPaid(popinaSite, order, webhookId) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(popinaSite.site_id);
  if (!site) throw new Error('Site interne introuvable pour ce mapping Popina');

  if (order.isCanceled) {
    logSync(popinaSite.id, 'order.paid', webhookId, 'IGNORED', `Commande ${order.id} annulee, aucun mouvement.`);
    return { processed: 0, ignored: 0, unmapped: 0 };
  }

  // Toutes les lignes produit : celles hors menu (productRowList) + celles a l'interieur des menus (menuRowList[].productRowList)
  const allRows = [
    ...(order.productRowList || []),
    ...((order.menuRowList || []).flatMap((menu) => menu.productRowList || [])),
  ];

  let processed = 0, ignored = 0, unmapped = 0;
  const notes = [];

  for (const row of allRows) {
    if (row.isCanceled) { ignored++; continue; }
    // stockImpactIndicator : en cas d'addition splittee, ne compter que la ligne "parent" (true).
    // Absence de l'attribut (ex. donnees de test) => on traite la ligne normalement.
    if (row.stockImpactIndicator === false) { ignored++; continue; }

    const mapping = findMapping(popinaSite.id, row.productCatalogId);
    if (!mapping || !mapping.product_id) {
      unmapped++;
      notes.push(`Produit Popina non mappe: "${row.name}" (${row.productCatalogId})`);
      continue;
    }

    const product = stock.getProduct(mapping.product_id);
    if (!product) { unmapped++; continue; }

    // Quantite consommee : quantite unitaire, ou proportionnelle au poids pour les produits vendus au poids.
    const qty = (row.weight !== null && row.weight !== undefined) ? row.weight : (row.quantity || 1);

    if (row.isLoss) {
      // Perte deja tracee cote caisse : on l'enregistre comme perte plutot que comme vente.
      stock.consumeSoldProduct({
        tenantId: site.tenant_id, siteId: site.id, productId: product.id,
        quantity: qty, unitId: product.unit_id,
        referenceType: 'popina_order', referenceId: order.id,
        note: `Perte cote caisse Popina: ${row.lossReason || 'motif non precise'}`,
        allowNegative: true,
      });
    } else {
      stock.consumeSoldProduct({
        tenantId: site.tenant_id, siteId: site.id, productId: product.id,
        quantity: qty, unitId: product.unit_id,
        referenceType: 'popina_order', referenceId: order.id,
        note: `Vente Popina - commande ${order.id}`,
        allowNegative: true,
      });
    }
    processed++;
  }

  const status = unmapped > 0 ? 'UNMAPPED' : 'OK';
  logSync(popinaSite.id, 'order.paid', webhookId, status,
    `Commande ${order.id}: ${processed} ligne(s) decrementee(s), ${ignored} ignoree(s), ${unmapped} non mappee(s).` +
    (notes.length ? ' ' + notes.join(' | ') : ''));

  return { processed, ignored, unmapped };
}

// Traite order.canceled : si la commande avait deja ete decrementee (order.paid recu avant),
// on annule exactement les mouvements de vente lies a cette commande en recreditant les memes
// quantites (type INVENTORY_ADJUST, aucun type dedie dans le schema pour une "reprise de vente").
// Idempotent via l'unicite du webhookId (deja verifiee en amont par alreadyProcessed).
function handleOrderCanceled(popinaSite, order, webhookId) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(popinaSite.site_id);
  if (!site) throw new Error('Site interne introuvable pour ce mapping Popina');

  const priorMovements = db.prepare(`
    SELECT * FROM stock_movements
    WHERE reference_type = 'popina_order' AND reference_id = ? AND site_id = ? AND type = 'SALE_CONSUME'
  `).all(order.id, site.id);

  if (priorMovements.length === 0) {
    logSync(popinaSite.id, 'order.canceled', webhookId, 'IGNORED',
      `Commande ${order.id} annulee mais jamais decrementee (order.paid non recu ou produit non mappe) : rien a annuler.`);
    return { reversed: 0 };
  }

  for (const m of priorMovements) {
    stock.recordMovement({
      tenantId: site.tenant_id, siteId: site.id, productId: m.product_id, lotId: null,
      type: 'INVENTORY_ADJUST', quantity: -m.quantity, unitId: m.unit_id,
      referenceType: 'popina_order_canceled', referenceId: order.id,
      note: `Annulation vente Popina - commande ${order.id} (mouvement d'origine ${m.id})`,
    });
  }

  logSync(popinaSite.id, 'order.canceled', webhookId, 'OK',
    `Commande ${order.id} annulee : ${priorMovements.length} mouvement(s) de vente annule(s), stock recredite.`);
  return { reversed: priorMovements.length };
}

module.exports = { computeHmac, verifySignature, getPopinaSiteByLocationId, getPopinaSite, logSync, alreadyProcessed, findMapping, handleOrderPaid, handleOrderCanceled };
