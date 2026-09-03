const db = require('../lib/db');
const { getTenantId } = require('../lib/tenant');
const { layout } = require('../lib/render');
const { esc, parseForm, fmtQty, fmtDate, id, daysUntil, getCookie, setCookie } = require('../lib/util');
const stockLib = require('../lib/stock');

// Table detaillee (type, quantite, hier, ecart, DLC) reutilisee pour la section laboratoire
// et pour le detail par site choisi dans le selecteur.
function renderStockTable(rows, siteId) {
  if (rows.length === 0) return '<p class="empty">Aucun produit reference.</p>';
  return `
    <table>
      <thead><tr><th>Produit</th><th>Type</th><th>Quantite en stock</th><th>Hier</th><th>Ecart</th><th>DLC la plus proche</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const days = r.next_expiry ? daysUntil(r.next_expiry) : null;
          const dlc = r.next_expiry ? `${fmtDate(r.next_expiry)} <span class="badge ${days < 0 ? 'badge-red' : days <= 3 ? 'badge-orange' : 'badge-gray'}">${days < 0 ? 'perime' : days + ' j'}</span>` : '<span class="muted">-</span>';
          const delta = r.quantity - r.quantity_yesterday;
          const deltaCell = Math.abs(delta) < 0.0001
            ? '<span class="muted">=</span>'
            : `<span class="mono" style="color:${delta > 0 ? 'var(--ok)' : 'var(--danger)'}">${delta > 0 ? '+' : ''}${fmtQty(delta)}</span>`;
          return `
          <tr>
            <td>${esc(r.name)}</td>
            <td class="muted">${r.type === 'FINISHED' ? '' : r.type}</td>
            <td class="mono" style="${r.quantity <= 0 ? 'color:var(--danger)' : ''}">${fmtQty(r.quantity)} ${r.unit_code}</td>
            <td class="mono muted">${fmtQty(r.quantity_yesterday)} ${r.unit_code}</td>
            <td>${deltaCell}</td>
            <td>${dlc}</td>
            <td><a href="/stock/lots?site=${siteId}&product=${r.product_id}">Lots &amp; ajustement &rarr;</a></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function register(router) {
  router.get('/stock', (req, res, ctx) => {
    const sites = db.prepare('SELECT * FROM sites ORDER BY type, name').all();
    const siteId = ctx.query.site || getCookie(req, 'default_site') || sites[0]?.id;
    if (ctx.query.site) setCookie(res, 'default_site', ctx.query.site);
    const site = sites.find((s) => s.id === siteId);
    const rows = site ? stockLib.getStockBySite(siteId) : [];
    const tenantId = getTenantId();

    const labSites = sites.filter((s) => s.type === 'PRODUCTION' && s.is_active);
    const { sites: matrixSites, products: matrixProducts, qtyMap } = stockLib.getStockMatrix(tenantId);

    const body = `
      <div class="page-header">
        <div><h1>Stock par site</h1><p class="subtitle">Niveaux de stock temps reel, valorises par lot (FIFO / DLC la plus proche en premier)</p></div>
      </div>

      ${labSites.map((lab) => `
      <div class="panel">
        <h2>Laboratoire &mdash; ${esc(lab.name)}</h2>
        ${renderStockTable(stockLib.getStockBySite(lab.id), lab.id)}
      </div>`).join('')}

      <div class="panel">
        <h2>Vue consolidee &mdash; tous les etablissements</h2>
        <p class="hint muted">Stock actuel de chaque produit, pour chaque site, en un coup d'oeil.</p>
        ${matrixProducts.length === 0 || matrixSites.length === 0 ? '<p class="empty">Rien a afficher.</p>' : `
        <div style="overflow-x:auto">
        <table class="compact">
          <thead><tr><th>Produit</th>${matrixSites.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
          <tbody>
            ${matrixProducts.map((p) => `
              <tr>
                <td>${esc(p.name)}</td>
                ${matrixSites.map((s) => {
                  const qty = qtyMap[p.id]?.[s.id] || 0;
                  return `<td class="mono" style="${qty <= 0 ? 'color:var(--danger)' : ''}"><a href="/stock/lots?site=${s.id}&product=${p.id}">${fmtQty(qty)} ${p.unit_code}</a></td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
        </div>`}
      </div>

      <div class="panel">
        <form method="GET" action="/stock" class="form-row" style="align-items:flex-end;max-width:400px">
          <div class="field" style="margin-bottom:0">
            <label>Detail d'un site</label>
            <select name="site" onchange="this.form.submit()">
              ${sites.map((s) => `<option value="${s.id}" ${s.id === siteId ? 'selected' : ''}>${esc(s.name)}${s.is_active ? '' : ' (inactif)'}</option>`).join('')}
            </select>
          </div>
        </form>
      </div>
      <div class="panel">
        <h2>${site ? esc(site.name) : ''} &mdash; stock actuel</h2>
        ${renderStockTable(rows, siteId)}
      </div>
    `;
    res.end(layout({ title: 'Stock', activePath: '/stock', body, flash: ctx.flash }));
  });

  router.get('/stock/lots', (req, res, ctx) => {
    const siteId = ctx.query.site;
    const productId = ctx.query.product;
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    const product = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id=p.unit_id WHERE p.id = ?').get(productId);
    if (!site || !product) { res.statusCode = 404; return res.end('Introuvable'); }
    const lots = stockLib.listLots(siteId, productId);
    const currentQty = stockLib.getProductStockAtSite(siteId, productId);
    const threshold = db.prepare('SELECT * FROM stock_thresholds WHERE site_id = ? AND product_id = ?').get(siteId, productId);

    const body = `
      <div class="page-header">
        <div><h1>${esc(product.name)} &mdash; ${esc(site.name)}</h1><p class="subtitle">Detail des lots en stock et ajustements manuels</p></div>
        <a href="/stock?site=${siteId}" class="btn btn-secondary">&larr; Retour au stock du site</a>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Lots actifs (stock total : ${fmtQty(currentQty)} ${product.unit_code})</h2>
          ${lots.length === 0 ? '<p class="empty">Aucun lot en stock.</p>' : `
          <table class="compact">
            <thead><tr><th>Lot</th><th>Quantite</th><th>DLC</th><th>Origine</th></tr></thead>
            <tbody>
              ${lots.map((l) => `<tr><td class="mono">${esc(l.lot_number)}</td><td class="mono">${fmtQty(l.quantity)} ${product.unit_code}</td><td>${fmtDate(l.expiry_date)}</td><td class="muted">${esc(l.source_type)}</td></tr>`).join('')}
            </tbody>
          </table>`}
        </div>
        <div class="panel">
          <h3>Ajustement d'inventaire</h3>
          <form method="POST" action="/stock/adjust">
            <input type="hidden" name="site_id" value="${siteId}" />
            <input type="hidden" name="product_id" value="${productId}" />
            <div class="field"><label>Quantite constatee reellement (unite: ${esc(product.unit_code)})</label><input name="counted_quantity" type="number" step="0.0001" required value="${fmtQty(currentQty).replace(/\s/g, '').replace(',', '.')}" /></div>
            <div class="field"><label>Commentaire</label><input name="note" placeholder="Ex: inventaire hebdomadaire" /></div>
            <button class="btn" type="submit">Enregistrer l'ajustement</button>
          </form>
          <hr class="sep" />
          <h3>Declarer une perte / casse</h3>
          <form method="POST" action="/stock/loss">
            <input type="hidden" name="site_id" value="${siteId}" />
            <input type="hidden" name="product_id" value="${productId}" />
            <div class="field"><label>Quantite perdue</label><input name="quantity" type="number" step="0.0001" required /></div>
            <div class="field"><label>Motif</label><input name="reason" placeholder="Ex: casse, peremption" required /></div>
            <button class="btn btn-danger" type="submit">Declarer la perte</button>
          </form>
          <hr class="sep" />
          <h3>Seuil d'alerte / reappro</h3>
          <p class="hint muted">En dessous de ce seuil, le produit apparait dans les alertes rupture du tableau de bord et sa quantite est suggeree automatiquement sur l'ecran de commande rapide.</p>
          <form method="POST" action="/stock/threshold">
            <input type="hidden" name="site_id" value="${siteId}" />
            <input type="hidden" name="product_id" value="${productId}" />
            <div class="field"><label>Seuil (unite: ${esc(product.unit_code)})</label><input name="min_quantity" type="number" step="0.0001" value="${threshold ? threshold.min_quantity : ''}" placeholder="Ex: 5" required /></div>
            <button class="btn btn-secondary" type="submit">Enregistrer le seuil</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: `${product.name} - ${site.name}`, activePath: '/stock', body, flash: ctx.flash }));
  });

  router.post('/stock/adjust', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const current = stockLib.getProductStockAtSite(form.site_id, form.product_id);
    const counted = parseFloat(form.counted_quantity);
    const diff = counted - current;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);

    if (Math.abs(diff) > 0.0001) {
      if (diff > 0) {
        stockLib.receiveStock({
          tenantId, siteId: form.site_id, productId: form.product_id, quantity: diff, unitId: product.unit_id,
          lotNumber: 'AJUST-' + Date.now(), sourceType: 'INVENTORY_ADJUST', movementType: 'INVENTORY_ADJUST',
        });
      } else {
        stockLib.consumeStockFIFO({
          tenantId, siteId: form.site_id, productId: form.product_id, quantity: -diff, unitId: product.unit_id,
          type: 'INVENTORY_ADJUST', referenceType: 'manual', note: form.note, allowNegative: true,
        });
      }
    }
    res.redirect(`/stock/lots?site=${form.site_id}&product=${form.product_id}`, { type: 'ok', message: `Inventaire ajuste (ecart: ${diff > 0 ? '+' : ''}${diff.toFixed(3)}).` });
  });

  router.post('/stock/loss', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(form.product_id);
    stockLib.consumeStockFIFO({
      tenantId, siteId: form.site_id, productId: form.product_id, quantity: parseFloat(form.quantity), unitId: product.unit_id,
      type: 'LOSS', referenceType: 'manual_loss', note: form.reason, allowNegative: true,
    });
    res.redirect(`/stock/lots?site=${form.site_id}&product=${form.product_id}`, { type: 'ok', message: 'Perte enregistree.' });
  });

  router.post('/stock/threshold', async (req, res) => {
    const form = await parseForm(req);
    db.prepare(`
      INSERT INTO stock_thresholds (id, site_id, product_id, min_quantity) VALUES (?, ?, ?, ?)
      ON CONFLICT(site_id, product_id) DO UPDATE SET min_quantity = excluded.min_quantity
    `).run(id('thr'), form.site_id, form.product_id, parseFloat(form.min_quantity));
    res.redirect(`/stock/lots?site=${form.site_id}&product=${form.product_id}`, { type: 'ok', message: 'Seuil enregistre.' });
  });
}

module.exports = { register };
