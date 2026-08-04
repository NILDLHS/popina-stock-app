const db = require('../lib/db');
const { layout, movementBadge } = require('../lib/render');
const { esc, fmtQty } = require('../lib/util');

function register(router) {
  router.get('/movements', (req, res, ctx) => {
    const sites = db.prepare('SELECT * FROM sites ORDER BY name').all();
    const siteFilter = ctx.query.site || '';
    const rows = db.prepare(`
      SELECT m.*, p.name as product_name, s.name as site_name, rs.name as related_site_name, u.code as unit_code
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id
      JOIN sites s ON s.id = m.site_id
      LEFT JOIN sites rs ON rs.id = m.related_site_id
      JOIN units u ON u.id = m.unit_id
      ${siteFilter ? 'WHERE m.site_id = ?' : ''}
      ORDER BY m.occurred_at DESC LIMIT 200
    `).all(...(siteFilter ? [siteFilter] : []));

    const body = `
      <div class="page-header">
        <div><h1>Journal des mouvements de stock</h1><p class="subtitle">Historique complet et immuable (audit trail) - 200 dernieres lignes</p></div>
      </div>
      <div class="panel">
        <form method="GET" action="/movements" class="form-row" style="max-width:320px;align-items:flex-end">
          <div class="field" style="margin-bottom:0">
            <label>Filtrer par site</label>
            <select name="site" onchange="this.form.submit()">
              <option value="">Tous les sites</option>
              ${sites.map((s) => `<option value="${s.id}" ${s.id === siteFilter ? 'selected' : ''}>${esc(s.name)}${s.is_active ? '' : ' (inactif)'}</option>`).join('')}
            </select>
          </div>
        </form>
      </div>
      <div class="panel">
        <table class="compact">
          <thead><tr><th>Date</th><th>Site</th><th>Produit</th><th>Type</th><th>Quantite</th><th>Reference</th><th>Note</th></tr></thead>
          <tbody>
            ${rows.map((m) => `
              <tr>
                <td class="muted">${esc(m.occurred_at)}</td>
                <td>${esc(m.site_name)}${m.related_site_name ? ' &harr; ' + esc(m.related_site_name) : ''}</td>
                <td>${esc(m.product_name)}</td>
                <td>${movementBadge(m.type)}</td>
                <td class="mono" style="color:${m.quantity < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.quantity > 0 ? '+' : ''}${fmtQty(m.quantity)} ${m.unit_code}</td>
                <td class="mono muted">${esc(m.reference_type || '-')}</td>
                <td class="muted">${esc(m.note || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length === 0 ? '<p class="empty">Aucun mouvement.</p>' : ''}
      </div>
    `;
    res.end(layout({ title: 'Mouvements', activePath: '/movements', body, flash: ctx.flash }));
  });
}

module.exports = { register };
