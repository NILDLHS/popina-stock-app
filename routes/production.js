const db = require('../lib/db');
const { layout, statusBadge } = require('../lib/render');
const { esc, id, parseForm, fmtQty, fmtDate } = require('../lib/util');
const stockLib = require('../lib/stock');

function getTenantId() {
  return db.prepare('SELECT id FROM tenants LIMIT 1').get()?.id;
}

function register(router) {
  router.get('/production', (req, res, ctx) => {
    const orders = db.prepare(`
      SELECT po.*, s.name as site_name, p.name as product_name, u.code as unit_code
      FROM production_orders po JOIN sites s ON s.id = po.site_id JOIN products p ON p.id = po.product_id JOIN units u ON u.id = p.unit_id
      ORDER BY po.created_at DESC
    `).all();
    const prodSites = db.prepare(`SELECT * FROM sites WHERE type = 'PRODUCTION' AND is_active = 1 ORDER BY name`).all();
    const finishedProducts = db.prepare(`SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.type IN ('FINISHED','SEMI') AND p.is_active = 1 ORDER BY p.name`).all();

    const body = `
      <div class="page-header">
        <div><h1>Production interne</h1><p class="subtitle">Ordres de fabrication : consommation automatique des matieres premieres selon la recette, sortie de produit fini trace par lot</p></div>
      </div>
      <div class="panel">
        <h2>Ordres de fabrication (${orders.length})</h2>
        ${orders.length === 0 ? '<p class="empty">Aucun ordre de fabrication.</p>' : `
        <table class="compact">
          <thead><tr><th>Date</th><th>Site</th><th>Produit</th><th>Quantite</th><th>Lot produit</th><th>Statut</th></tr></thead>
          <tbody>
            ${orders.map((o) => `
              <tr>
                <td class="muted">${fmtDate(o.created_at)}</td>
                <td>${esc(o.site_name)}</td>
                <td>${esc(o.product_name)}</td>
                <td class="mono">${fmtQty(o.quantity)} ${o.unit_code}</td>
                <td class="mono">${esc(o.lot_number || '-')}</td>
                <td>${statusBadge(o.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
      <div class="panel">
        <h2>Nouvel ordre de fabrication</h2>
        <form method="POST" action="/production">
          <div class="form-row">
            <div class="field"><label>Site de production</label><select name="site_id" required>${prodSites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Produit a fabriquer</label><select name="product_id" required>${finishedProducts.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit_code)})</option>`).join('')}</select></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Quantite a produire</label><input name="quantity" type="number" step="0.0001" required /></div>
            <div class="field"><label>DLC du lot produit</label><input name="expiry_date" type="date" /></div>
          </div>
          <p class="hint muted">Les matieres premieres necessaires seront automatiquement decrementees selon la recette du produit (voir page produit). L'operation echoue si le stock est insuffisant.</p>
          <button class="btn" type="submit">Lancer la fabrication</button>
        </form>
      </div>
    `;
    res.end(layout({ title: 'Production', activePath: '/production', body, flash: ctx.flash }));
  });

  router.post('/production', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);
    const quantity = parseFloat(form.quantity);
    const orderId = id('prodorder');
    const lotNumber = 'PROD-' + Date.now();

    db.prepare('INSERT INTO production_orders (id, tenant_id, site_id, product_id, quantity, status, lot_number, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(orderId, tenantId, form.site_id, form.product_id, quantity, 'DRAFT', lotNumber, form.expiry_date || null);

    try {
      const recipe = stockLib.getRecipe(product.id);
      for (const item of recipe) {
        stockLib.consumeStockFIFO({
          tenantId, siteId: form.site_id, productId: item.ingredient_product_id,
          quantity: item.quantity * quantity, unitId: item.unit_id,
          type: 'PRODUCTION_CONSUME', referenceType: 'production_order', referenceId: orderId,
        });
      }
      stockLib.receiveStock({
        tenantId, siteId: form.site_id, productId: product.id, quantity, unitId: product.unit_id,
        lotNumber, expiryDate: form.expiry_date || null, sourceType: 'production_order', sourceRef: orderId,
        movementType: 'PRODUCTION_OUTPUT',
      });
      db.prepare(`UPDATE production_orders SET status = 'DONE', completed_at = datetime('now') WHERE id = ?`).run(orderId);
      res.redirect('/production', { type: 'ok', message: `Fabrication de ${quantity} ${product.name} terminee (lot ${lotNumber}).` });
    } catch (err) {
      db.prepare(`UPDATE production_orders SET status = 'CANCELED' WHERE id = ?`).run(orderId);
      if (err.code === 'INSUFFICIENT_STOCK') {
        res.redirect('/production', { type: 'danger', message: `Fabrication annulee : stock insuffisant pour un ingredient (${err.message}).` });
      } else {
        res.redirect('/production', { type: 'danger', message: `Erreur lors de la fabrication : ${err.message}` });
      }
    }
  });
}

module.exports = { register };
