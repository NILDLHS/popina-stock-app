const db = require('../lib/db');
const { layout } = require('../lib/render');
const { esc, fmtQty, fmtDate } = require('../lib/util');
const alerts = require('../lib/alerts');

function register(router) {
  router.get('/', (req, res) => {
    const sitesCount = db.prepare('SELECT COUNT(*) as n FROM sites WHERE is_active = 1').get().n;
    const productsCount = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
    const openPOs = db.prepare(`SELECT COUNT(*) as n FROM purchase_orders WHERE status IN ('DRAFT','SENT','PARTIAL')`).get().n;
    const openTransfers = db.prepare(`SELECT COUNT(*) as n FROM transfers WHERE status IN ('DRAFT','SENT')`).get().n;

    const lowStock = alerts.listLowStockAlerts();
    const expiring = alerts.listExpiringLots(5);
    const popinaIssues = alerts.listUnmappedPopinaEvents(10);

    const recentMovements = db.prepare(`
      SELECT m.*, p.name as product_name, s.name as site_name, u.code as unit_code
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id
      JOIN sites s ON s.id = m.site_id
      JOIN units u ON u.id = m.unit_id
      ORDER BY m.occurred_at DESC LIMIT 10
    `).all();

    const body = `
      <div class="page-header">
        <div>
          <h1>Tableau de bord</h1>
          <p class="subtitle">Vue consolidee du groupe (V1 mono-tenant, architecture prete pour du multi-tenant)</p>
        </div>
        <div class="tag-row">
          <a href="/purchase-orders/quick" class="btn">Commande rapide &rarr;</a>
          <a href="/import" class="btn btn-secondary">Importer des donnees (CSV) &rarr;</a>
        </div>
      </div>

      <div class="grid grid-4">
        <div class="kpi"><div class="value">${sitesCount}</div><div class="label">Sites actifs</div></div>
        <div class="kpi"><div class="value">${productsCount}</div><div class="label">Produits references</div></div>
        <div class="kpi ${openPOs > 0 ? 'warn' : ''}"><div class="value">${openPOs}</div><div class="label">Commandes fournisseur en cours</div></div>
        <div class="kpi ${openTransfers > 0 ? 'warn' : ''}"><div class="value">${openTransfers}</div><div class="label">Transferts en cours</div></div>
      </div>

      <div class="grid grid-2" style="margin-top:18px">
        <div class="panel">
          <h2>Alertes rupture de stock (${lowStock.length})</h2>
          ${lowStock.length === 0 ? '<p class="empty">Aucune alerte de rupture.</p>' : `
          <table class="compact">
            <thead><tr><th>Site</th><th>Produit</th><th>Stock</th><th>Seuil</th></tr></thead>
            <tbody>
              ${lowStock.map((a) => `
                <tr>
                  <td><a href="/stock?site=${a.site_id}">${esc(a.site_name)}</a></td>
                  <td>${esc(a.product_name)}</td>
                  <td class="mono" style="color:var(--danger)">${fmtQty(a.current_qty)} ${a.unit_code}</td>
                  <td class="mono muted">${fmtQty(a.min_quantity)} ${a.unit_code}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>

        <div class="panel">
          <h2>DLC proches (&le; 5 jours) (${expiring.length})</h2>
          ${expiring.length === 0 ? '<p class="empty">Aucun lot proche de la peremption.</p>' : `
          <table class="compact">
            <thead><tr><th>Site</th><th>Produit</th><th>Lot</th><th>DLC</th><th>Qte</th></tr></thead>
            <tbody>
              ${expiring.map((l) => `
                <tr>
                  <td>${esc(l.site_name)}</td>
                  <td>${esc(l.product_name)}</td>
                  <td class="mono">${esc(l.lot_number)}</td>
                  <td><span class="badge ${l.days_left < 0 ? 'badge-red' : l.days_left <= 1 ? 'badge-red' : 'badge-orange'}">${l.days_left < 0 ? 'Perime' : l.days_left + ' j'}</span></td>
                  <td class="mono">${fmtQty(l.quantity)} ${l.unit_code}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>

      <div class="panel">
        <h2>Derniers mouvements de stock</h2>
        <table class="compact">
          <thead><tr><th>Date</th><th>Site</th><th>Produit</th><th>Type</th><th>Quantite</th></tr></thead>
          <tbody>
            ${recentMovements.map((m) => `
              <tr>
                <td class="muted">${esc(m.occurred_at)}</td>
                <td>${esc(m.site_name)}</td>
                <td>${esc(m.product_name)}</td>
                <td>${require('../lib/render').movementBadge(m.type)}</td>
                <td class="mono" style="color:${m.quantity < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.quantity > 0 ? '+' : ''}${fmtQty(m.quantity)} ${m.unit_code}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="margin-top:10px"><a href="/movements">Voir tous les mouvements &rarr;</a></p>
      </div>

      ${popinaIssues.length > 0 ? `
      <div class="panel">
        <h2>Incidents de synchro Popina recents</h2>
        <table class="compact">
          <thead><tr><th>Date</th><th>Evenement</th><th>Statut</th><th>Message</th></tr></thead>
          <tbody>
            ${popinaIssues.map((l) => `
              <tr>
                <td class="muted">${esc(l.created_at)}</td>
                <td class="mono">${esc(l.event_type)}</td>
                <td>${require('../lib/render').syncStatusBadge(l.status)}</td>
                <td>${esc(l.message)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="margin-top:10px"><a href="/popina/log">Voir le journal complet &rarr;</a></p>
      </div>` : ''}
    `;

    res.end(layout({ title: 'Tableau de bord', activePath: '/', body }));
  });
}

module.exports = { register };
