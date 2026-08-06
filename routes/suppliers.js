const db = require('../lib/db');
const { getTenantId } = require('../lib/tenant');
const { layout } = require('../lib/render');
const { esc, id, parseForm } = require('../lib/util');

function register(router) {
  router.get('/suppliers', (req, res, ctx) => {
    const suppliers = db.prepare(`
      SELECT sup.*, s.name as internal_site_name FROM suppliers sup LEFT JOIN sites s ON s.id = sup.internal_site_id ORDER BY sup.is_internal DESC, sup.name
    `).all();
    const sites = db.prepare(`SELECT * FROM sites WHERE type = 'PRODUCTION' AND is_active = 1 ORDER BY name`).all();

    const body = `
      <div class="page-header">
        <div><h1>Fournisseurs</h1><p class="subtitle">Fournisseurs externes classiques et sites de production internes (traites comme fournisseurs pour les autres sites)</p></div>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Liste (${suppliers.length})</h2>
          <table class="compact">
            <thead><tr><th>Nom</th><th>Type</th><th>Contact / delai</th></tr></thead>
            <tbody>
              ${suppliers.map((s) => `
                <tr>
                  <td>${esc(s.name)}</td>
                  <td>${s.is_internal ? `<span class="badge badge-blue">Interne (${esc(s.internal_site_name || '')})</span>` : '<span class="badge badge-gray">Externe</span>'}</td>
                  <td class="muted">${s.is_internal ? '-' : esc(s.contact_email || '-')} ${s.lead_time_days ? `&middot; ${s.lead_time_days}j delai` : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Nouveau fournisseur</h2>
          <form method="POST" action="/suppliers">
            <div class="field"><label>Nom</label><input name="name" required /></div>
            <div class="field">
              <label>Type</label>
              <select name="is_internal" id="isInternalSelect" onchange="document.getElementById('internalSiteField').style.display = this.value==='1' ? 'block' : 'none'; document.getElementById('externalFields').style.display = this.value==='1' ? 'none' : 'block';">
                <option value="0">Fournisseur externe</option>
                <option value="1">Site de production interne (fournisseur interne)</option>
              </select>
            </div>
            <div id="internalSiteField" class="field" style="display:none">
              <label>Site de production associe</label>
              <select name="internal_site_id">${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
            </div>
            <div id="externalFields">
              <div class="field"><label>Email de commande</label><input name="contact_email" type="email" /></div>
              <div class="field"><label>Delai de livraison (jours)</label><input name="lead_time_days" type="number" min="0" /></div>
            </div>
            <button class="btn" type="submit">Creer le fournisseur</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: 'Fournisseurs', activePath: '/suppliers', body, flash: ctx.flash }));
  });

  router.post('/suppliers', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const isInternal = form.is_internal === '1';
    db.prepare('INSERT INTO suppliers (id, tenant_id, name, is_internal, internal_site_id, contact_email, lead_time_days) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id('sup'), tenantId, form.name, isInternal ? 1 : 0, isInternal ? form.internal_site_id : null, isInternal ? null : (form.contact_email || null), form.lead_time_days ? parseInt(form.lead_time_days) : null);
    res.redirect('/suppliers', { type: 'ok', message: `Fournisseur "${form.name}" cree.` });
  });
}

module.exports = { register };
