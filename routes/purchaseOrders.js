const db = require('../lib/db');
const { layout, statusBadge } = require('../lib/render');
const { esc, id, parseForm, fmtQty, fmtDate } = require('../lib/util');
const stockLib = require('../lib/stock');

function getTenantId() {
  return db.prepare('SELECT id FROM tenants LIMIT 1').get()?.id;
}

function register(router) {
  router.get('/purchase-orders', (req, res, ctx) => {
    const pos = db.prepare(`
      SELECT po.*, sup.name as supplier_name, s.name as site_name
      FROM purchase_orders po
      JOIN suppliers sup ON sup.id = po.supplier_id
      JOIN sites s ON s.id = po.site_id
      ORDER BY po.created_at DESC
    `).all();
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1 ORDER BY name').all();
    const products = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 ORDER BY p.name').all();

    const body = `
      <div class="page-header">
        <div><h1>Commandes fournisseurs</h1><p class="subtitle">Approvisionnement externe et interne (un site de production = un fournisseur pour les autres sites)</p></div>
      </div>
      <div class="panel">
        <h2>Commandes (${pos.length})</h2>
        ${pos.length === 0 ? '<p class="empty">Aucune commande.</p>' : `
        <table class="compact">
          <thead><tr><th>Date</th><th>Fournisseur</th><th>Site destinataire</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${pos.map((po) => `
              <tr>
                <td class="muted">${fmtDate(po.created_at)}</td>
                <td>${esc(po.supplier_name)}</td>
                <td>${esc(po.site_name)}</td>
                <td>${statusBadge(po.status)}</td>
                <td><a href="/purchase-orders/${po.id}">Ouvrir &rarr;</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
      <div class="panel">
        <h2>Nouvelle commande</h2>
        <form method="POST" action="/purchase-orders">
          <div class="form-row">
            <div class="field"><label>Fournisseur</label><select name="supplier_id" required>${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Site destinataire</label><select name="site_id" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>Produit</label><select name="product_id" required>${products.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit_code)})</option>`).join('')}</select></div>
          <div class="field"><label>Quantite commandee</label><input name="quantity" type="number" step="0.0001" required /></div>
          <div class="field"><label>Prix unitaire (optionnel, en euros)</label><input name="unit_price" type="number" step="0.01" /></div>
          <p class="hint muted">Pour ajouter plusieurs lignes a la meme commande, cree-la puis reviens l'ouvrir pour ajouter des lignes.</p>
          <button class="btn" type="submit">Creer la commande</button>
        </form>
      </div>
    `;
    res.end(layout({ title: 'Commandes fournisseurs', activePath: '/purchase-orders', body, flash: ctx.flash }));
  });

  router.post('/purchase-orders', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const poId = id('po');
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);
    db.prepare('INSERT INTO purchase_orders (id, tenant_id, supplier_id, site_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(poId, tenantId, form.supplier_id, form.site_id, 'SENT');
    db.prepare('INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity_ordered, unit_id, unit_price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id('pol'), poId, form.product_id, parseFloat(form.quantity), product.unit_id, form.unit_price ? parseFloat(form.unit_price) * 100 : null);
    res.redirect(`/purchase-orders/${poId}`, { type: 'ok', message: 'Commande fournisseur creee et envoyee.' });
  });

  router.get('/purchase-orders/:id', (req, res, ctx) => {
    const po = db.prepare(`
      SELECT po.*, sup.name as supplier_name, s.name as site_name FROM purchase_orders po
      JOIN suppliers sup ON sup.id = po.supplier_id JOIN sites s ON s.id = po.site_id WHERE po.id = ?
    `).get(ctx.params.id);
    if (!po) { res.statusCode = 404; return res.end('Introuvable'); }
    const lines = db.prepare(`
      SELECT pol.*, p.name as product_name, u.code as unit_code FROM purchase_order_lines pol
      JOIN products p ON p.id = pol.product_id JOIN units u ON u.id = pol.unit_id WHERE pol.purchase_order_id = ?
    `).all(po.id);

    const body = `
      <div class="page-header">
        <div><h1>Commande ${esc(po.supplier_name)} &rarr; ${esc(po.site_name)}</h1><p class="subtitle">${statusBadge(po.status)} &middot; creee le ${fmtDate(po.created_at)}</p></div>
        <a href="/purchase-orders" class="btn btn-secondary">&larr; Retour</a>
      </div>
      <div class="panel">
        <h2>Lignes de commande</h2>
        <table class="compact">
          <thead><tr><th>Produit</th><th>Commande</th><th>Recu</th><th>Restant</th><th></th></tr></thead>
          <tbody>
            ${lines.map((l) => {
              const remaining = l.quantity_ordered - l.quantity_received;
              return `
              <tr>
                <td>${esc(l.product_name)}</td>
                <td class="mono">${fmtQty(l.quantity_ordered)} ${l.unit_code}</td>
                <td class="mono">${fmtQty(l.quantity_received)} ${l.unit_code}</td>
                <td class="mono" style="${remaining > 0 ? 'color:var(--warn)' : ''}">${fmtQty(remaining)} ${l.unit_code}</td>
                <td>
                  ${remaining > 0.0001 && po.status !== 'CANCELED' ? `
                  <form method="POST" action="/purchase-orders/${po.id}/receive-line" class="inline">
                    <input type="hidden" name="line_id" value="${l.id}" />
                    <input type="hidden" name="max" value="${remaining}" />
                    <input name="quantity" type="number" step="0.0001" placeholder="qte recue" style="width:100px;display:inline-block" required />
                    <input name="lot_number" placeholder="n de lot" style="width:110px;display:inline-block" />
                    <input name="expiry_date" type="date" style="width:140px;display:inline-block" />
                    <button class="btn btn-sm" type="submit">Receptionner</button>
                  </form>` : '<span class="badge badge-green">Complet</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    res.end(layout({ title: 'Commande fournisseur', activePath: '/purchase-orders', body, flash: ctx.flash }));
  });

  router.post('/purchase-orders/:id/receive-line', async (req, res, ctx) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const line = db.prepare('SELECT * FROM purchase_order_lines WHERE id = ?').get(form.line_id);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(ctx.params.id);
    const qty = Math.min(parseFloat(form.quantity), parseFloat(form.max));

    stockLib.receiveStock({
      tenantId, siteId: po.site_id, productId: line.product_id, quantity: qty, unitId: line.unit_id,
      lotNumber: form.lot_number || undefined, expiryDate: form.expiry_date || null,
      sourceType: 'purchase_order', sourceRef: po.id,
    });
    db.prepare('UPDATE purchase_order_lines SET quantity_received = quantity_received + ? WHERE id = ?').run(qty, line.id);

    const allLines = db.prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ?').all(po.id);
    const allReceived = allLines.every((l) => l.quantity_received >= l.quantity_ordered - 0.0001);
    const someReceived = allLines.some((l) => l.quantity_received > 0.0001);
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL' : po.status, po.id);

    res.redirect(`/purchase-orders/${po.id}`, { type: 'ok', message: `${qty} unite(s) receptionnee(s), stock mis a jour.` });
  });
}

module.exports = { register };
