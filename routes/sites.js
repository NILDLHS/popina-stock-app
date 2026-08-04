const db = require('../lib/db');
const { layout, siteTypeBadge } = require('../lib/render');
const { esc, id, parseForm } = require('../lib/util');
const stockLib = require('../lib/stock');

function getTenantId() {
  return db.prepare('SELECT id FROM tenants LIMIT 1').get()?.id;
}

function register(router) {
  router.get('/sites', (req, res, ctx) => {
    const sites = db.prepare('SELECT * FROM sites ORDER BY type, name').all();
    const body = `
      <div class="page-header">
        <div><h1>Sites</h1><p class="subtitle">Magasins, points de production, franchises et clients externes</p></div>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Liste des sites (${sites.length})</h2>
          <table>
            <thead><tr><th>Nom</th><th>Type</th><th>Adresse</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${sites.map((s) => {
                const usage = stockLib.getSiteUsage(s.id);
                return `
                <tr>
                  <td><a href="/stock?site=${s.id}">${esc(s.name)}</a></td>
                  <td>${siteTypeBadge(s.type)}</td>
                  <td class="muted">${esc(s.address || '-')}</td>
                  <td>${s.is_active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
                  <td class="row-actions">
                    <form method="POST" action="/sites/${s.id}/toggle-active">
                      <button class="btn btn-secondary btn-sm" type="submit">${s.is_active ? 'Desactiver' : 'Reactiver'}</button>
                    </form>
                    ${usage.total === 0
                      ? `<form method="POST" action="/sites/${s.id}/delete" onsubmit="return confirm('Supprimer definitivement le site \\'${esc(s.name).replace(/'/g, "\\'")}\\' ? Cette action est irreversible.');">
                          <button class="btn btn-danger btn-sm" type="submit">Supprimer</button>
                        </form>`
                      : `<span class="muted" title="${esc(usage.details.map(([label, n]) => `${label}: ${n}`).join(', '))}">Utilise ailleurs (${usage.total})</span>`}
                  </td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Nouveau site</h2>
          <form method="POST" action="/sites">
            <div class="field"><label>Nom</label><input name="name" required placeholder="Ex: Restaurant Toulouse Capitole" /></div>
            <div class="field">
              <label>Type</label>
              <select name="type" required>
                <option value="STORE">Magasin / Restaurant</option>
                <option value="PRODUCTION">Point de production</option>
                <option value="FRANCHISEE">Franchise</option>
                <option value="CLIENT">Client externe (B2B)</option>
                <option value="WAREHOUSE">Entrepot</option>
              </select>
            </div>
            <div class="field"><label>Adresse</label><input name="address" placeholder="Adresse postale" /></div>
            <button class="btn" type="submit">Creer le site</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: 'Sites', activePath: '/sites', body, flash: ctx.flash }));
  });

  router.post('/sites', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    db.prepare('INSERT INTO sites (id, tenant_id, name, type, address) VALUES (?, ?, ?, ?, ?)')
      .run(id('site'), tenantId, form.name, form.type, form.address || null);
    res.redirect('/sites', { type: 'ok', message: `Site "${form.name}" cree.` });
  });

  router.post('/sites/:id/toggle-active', (req, res, ctx) => {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(ctx.params.id);
    if (!site) { res.statusCode = 404; return res.end('Site introuvable'); }
    db.prepare('UPDATE sites SET is_active = ? WHERE id = ?').run(site.is_active ? 0 : 1, site.id);
    res.redirect('/sites', { type: 'ok', message: `Site "${site.name}" ${site.is_active ? 'desactive' : 'reactive'}.` });
  });

  router.post('/sites/:id/delete', (req, res, ctx) => {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(ctx.params.id);
    if (!site) { res.statusCode = 404; return res.end('Site introuvable'); }
    const usage = stockLib.getSiteUsage(site.id);
    if (usage.total > 0) {
      return res.redirect('/sites', { type: 'danger', message: `Impossible de supprimer "${site.name}" : encore reference ailleurs (${usage.details.map(([label, n]) => `${label}: ${n}`).join(', ')}). Desactivez-le a la place.` });
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    res.redirect('/sites', { type: 'ok', message: `Site "${site.name}" supprime definitivement.` });
  });
}

module.exports = { register };
