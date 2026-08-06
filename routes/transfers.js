const db = require('../lib/db');
const { getTenantId } = require('../lib/tenant');
const { layout, statusBadge, siteTypeBadge } = require('../lib/render');
const { esc, id, parseForm, fmtQty, fmtDate } = require('../lib/util');
const stockLib = require('../lib/stock');

function register(router) {
  router.get('/transfers', (req, res, ctx) => {
    const transfers = db.prepare(`
      SELECT t.*, sf.name as from_name, st.name as to_name, st.type as to_type
      FROM transfers t JOIN sites sf ON sf.id = t.from_site_id JOIN sites st ON st.id = t.to_site_id
      ORDER BY t.created_at DESC
    `).all();
    const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1 ORDER BY type, name').all();

    const body = `
      <div class="page-header">
        <div><h1>Transferts inter-sites</h1><p class="subtitle">Production &rarr; magasins, ou tout site &rarr; franchise / client externe, avec validation a reception</p></div>
      </div>
      <div class="panel">
        <h2>Transferts (${transfers.length})</h2>
        ${transfers.length === 0 ? '<p class="empty">Aucun transfert.</p>' : `
        <table class="compact">
          <thead><tr><th>Date</th><th>De</th><th>Vers</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${transfers.map((t) => `
              <tr>
                <td class="muted">${fmtDate(t.created_at)}</td>
                <td>${esc(t.from_name)}</td>
                <td>${esc(t.to_name)} ${siteTypeBadge(t.to_type)}</td>
                <td>${statusBadge(t.status)}</td>
                <td><a href="/transfers/${t.id}">Ouvrir &rarr;</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
      <div class="panel">
        <h2>Nouveau transfert</h2>
        <form method="POST" action="/transfers">
          <div class="form-row">
            <div class="field"><label>Site emetteur</label><select name="from_site_id" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Site destinataire (magasin, franchise, client)</label><select name="to_site_id" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.type})</option>`).join('')}</select></div>
          </div>
          <button class="btn" type="submit">Creer le transfert (brouillon)</button>
        </form>
      </div>
    `;
    res.end(layout({ title: 'Transferts', activePath: '/transfers', body, flash: ctx.flash }));
  });

  router.post('/transfers', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const transferId = id('transfer');
    db.prepare('INSERT INTO transfers (id, tenant_id, from_site_id, to_site_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(transferId, tenantId, form.from_site_id, form.to_site_id, 'DRAFT');
    res.redirect(`/transfers/${transferId}`, { type: 'ok', message: 'Transfert cree en brouillon. Ajoute des lignes puis envoie-le.' });
  });

  router.get('/transfers/:id', (req, res, ctx) => {
    const t = db.prepare(`
      SELECT t.*, sf.name as from_name, st.name as to_name FROM transfers t
      JOIN sites sf ON sf.id = t.from_site_id JOIN sites st ON st.id = t.to_site_id WHERE t.id = ?
    `).get(ctx.params.id);
    if (!t) { res.statusCode = 404; return res.end('Introuvable'); }
    const lines = db.prepare(`
      SELECT tl.*, p.name as product_name, u.code as unit_code FROM transfer_lines tl
      JOIN products p ON p.id = tl.product_id JOIN units u ON u.id = tl.unit_id WHERE tl.transfer_id = ?
    `).all(t.id);
    const products = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 ORDER BY p.name').all();
    const availableQty = {};
    for (const p of products) availableQty[p.id] = stockLib.getProductStockAtSite(t.from_site_id, p.id);

    const body = `
      <div class="page-header">
        <div><h1>Transfert ${esc(t.from_name)} &rarr; ${esc(t.to_name)}</h1><p class="subtitle">${statusBadge(t.status)} &middot; cree le ${fmtDate(t.created_at)}</p></div>
        <a href="/transfers" class="btn btn-secondary">&larr; Retour</a>
      </div>
      <div class="panel">
        <h2>Lignes</h2>
        ${lines.length === 0 ? '<p class="empty">Aucune ligne pour l\'instant.</p>' : `
        <table class="compact">
          <thead><tr><th>Produit</th><th>Quantite</th><th>Prix de cession (optionnel)</th></tr></thead>
          <tbody>
            ${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td class="mono">${fmtQty(l.quantity)} ${l.unit_code}</td><td class="mono muted">${l.unit_price ? (l.unit_price / 100).toFixed(2) + ' EUR' : '-'}</td></tr>`).join('')}
          </tbody>
        </table>`}

        ${t.status === 'DRAFT' ? `
        <hr class="sep" />
        <h3>Ajouter une ligne</h3>
        <form method="POST" action="/transfers/${t.id}/lines">
          <div class="form-row">
            <div class="field"><label>Produit</label><select name="product_id" required>${products.map((p) => `<option value="${p.id}">${esc(p.name)} (dispo: ${fmtQty(availableQty[p.id])} ${p.unit_code})</option>`).join('')}</select></div>
            <div class="field"><label>Quantite</label><input name="quantity" type="number" step="0.0001" required /></div>
            <div class="field"><label>Prix de cession /unite (EUR, optionnel)</label><input name="unit_price" type="number" step="0.01" /></div>
          </div>
          <button class="btn btn-secondary" type="submit">Ajouter la ligne</button>
        </form>
        <hr class="sep" />
        <form method="POST" action="/transfers/${t.id}/send">
          <button class="btn" type="submit" ${lines.length === 0 ? 'disabled' : ''}>Envoyer le transfert (decremente le stock emetteur)</button>
        </form>
        ` : ''}

        ${t.status === 'SENT' ? `
        <hr class="sep" />
        <form method="POST" action="/transfers/${t.id}/receive">
          <button class="btn" type="submit">Confirmer la reception (incremente le stock destinataire)</button>
        </form>` : ''}
      </div>
    `;
    res.end(layout({ title: 'Transfert', activePath: '/transfers', body, flash: ctx.flash }));
  });

  router.post('/transfers/:id/lines', async (req, res, ctx) => {
    const form = await parseForm(req);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);
    db.prepare('INSERT INTO transfer_lines (id, transfer_id, product_id, quantity, unit_id, unit_price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id('tl'), ctx.params.id, form.product_id, parseFloat(form.quantity), product.unit_id, form.unit_price ? parseFloat(form.unit_price) * 100 : null);
    res.redirect(`/transfers/${ctx.params.id}`, { type: 'ok', message: 'Ligne ajoutee.' });
  });

  router.post('/transfers/:id/send', async (req, res, ctx) => {
    const tenantId = getTenantId();
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(ctx.params.id);
    const lines = db.prepare('SELECT * FROM transfer_lines WHERE transfer_id = ?').all(t.id);
    try {
      for (const l of lines) {
        stockLib.consumeStockFIFO({
          tenantId, siteId: t.from_site_id, productId: l.product_id, quantity: l.quantity, unitId: l.unit_id,
          type: 'TRANSFER_OUT', referenceType: 'transfer', referenceId: t.id, relatedSiteId: t.to_site_id,
        });
      }
      db.prepare(`UPDATE transfers SET status = 'SENT', sent_at = datetime('now') WHERE id = ?`).run(t.id);
      res.redirect(`/transfers/${t.id}`, { type: 'ok', message: 'Transfert envoye, stock emetteur decremente.' });
    } catch (err) {
      res.redirect(`/transfers/${t.id}`, { type: 'danger', message: `Envoi impossible : ${err.message}` });
    }
  });

  router.post('/transfers/:id/receive', async (req, res, ctx) => {
    const tenantId = getTenantId();
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(ctx.params.id);
    const lines = db.prepare('SELECT * FROM transfer_lines WHERE transfer_id = ?').all(t.id);
    for (const l of lines) {
      stockLib.receiveStock({
        tenantId, siteId: t.to_site_id, productId: l.product_id, quantity: l.quantity, unitId: l.unit_id,
        lotNumber: 'TRF-' + t.id.slice(-6) + '-' + l.id.slice(-4), sourceType: 'transfer', sourceRef: t.id,
        movementType: 'TRANSFER_IN',
      });
    }
    db.prepare(`UPDATE transfers SET status = 'RECEIVED', received_at = datetime('now') WHERE id = ?`).run(t.id);
    res.redirect(`/transfers/${t.id}`, { type: 'ok', message: 'Reception confirmee, stock destinataire mis a jour.' });
  });
}

module.exports = { register };
