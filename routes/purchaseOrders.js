const db = require('../lib/db');
const { getTenantId } = require('../lib/tenant');
const { layout, statusBadge } = require('../lib/render');
const { esc, id, parseForm, fmtQty, fmtDate, getCookie, setCookie } = require('../lib/util');
const stockLib = require('../lib/stock');

function register(router) {
  router.get('/purchase-orders', (req, res, ctx) => {
    const supplierFilter = ctx.query.supplier || '';
    const pos = db.prepare(`
      SELECT po.*, sup.name as supplier_name, s.name as site_name
      FROM purchase_orders po
      JOIN suppliers sup ON sup.id = po.supplier_id
      JOIN sites s ON s.id = po.site_id
      ${supplierFilter ? 'WHERE po.supplier_id = ?' : ''}
      ORDER BY po.created_at DESC
    `).all(...(supplierFilter ? [supplierFilter] : []));
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1 ORDER BY name').all();
    const products = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 ORDER BY p.name').all();

    // Vue "a preparer" : quand un fournisseur est filtre, total restant a livrer par produit,
    // tous statuts en cours confondus - utile pour un labo qui recoit les commandes de plusieurs boutiques.
    const toPrepare = supplierFilter ? db.prepare(`
      SELECT p.name as product_name, u.code as unit_code, SUM(pol.quantity_ordered - pol.quantity_received) as total
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      JOIN products p ON p.id = pol.product_id
      JOIN units u ON u.id = pol.unit_id
      WHERE po.supplier_id = ? AND po.status IN ('SENT','PARTIAL') AND pol.quantity_received < pol.quantity_ordered
      GROUP BY p.id
      ORDER BY total DESC
    `).all(supplierFilter) : [];

    const body = `
      <div class="page-header">
        <div><h1>Commandes fournisseurs</h1><p class="subtitle">Approvisionnement externe et interne (un site de production = un fournisseur pour les autres sites)</p></div>
        <a href="/purchase-orders/quick" class="btn">Commande rapide multi-produits &rarr;</a>
      </div>
      <div class="panel">
        <form method="GET" action="/purchase-orders" class="form-row" style="max-width:320px;align-items:flex-end">
          <div class="field" style="margin-bottom:0">
            <label>Filtrer par fournisseur</label>
            <select name="supplier" onchange="this.form.submit()">
              <option value="">Tous les fournisseurs</option>
              ${suppliers.map((s) => `<option value="${s.id}" ${s.id === supplierFilter ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
        </form>
      </div>
      ${supplierFilter ? `
      <div class="panel">
        <h2>Total a preparer (${toPrepare.length})</h2>
        <p class="hint muted">Cumul de toutes les commandes en cours (envoyees ou partiellement recues) pour ce fournisseur - utile pour planifier une production ou un chargement en une fois.</p>
        ${toPrepare.length === 0 ? '<p class="empty">Rien en attente pour ce fournisseur.</p>' : `
        <table class="compact">
          <thead><tr><th>Produit</th><th>Quantite totale restante</th></tr></thead>
          <tbody>
            ${toPrepare.map((t) => `<tr><td>${esc(t.product_name)}</td><td class="mono">${fmtQty(t.total)} ${t.unit_code}</td></tr>`).join('')}
          </tbody>
        </table>`}
      </div>` : ''}
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
        <h2>Nouvelle commande (une ligne)</h2>
        <form method="POST" action="/purchase-orders">
          <div class="form-row">
            <div class="field"><label>Fournisseur</label><select name="supplier_id" required>${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Site destinataire</label><select name="site_id" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>Produit</label><select name="product_id" required>${products.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit_code)})</option>`).join('')}</select></div>
          <div class="field"><label>Quantite commandee</label><input name="quantity" type="number" step="0.0001" required /></div>
          <div class="field"><label>Prix unitaire (optionnel, en euros)</label><input name="unit_price" type="number" step="0.01" /></div>
          <p class="hint muted">Pour commander plusieurs produits d'un coup (cas d'une boutique qui reapprovisionne son labo au quotidien), utilisez plutot la <a href="/purchase-orders/quick">commande rapide</a>.</p>
          <button class="btn btn-secondary" type="submit">Creer la commande</button>
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

  // ---- Commande rapide : une seule page pour commander des dizaines de produits en une fois ----
  // (cas d'usage : une boutique reapprovisionne quotidiennement son labo/fournisseur interne)
  router.get('/purchase-orders/quick', (req, res, ctx) => {
    const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1 ORDER BY name').all();
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    const siteId = ctx.query.site || getCookie(req, 'default_site') || sites.find((s) => s.type === 'STORE' || s.type === 'FRANCHISEE')?.id || sites[0]?.id;
    if (ctx.query.site) setCookie(res, 'default_site', ctx.query.site);
    const supplierId = ctx.query.supplier || (suppliers.length === 1 ? suppliers[0].id : '');
    const q = (ctx.query.q || '').trim();

    const products = q
      ? db.prepare(`SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 AND (p.name LIKE ? OR p.sku LIKE ?) ORDER BY p.name`).all(`%${q}%`, `%${q}%`)
      : db.prepare(`SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 ORDER BY p.name`).all();
    const thresholds = new Map(
      db.prepare('SELECT * FROM stock_thresholds WHERE site_id = ?').all(siteId).map((t) => [t.product_id, t.min_quantity])
    );

    const rows = products.map((p) => {
      const currentQty = siteId ? stockLib.getProductStockAtSite(siteId, p.id) : 0;
      const threshold = thresholds.get(p.id);
      const suggested = threshold !== undefined && currentQty < threshold ? threshold - currentQty : null;
      return { ...p, currentQty, threshold, suggested };
    });

    const body = `
      <div class="page-header">
        <div><h1>Commande rapide</h1><p class="subtitle">Reapprovisionnement multi-produits en une seule soumission - pense pour une commande quotidienne d'une boutique vers son laboratoire.</p></div>
        <a href="/purchase-orders" class="btn btn-secondary">&larr; Retour</a>
      </div>
      <div class="panel">
        <form method="GET" action="/purchase-orders/quick" class="form-row" style="align-items:flex-end">
          <div class="field" style="margin-bottom:0">
            <label>Site (boutique)</label>
            <select name="site" onchange="this.form.submit()">
              ${sites.map((s) => `<option value="${s.id}" ${s.id === siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Fournisseur</label>
            <select name="supplier" onchange="this.form.submit()">
              <option value="">Choisir...</option>
              ${suppliers.map((s) => `<option value="${s.id}" ${s.id === supplierId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0;flex:2">
            <label>Rechercher un produit</label>
            <input name="q" value="${esc(q)}" placeholder="Filtrer la liste par nom ou SKU..." />
          </div>
          <button class="btn btn-secondary" type="submit">Filtrer</button>
        </form>
      </div>
      ${!supplierId ? '<div class="alert alert-warn">Choisissez un fournisseur pour pouvoir envoyer la commande.</div>' : ''}
      <div class="panel">
        <form method="POST" action="/purchase-orders/quick">
          <input type="hidden" name="site_id" value="${siteId || ''}" />
          <input type="hidden" name="supplier_id" value="${supplierId || ''}" />
          <table class="compact">
            <thead><tr><th>Produit</th><th>Stock actuel</th><th>Seuil</th><th>Quantite a commander</th></tr></thead>
            <tbody>
              ${rows.map((r) => {
                const isPieces = r.unit_code === 'pieces';
                const step = isPieces ? '1' : '0.0001';
                const suggestedValue = r.suggested ? (isPieces ? Math.ceil(r.suggested) : r.suggested) : '';
                return `
                <tr>
                  <td>${esc(r.name)} <span class="mono muted">(${esc(r.sku)})</span></td>
                  <td class="mono" style="${r.currentQty <= 0 ? 'color:var(--danger)' : ''}">${fmtQty(r.currentQty)} ${r.unit_code}</td>
                  <td class="mono muted">${r.threshold !== undefined ? fmtQty(r.threshold) + ' ' + r.unit_code : '-'}</td>
                  <td><input name="qty_${r.id}" type="number" step="${step}" min="0" value="${suggestedValue}" placeholder="0" style="max-width:140px" /></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          ${rows.length === 0 ? '<p class="empty">Aucun produit ne correspond a la recherche.</p>' : `
          <div style="margin-top:16px"><button class="btn" type="submit" ${!supplierId ? 'disabled' : ''}>Envoyer la commande</button></div>`}
        </form>
      </div>
    `;
    res.end(layout({ title: 'Commande rapide', activePath: '/purchase-orders', body, flash: ctx.flash }));
  });

  router.post('/purchase-orders/quick', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const products = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id = p.unit_id WHERE p.is_active = 1').all();
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = [];
    for (const [key, value] of Object.entries(form)) {
      if (!key.startsWith('qty_')) continue;
      let qty = parseFloat(value);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const product = byId.get(key.slice(4));
      if (!product) continue;
      if (product.unit_code === 'pieces') qty = Math.round(qty);
      lines.push({ product, qty });
    }

    if (lines.length === 0) {
      return res.redirect(`/purchase-orders/quick?site=${form.site_id}&supplier=${form.supplier_id}`, { type: 'danger', message: 'Aucune quantite renseignee : rien a commander.' });
    }

    const poId = id('po');
    db.prepare('INSERT INTO purchase_orders (id, tenant_id, supplier_id, site_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(poId, tenantId, form.supplier_id, form.site_id, 'SENT');
    for (const { product, qty } of lines) {
      db.prepare('INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity_ordered, unit_id) VALUES (?, ?, ?, ?, ?)')
        .run(id('pol'), poId, product.id, qty, product.unit_id);
    }

    res.redirect(`/purchase-orders/${poId}`, { type: 'ok', message: `Commande envoyee avec ${lines.length} produit(s).` });
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
    const products = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.is_active = 1 ORDER BY p.name').all();

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
        ${po.status !== 'CANCELED' ? `
        <hr class="sep" />
        <h3>Ajouter une ligne</h3>
        <form method="POST" action="/purchase-orders/${po.id}/lines">
          <div class="form-row">
            <div class="field">
              <label>Produit</label>
              <select name="product_id" required>${products.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit_code)})</option>`).join('')}</select>
            </div>
            <div class="field"><label>Quantite commandee</label><input name="quantity" type="number" step="0.0001" required /></div>
            <div class="field"><label>Prix unitaire (optionnel, en euros)</label><input name="unit_price" type="number" step="0.01" /></div>
          </div>
          <button class="btn btn-secondary" type="submit">Ajouter la ligne</button>
        </form>` : ''}
      </div>
    `;
    res.end(layout({ title: 'Commande fournisseur', activePath: '/purchase-orders', body, flash: ctx.flash }));
  });

  router.post('/purchase-orders/:id/lines', async (req, res, ctx) => {
    const form = await parseForm(req);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);
    db.prepare('INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity_ordered, unit_id, unit_price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id('pol'), ctx.params.id, form.product_id, parseFloat(form.quantity), product.unit_id, form.unit_price ? parseFloat(form.unit_price) * 100 : null);
    res.redirect(`/purchase-orders/${ctx.params.id}`, { type: 'ok', message: 'Ligne ajoutee a la commande.' });
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

    // Fournisseur interne (ex: laboratoire de production) : la marchandise recue par la boutique
    // doit aussi quitter le stock du site fournisseur, sinon elle "apparait" sans jamais avoir
    // ete decomptee cote labo. allowNegative pour ne jamais bloquer la reception boutique.
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(po.supplier_id);
    if (supplier?.is_internal && supplier.internal_site_id) {
      stockLib.consumeStockFIFO({
        tenantId, siteId: supplier.internal_site_id, productId: line.product_id, quantity: qty, unitId: line.unit_id,
        type: 'TRANSFER_OUT', referenceType: 'purchase_order', referenceId: po.id,
        note: `Expedition vers ${po.site_id} (commande ${po.id})`, relatedSiteId: po.site_id, allowNegative: true,
      });
    }

    db.prepare('UPDATE purchase_order_lines SET quantity_received = quantity_received + ? WHERE id = ?').run(qty, line.id);

    const allLines = db.prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ?').all(po.id);
    const allReceived = allLines.every((l) => l.quantity_received >= l.quantity_ordered - 0.0001);
    const someReceived = allLines.some((l) => l.quantity_received > 0.0001);
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL' : po.status, po.id);

    res.redirect(`/purchase-orders/${po.id}`, { type: 'ok', message: `${qty} unite(s) receptionnee(s), stock mis a jour.` });
  });
}

module.exports = { register };
