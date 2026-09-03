const db = require('../lib/db');
const { layout, icon, movementBadge } = require('../lib/render');
const { esc, fmtQty } = require('../lib/util');
const { getTenantId } = require('../lib/tenant');
const alerts = require('../lib/alerts');
const stockLib = require('../lib/stock');

// Fusionne les 4 sources d'alertes/suggestions en un seul flux triable par urgence, pour n'avoir
// qu'un seul endroit a regarder plutot que plusieurs tableaux disperses (rupture, DLC, Popina,
// suggestions de fabrication).
function buildActionFeed({ lowStock, expiring, popinaIssues, suggestions }) {
  const items = [];

  for (const a of lowStock) {
    items.push({
      severity: 'danger', icon: 'alert',
      title: `Rupture : ${a.product_name}`,
      meta: `${esc(a.site_name)} - ${fmtQty(a.current_qty)} ${a.unit_code} (seuil ${fmtQty(a.min_quantity)} ${a.unit_code})`,
      href: `/stock?site=${a.site_id}`,
    });
  }

  for (const l of expiring) {
    const urgent = l.days_left <= 1;
    items.push({
      severity: urgent ? 'danger' : 'warn', icon: 'clock',
      title: `DLC ${l.days_left < 0 ? 'depassee' : 'proche'} : ${l.product_name}`,
      meta: `${esc(l.site_name)} - lot ${esc(l.lot_number)} - ${fmtQty(l.quantity)} ${l.unit_code} - ${l.days_left < 0 ? 'perime' : l.days_left + ' j'}`,
      href: `/stock?site=${l.site_id}`,
    });
  }

  for (const p of popinaIssues) {
    items.push({
      severity: p.status === 'ERROR' ? 'danger' : 'warn', icon: 'sync',
      title: `Popina ${p.event_type || ''} : ${p.status === 'ERROR' ? 'erreur' : 'produit non mappe'}`,
      meta: esc(p.message || ''),
      href: '/popina/log',
    });
  }

  for (const s of suggestions) {
    items.push({
      severity: 'info', icon: 'factory',
      title: `Fabrication suggeree : ${s.product_name}`,
      meta: `${fmtQty(s.total_missing)} ${s.unit_code} pour ${s.sites.length} boutique(s) sous seuil`,
      href: `/production?suggest_product=${s.product_id}&suggest_qty=${s.total_missing}#nouvel-ordre`,
    });
  }

  const rank = { danger: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function register(router) {
  router.get('/', (req, res) => {
    const tenantId = getTenantId();
    const sitesCount = db.prepare('SELECT COUNT(*) as n FROM sites WHERE is_active = 1').get().n;
    const productsCount = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
    const openPOs = db.prepare(`SELECT COUNT(*) as n FROM purchase_orders WHERE status IN ('DRAFT','SENT','PARTIAL')`).get().n;
    const openTransfers = db.prepare(`SELECT COUNT(*) as n FROM transfers WHERE status IN ('DRAFT','SENT')`).get().n;

    const feed = buildActionFeed({
      lowStock: alerts.listLowStockAlerts(),
      expiring: alerts.listExpiringLots(5),
      popinaIssues: alerts.listUnmappedPopinaEvents(10),
      suggestions: stockLib.getProductionSuggestions(tenantId),
    });

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
          <a href="/purchase-orders/quick" class="btn">${icon('orders', { size: 16 })} Commande rapide &rarr;</a>
          <a href="/import" class="btn btn-secondary">${icon('importcsv', { size: 16 })} Importer des donnees (CSV) &rarr;</a>
        </div>
      </div>

      <div class="grid grid-4">
        <div class="kpi"><div class="kpi-icon">${icon('sites', { size: 20 })}</div><div><div class="value">${sitesCount}</div><div class="label">Sites actifs</div></div></div>
        <div class="kpi"><div class="kpi-icon">${icon('products', { size: 20 })}</div><div><div class="value">${productsCount}</div><div class="label">Produits references</div></div></div>
        <div class="kpi ${openPOs > 0 ? 'warn' : ''}"><div class="kpi-icon">${icon('orders', { size: 20 })}</div><div><div class="value">${openPOs}</div><div class="label">Commandes fournisseur en cours</div></div></div>
        <div class="kpi ${openTransfers > 0 ? 'warn' : ''}"><div class="kpi-icon">${icon('transfers', { size: 20 })}</div><div><div class="value">${openTransfers}</div><div class="label">Transferts en cours</div></div></div>
      </div>

      <div class="panel" style="margin-top:18px">
        <h2>${icon('alert', { size: 17 })} Actions prioritaires (${feed.length})</h2>
        ${feed.length === 0 ? '<p class="empty">Rien a signaler : aucune rupture, DLC proche, incident Popina ou suggestion de fabrication en attente.</p>' : `
        <div class="action-feed">
          ${feed.map((a) => `
            <a href="${a.href}" class="action-item ${a.severity}">
              <div class="action-icon">${icon(a.icon, { size: 17 })}</div>
              <div class="action-body">
                <div class="action-title">${a.title}</div>
                <div class="action-meta">${a.meta}</div>
              </div>
              <div class="action-arrow">${icon('arrow', { size: 16 })}</div>
            </a>
          `).join('')}
        </div>`}
      </div>

      <div class="panel">
        <h2>${icon('movements', { size: 17 })} Derniers mouvements de stock</h2>
        <table class="compact">
          <thead><tr><th>Date</th><th>Site</th><th>Produit</th><th>Type</th><th>Quantite</th></tr></thead>
          <tbody>
            ${recentMovements.map((m) => `
              <tr>
                <td class="muted">${esc(m.occurred_at)}</td>
                <td>${esc(m.site_name)}</td>
                <td>${esc(m.product_name)}</td>
                <td>${movementBadge(m.type)}</td>
                <td class="mono" style="color:${m.quantity < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.quantity > 0 ? '+' : ''}${fmtQty(m.quantity)} ${m.unit_code}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="margin-top:10px"><a href="/movements">Voir tous les mouvements &rarr;</a></p>
      </div>
    `;

    res.end(layout({ title: 'Tableau de bord', activePath: '/', body }));
  });
}

module.exports = { register };
