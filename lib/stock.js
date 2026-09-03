// Coeur du moteur de stock : lots, consommation FIFO (par DLC la plus proche), mouvements.
const db = require('./db');
const { id } = require('./util');

class InsufficientStockError extends Error {
  constructor(productId, missing) {
    super(`Stock insuffisant pour le produit ${productId} (manque ${missing})`);
    this.code = 'INSUFFICIENT_STOCK';
    this.productId = productId;
    this.missing = missing;
  }
}

function getProduct(productId) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
}

// Le solde de stock "officiel" est calcule a partir du grand livre des mouvements (stock_movements),
// pas seulement de la somme des lots : chaque mouvement d'entree/sortie y est trace 1 pour 1 avec les lots,
// SAUF le cas d'un depassement de stock autorise (allowNegative), qui ne cree pas de lot negatif mais reste
// trace comme mouvement. Utiliser les mouvements comme source de verite garantit que le stock affiche reste
// coherent meme apres un depassement (ex: vente Popina superieure au stock reellement connu).
function getStockBySite(siteId) {
  return db.prepare(`
    SELECT p.id as product_id, p.sku, p.name, p.type, u.code as unit_code,
           COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.site_id = ?), 0) as quantity,
           COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.site_id = ? AND m.occurred_at < date('now')), 0) as quantity_yesterday,
           MIN(CASE WHEN l.quantity > 0 THEN l.expiry_date END) as next_expiry
    FROM products p
    JOIN units u ON u.id = p.unit_id
    LEFT JOIN stock_lots l ON l.product_id = p.id AND l.site_id = ?
    WHERE p.tenant_id = (SELECT tenant_id FROM sites WHERE id = ?)
    GROUP BY p.id
    ORDER BY p.name
  `).all(siteId, siteId, siteId, siteId);
}

// Vue consolidee : stock de chaque produit actif, pour chaque site actif, en une seule fois
// (pour voir l'ensemble des etablissements d'un coup d'oeil plutot que site par site).
function getStockMatrix(tenantId) {
  const sites = db.prepare('SELECT * FROM sites WHERE tenant_id = ? AND is_active = 1 ORDER BY type, name').all(tenantId);
  const products = db.prepare(`
    SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id = p.unit_id
    WHERE p.tenant_id = ? AND p.is_active = 1 ORDER BY p.name
  `).all(tenantId);
  const movementSums = db.prepare(`
    SELECT site_id, product_id, SUM(quantity) as qty FROM stock_movements WHERE tenant_id = ? GROUP BY site_id, product_id
  `).all(tenantId);
  const qtyMap = {};
  for (const row of movementSums) {
    (qtyMap[row.product_id] ??= {})[row.site_id] = row.qty;
  }
  return { sites, products, qtyMap };
}

function getProductStockAtSite(siteId, productId) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) as qty FROM stock_movements WHERE site_id = ? AND product_id = ?`).get(siteId, productId);
  return row.qty;
}

function listLots(siteId, productId) {
  return db.prepare(`SELECT * FROM stock_lots WHERE site_id = ? AND product_id = ? AND quantity > 0.0001 ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at ASC`).all(siteId, productId);
}

function recordMovement({ tenantId, siteId, productId, lotId, type, quantity, unitId, referenceType, referenceId, relatedSiteId, note }) {
  db.prepare(`
    INSERT INTO stock_movements (id, tenant_id, site_id, product_id, lot_id, type, quantity, unit_id, reference_type, reference_id, related_site_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id('mov'), tenantId, siteId, productId, lotId || null, type, quantity, unitId, referenceType || null, referenceId || null, relatedSiteId || null, note || null);
}

// Entree de stock : cree un nouveau lot + mouvement positif
function receiveStock({ tenantId, siteId, productId, quantity, unitId, lotNumber, expiryDate, sourceType, sourceRef, movementType }) {
  const lotId = id('lot');
  db.prepare(`
    INSERT INTO stock_lots (id, tenant_id, site_id, product_id, lot_number, quantity, unit_id, expiry_date, source_type, source_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lotId, tenantId, siteId, productId, lotNumber || lotId.slice(-8).toUpperCase(), quantity, unitId, expiryDate || null, sourceType, sourceRef || null);
  recordMovement({
    tenantId, siteId, productId, lotId, type: movementType || 'RECEPTION',
    quantity, unitId, referenceType: sourceType, referenceId: sourceRef,
  });
  return lotId;
}

// Sortie de stock en FIFO (DLC la plus proche en premier). Retourne les tranches consommees (lot, qty, expiry)
// pour permettre la tracabilite (ex: recreer des lots a destination lors d'un transfert).
function consumeStockFIFO({ tenantId, siteId, productId, quantity, unitId, type, referenceType, referenceId, relatedSiteId, note, allowNegative }) {
  const lots = listLots(siteId, productId);

  // Verification atomique AVANT toute mutation : si le stock est insuffisant et que le negatif
  // n'est pas autorise, on leve l'erreur sans avoir touche a la moindre ligne (evite un etat incoherent).
  if (!allowNegative) {
    const available = lots.reduce((sum, l) => sum + l.quantity, 0);
    if (available + 0.0000001 < quantity) {
      throw new InsufficientStockError(productId, quantity - available);
    }
  }

  let remaining = quantity;
  const consumed = [];

  for (const lot of lots) {
    if (remaining <= 0.0000001) break;
    const take = Math.min(lot.quantity, remaining);
    db.prepare('UPDATE stock_lots SET quantity = quantity - ? WHERE id = ?').run(take, lot.id);
    recordMovement({
      tenantId, siteId, productId, lotId: lot.id, type, quantity: -take, unitId,
      referenceType, referenceId, relatedSiteId, note,
    });
    consumed.push({ lotId: lot.id, lotNumber: lot.lot_number, expiryDate: lot.expiry_date, quantity: take });
    remaining -= take;
  }

  if (remaining > 0.0000001) {
    // A ce stade allowNegative est forcement true (sinon on aurait leve l'erreur avant toute mutation, voir plus haut).
    // Trace la partie en rupture comme mouvement sans lot (stock negatif tolere, signale a l'UI)
    recordMovement({
      tenantId, siteId, productId, lotId: null, type, quantity: -remaining, unitId,
      referenceType, referenceId, relatedSiteId, note: (note ? note + ' ' : '') + '[ATTENTION: stock passe en negatif]',
    });
    consumed.push({ lotId: null, lotNumber: null, expiryDate: null, quantity: remaining, negative: true });
  }

  return consumed;
}

function getRecipe(productId) {
  return db.prepare(`
    SELECT ri.*, p.name as ingredient_name, p.sku as ingredient_sku, u.code as unit_code
    FROM recipe_items ri
    JOIN products p ON p.id = ri.ingredient_product_id
    JOIN units u ON u.id = ri.unit_id
    WHERE ri.product_id = ?
  `).all(productId);
}

function hasRecipe(productId) {
  const row = db.prepare('SELECT COUNT(*) as n FROM recipe_items WHERE product_id = ?').get(productId);
  return row.n > 0;
}

// Consomme un produit "vendu" : si une nomenclature existe, consomme les ingredients (proportionnellement),
// sinon consomme directement le produit lui-meme (cas d'un article de revente sans transformation).
function consumeSoldProduct({ tenantId, siteId, productId, quantity, unitId, referenceType, referenceId, note, allowNegative }) {
  const recipe = getRecipe(productId);
  if (recipe.length > 0) {
    for (const item of recipe) {
      consumeStockFIFO({
        tenantId, siteId, productId: item.ingredient_product_id,
        quantity: item.quantity * quantity, unitId: item.unit_id,
        type: 'SALE_CONSUME', referenceType, referenceId,
        note: `${note || ''} (via recette de ${productId})`.trim(),
        allowNegative,
      });
    }
  } else {
    consumeStockFIFO({
      tenantId, siteId, productId, quantity, unitId,
      type: 'SALE_CONSUME', referenceType, referenceId, note, allowNegative,
    });
  }
}

// Recense les references a un site dans le reste du modele de donnees, pour savoir s'il peut
// etre supprime definitivement (sinon seule la desactivation, reversible, est possible).
function getSiteUsage(siteId) {
  const counts = {
    'Mouvements de stock': db.prepare('SELECT COUNT(*) as n FROM stock_movements WHERE site_id = ? OR related_site_id = ?').get(siteId, siteId).n,
    'Lots de stock': db.prepare('SELECT COUNT(*) as n FROM stock_lots WHERE site_id = ?').get(siteId).n,
    'Commandes fournisseurs': db.prepare('SELECT COUNT(*) as n FROM purchase_orders WHERE site_id = ?').get(siteId).n,
    'Ordres de fabrication': db.prepare('SELECT COUNT(*) as n FROM production_orders WHERE site_id = ?').get(siteId).n,
    'Transferts': db.prepare('SELECT COUNT(*) as n FROM transfers WHERE from_site_id = ? OR to_site_id = ?').get(siteId, siteId).n,
    'Connexion Popina': db.prepare('SELECT COUNT(*) as n FROM popina_sites WHERE site_id = ?').get(siteId).n,
    'Fournisseur interne': db.prepare('SELECT COUNT(*) as n FROM suppliers WHERE internal_site_id = ?').get(siteId).n,
    'Seuils de reappro': db.prepare('SELECT COUNT(*) as n FROM stock_thresholds WHERE site_id = ?').get(siteId).n,
  };
  const details = Object.entries(counts).filter(([, n]) => n > 0);
  return { total: details.reduce((sum, [, n]) => sum + n, 0), details };
}

// Idem pour un produit : recettes, mouvements, lignes de commande/transfert, mapping Popina...
function getProductUsage(productId) {
  const counts = {
    'Mouvements de stock': db.prepare('SELECT COUNT(*) as n FROM stock_movements WHERE product_id = ?').get(productId).n,
    'Lots de stock': db.prepare('SELECT COUNT(*) as n FROM stock_lots WHERE product_id = ?').get(productId).n,
    'Recettes (produit ou ingredient)': db.prepare('SELECT COUNT(*) as n FROM recipe_items WHERE product_id = ? OR ingredient_product_id = ?').get(productId, productId).n,
    'Lignes de commande fournisseur': db.prepare('SELECT COUNT(*) as n FROM purchase_order_lines WHERE product_id = ?').get(productId).n,
    'Ordres de fabrication': db.prepare('SELECT COUNT(*) as n FROM production_orders WHERE product_id = ?').get(productId).n,
    'Lignes de transfert': db.prepare('SELECT COUNT(*) as n FROM transfer_lines WHERE product_id = ?').get(productId).n,
    'Mapping Popina': db.prepare('SELECT COUNT(*) as n FROM popina_product_mapping WHERE product_id = ?').get(productId).n,
    'Seuils de reappro': db.prepare('SELECT COUNT(*) as n FROM stock_thresholds WHERE product_id = ?').get(productId).n,
  };
  const details = Object.entries(counts).filter(([, n]) => n > 0);
  return { total: details.reduce((sum, [, n]) => sum + n, 0), details };
}

module.exports = {
  InsufficientStockError,
  getProduct,
  getStockBySite,
  getProductStockAtSite,
  listLots,
  recordMovement,
  receiveStock,
  consumeStockFIFO,
  getRecipe,
  hasRecipe,
  consumeSoldProduct,
  getSiteUsage,
  getProductUsage,
  getStockMatrix,
};
