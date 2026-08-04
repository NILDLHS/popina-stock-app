const crypto = require('node:crypto');
const db = require('../lib/db');
const { layout, syncStatusBadge, siteTypeBadge } = require('../lib/render');
const { esc, id, parseForm, readBody } = require('../lib/util');
const popina = require('../lib/popina');

function getTenantId() {
  return db.prepare('SELECT id FROM tenants LIMIT 1').get()?.id;
}

function register(router) {
  // ---- Configuration des sites connectes a Popina ----
  router.get('/popina/sites', (req, res, ctx) => {
    const configs = db.prepare(`
      SELECT ps.*, s.name as site_name FROM popina_sites ps JOIN sites s ON s.id = ps.site_id ORDER BY ps.created_at DESC
    `).all();
    const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1 ORDER BY name').all();
    const host = req.headers.host || 'localhost:3000';

    const body = `
      <div class="page-header">
        <div><h1>Sites connectes a Popina</h1><p class="subtitle">Un site Popina (location) = une cle API + un secret webhook dedie. Voir Annexe 9 du prompt pour le detail du modele d'authentification Popina.</p></div>
      </div>
      <div class="alert alert-info">L'API Popina reelle est actuellement <strong>en lecture seule (beta)</strong> : le catalogue et les niveaux de stock ne peuvent pas etre ecrits depuis cette app. Le decrement de stock se fait via les <strong>webhooks</strong> Popina (evenement <code>order.paid</code>), pas par appel API sortant.</div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Sites configures (${configs.length})</h2>
          ${configs.length === 0 ? '<p class="empty">Aucun site Popina configure.</p>' : configs.map((c) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--border)">
              <strong>${esc(c.site_name)}</strong> ${c.is_active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}
              <div class="muted mono" style="font-size:12px;margin-top:4px">Location Popina : ${esc(c.popina_location_id)}</div>
              <div class="muted mono" style="font-size:12px">URL webhook a renseigner cote Popina :<br/>https://${esc(host)}/webhooks/popina/${c.id}</div>
              <div style="margin-top:6px"><a href="/popina/mapping?site=${c.id}">Gerer le mapping produits &rarr;</a> &middot; <a href="/popina/simulate?site=${c.id}">Simuler une vente &rarr;</a></div>
            </div>
          `).join('')}
        </div>
        <div class="panel">
          <h2>Connecter un nouveau site</h2>
          <form method="POST" action="/popina/sites">
            <div class="field"><label>Site interne</label><select name="site_id" required>${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Identifiant de location Popina</label><input name="popina_location_id" required placeholder="ex: fourni par le support Popina" /></div>
            <div class="field"><label>Cle API Popina (optionnel pour l'instant, API en lecture seule)</label><input name="api_key" type="password" placeholder="ne sera jamais affichee en clair" /></div>
            <p class="hint muted">Le secret HMAC pour verifier les webhooks est genere automatiquement.</p>
            <button class="btn" type="submit">Connecter ce site</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: 'Popina - Sites', activePath: '/popina/sites', body, flash: ctx.flash }));
  });

  router.post('/popina/sites', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO popina_sites (id, tenant_id, site_id, popina_location_id, api_key, webhook_secret, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(id('popsite'), tenantId, form.site_id, form.popina_location_id, form.api_key || null, secret);
    res.redirect('/popina/sites', { type: 'ok', message: 'Site Popina connecte. Configure le webhook cote Popina avec l\'URL affichee.' });
  });

  // ---- Mapping produit Popina <-> produit interne ----
  router.get('/popina/mapping', (req, res, ctx) => {
    const popinaSites = db.prepare(`SELECT ps.*, s.name as site_name FROM popina_sites ps JOIN sites s ON s.id = ps.site_id`).all();
    const selectedId = ctx.query.site || popinaSites[0]?.id;
    const mappings = selectedId ? db.prepare(`
      SELECT m.*, p.name as internal_name FROM popina_product_mapping m LEFT JOIN products p ON p.id = m.product_id WHERE m.popina_site_id = ?
    `).all(selectedId) : [];
    const products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY name').all();

    const body = `
      <div class="page-header">
        <div><h1>Mapping produits Popina</h1><p class="subtitle">Associe chaque <code>productCatalogId</code> Popina a un produit/recette interne. Le catalogue Popina ne contient pas de niveau de stock : cette app reste seule source de verite sur les quantites.</p></div>
      </div>
      <div class="panel">
        <form method="GET" action="/popina/mapping" class="form-row" style="max-width:400px;align-items:flex-end">
          <div class="field" style="margin-bottom:0"><label>Site Popina</label>
            <select name="site" onchange="this.form.submit()">${popinaSites.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.site_name)}</option>`).join('')}</select>
          </div>
        </form>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Mapping actuel (${mappings.length})</h2>
          ${mappings.length === 0 ? '<p class="empty">Aucun mapping.</p>' : `
          <table class="compact">
            <thead><tr><th>Produit Popina</th><th>ID catalogue Popina</th><th>Produit interne</th></tr></thead>
            <tbody>
              ${mappings.map((m) => `<tr><td>${esc(m.popina_product_name || '-')}</td><td class="mono">${esc(m.popina_product_catalog_id)}</td><td>${m.internal_name ? esc(m.internal_name) : '<span class="badge badge-orange">Non mappe</span>'}</td></tr>`).join('')}
            </tbody>
          </table>`}
        </div>
        <div class="panel">
          <h2>Ajouter un mapping</h2>
          <form method="POST" action="/popina/mapping">
            <input type="hidden" name="popina_site_id" value="${selectedId || ''}" />
            <div class="field"><label>ID catalogue Popina (productCatalogId)</label><input name="popina_product_catalog_id" required placeholder="ex: 81784041-7df2-4c41-b43f-13bd57be3f39" /></div>
            <div class="field"><label>Nom du produit cote Popina (pour reference)</label><input name="popina_product_name" placeholder="ex: Salade chevre chaud" /></div>
            <div class="field"><label>Produit interne correspondant</label><select name="product_id" required>${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
            <button class="btn" type="submit">Ajouter le mapping</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: 'Popina - Mapping', activePath: '/popina/mapping', body, flash: ctx.flash }));
  });

  router.post('/popina/mapping', async (req, res) => {
    const form = await parseForm(req);
    db.prepare(`
      INSERT INTO popina_product_mapping (id, popina_site_id, popina_product_catalog_id, popina_product_name, product_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(popina_site_id, popina_product_catalog_id) DO UPDATE SET product_id = excluded.product_id, popina_product_name = excluded.popina_product_name
    `).run(id('map'), form.popina_site_id, form.popina_product_catalog_id, form.popina_product_name || null, form.product_id);
    res.redirect(`/popina/mapping?site=${form.popina_site_id}`, { type: 'ok', message: 'Mapping enregistre.' });
  });

  // ---- Journal de synchro ----
  router.get('/popina/log', (req, res, ctx) => {
    const logs = db.prepare(`
      SELECT l.*, s.name as site_name FROM popina_sync_log l
      LEFT JOIN popina_sites ps ON ps.id = l.popina_site_id LEFT JOIN sites s ON s.id = ps.site_id
      ORDER BY l.created_at DESC LIMIT 100
    `).all();
    const body = `
      <div class="page-header">
        <div><h1>Journal de synchronisation Popina</h1><p class="subtitle">Historique des webhooks recus (succes, erreurs, produits non mappes) - 100 dernieres entrees</p></div>
      </div>
      <div class="panel">
        <table class="compact">
          <thead><tr><th>Date</th><th>Site</th><th>Evenement</th><th>Webhook ID</th><th>Statut</th><th>Message</th></tr></thead>
          <tbody>
            ${logs.map((l) => `
              <tr>
                <td class="muted">${esc(l.created_at)}</td>
                <td>${esc(l.site_name || '-')}</td>
                <td class="mono">${esc(l.event_type)}</td>
                <td class="mono muted" style="font-size:11px">${esc((l.webhook_id || '').slice(0, 12))}</td>
                <td>${syncStatusBadge(l.status)}</td>
                <td>${esc(l.message || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${logs.length === 0 ? '<p class="empty">Aucune synchronisation pour l\'instant.</p>' : ''}
      </div>
    `;
    res.end(layout({ title: 'Popina - Journal', activePath: '/popina/log', body, flash: ctx.flash }));
  });

  // ---- Simulateur de vente (outil de dev/demo, sans compte Popina reel) ----
  router.get('/popina/simulate', (req, res, ctx) => {
    const popinaSites = db.prepare(`SELECT ps.*, s.name as site_name FROM popina_sites ps JOIN sites s ON s.id = ps.site_id`).all();
    const selectedId = ctx.query.site || popinaSites[0]?.id;
    const mappings = selectedId ? db.prepare(`
      SELECT m.*, p.name as internal_name FROM popina_product_mapping m JOIN products p ON p.id = m.product_id WHERE m.popina_site_id = ?
    `).all(selectedId) : [];

    const body = `
      <div class="page-header">
        <div><h1>Simuler une vente Popina</h1><p class="subtitle">Outil de test : envoie un vrai webhook <code>order.paid</code> signe (HMAC-SHA256) a l'endpoint local, exactement comme le ferait Popina, pour verifier le decrement de stock de bout en bout.</p></div>
      </div>
      <div class="panel">
        <form method="POST" action="/popina/simulate">
          <input type="hidden" name="popina_site_id" value="${selectedId || ''}" />
          <div class="field"><label>Site Popina</label><select name="site_display" disabled><option>${esc(popinaSites.find(p=>p.id===selectedId)?.site_name || '')}</option></select></div>
          ${mappings.length === 0 ? '<p class="alert alert-warn">Aucun produit mappe pour ce site. Va d\'abord sur la page Mapping.</p>' : `
          <div class="field">
            <label>Produit vendu</label>
            <select name="popina_product_catalog_id" required>
              ${mappings.map((m) => `<option value="${m.popina_product_catalog_id}">${esc(m.popina_product_name || m.internal_name)} &rarr; ${esc(m.internal_name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="field"><label>Quantite vendue</label><input name="quantity" type="number" step="0.001" value="1" required /></div>
            <div class="field"><label>Marquer comme perte (isLoss)</label><select name="is_loss"><option value="0">Non, vente normale</option><option value="1">Oui, perte cote caisse</option></select></div>
          </div>
          <button class="btn" type="submit">Envoyer le webhook order.paid simule</button>
          `}
        </form>
      </div>
    `;
    res.end(layout({ title: 'Popina - Simulateur', activePath: '/popina/mapping', body, flash: ctx.flash }));
  });

  router.post('/popina/simulate', async (req, res) => {
    const form = await parseForm(req);
    const popinaSite = popina.getPopinaSite(form.popina_site_id);
    const orderId = crypto.randomUUID();
    const payload = {
      meta: { id: crypto.randomUUID(), event: 'order.paid', emittedAt: new Date().toISOString() },
      data: {
        id: orderId,
        locationId: popinaSite.popina_location_id,
        isCanceled: false,
        isTransferred: false,
        productRowList: [{
          id: crypto.randomUUID(),
          name: 'Article simule',
          isCanceled: false,
          quantity: parseFloat(form.quantity) || 1,
          weight: null,
          productCatalogId: form.popina_product_catalog_id,
          stockImpactIndicator: true,
          isLoss: form.is_loss === '1',
          lossReason: form.is_loss === '1' ? 'Simulation - demarque' : null,
        }],
        menuRowList: [],
        paymentRowList: [],
      },
    };
    const raw = JSON.stringify(payload);
    const signature = popina.computeHmac(raw, popinaSite.webhook_secret);

    // Appel HTTP local reel vers notre propre endpoint webhook, comme le ferait Popina.
    const http = require('node:http');
    const result = await new Promise((resolve) => {
      const reqOpts = {
        hostname: '127.0.0.1', port: process.env.PORT || 3000, path: `/webhooks/popina/${popinaSite.id}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(raw),
          'x-popina-webhook-event': 'order.paid',
          'x-popina-webhook-id': payload.meta.id,
          'x-popina-hmac-signature': signature,
        },
      };
      const r = http.request(reqOpts, (resp) => {
        let body = '';
        resp.on('data', (c) => body += c);
        resp.on('end', () => resolve({ status: resp.statusCode, body }));
      });
      r.on('error', (e) => resolve({ status: 0, body: e.message }));
      r.write(raw);
      r.end();
    });

    res.redirect(`/popina/simulate?site=${form.popina_site_id}`, {
      type: result.status === 200 ? 'ok' : 'danger',
      message: `Webhook envoye (HTTP ${result.status}) : ${result.body}`,
    });
  });

  // ---- Webhook receiver reel (c'est cet endpoint qu'il faut configurer cote Popina) ----
  router.post('/webhooks/popina/:popinaSiteId', async (req, res, ctx) => {
    const popinaSite = popina.getPopinaSite(ctx.params.popinaSiteId);
    if (!popinaSite || !popinaSite.is_active) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Site Popina inconnu ou inactif' }));
    }

    const rawBuf = await readBody(req);
    const raw = rawBuf.toString('utf8');
    const signatureHeader = req.headers['x-popina-hmac-signature'];
    const webhookId = req.headers['x-popina-webhook-id'];
    const eventType = req.headers['x-popina-webhook-event'];

    if (!popina.verifySignature(raw, signatureHeader, popinaSite.webhook_secret)) {
      popina.logSync(popinaSite.id, eventType, webhookId, 'ERROR', 'Signature HMAC invalide - webhook rejete.');
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Signature invalide' }));
    }

    if (popina.alreadyProcessed(webhookId)) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'already_processed' }));
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'JSON invalide' }));
    }

    try {
      if (eventType === 'order.paid') {
        const result = popina.handleOrderPaid(popinaSite, payload.data, webhookId);
        res.statusCode = 200;
        return res.end(JSON.stringify({ status: 'ok', ...result }));
      } else {
        popina.logSync(popinaSite.id, eventType || 'unknown', webhookId, 'IGNORED', 'Evenement non traite par cette V1 (order.canceled/order.call a implementer si besoin).');
        res.statusCode = 200;
        return res.end(JSON.stringify({ status: 'ignored' }));
      }
    } catch (err) {
      popina.logSync(popinaSite.id, eventType, webhookId, 'ERROR', err.message);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message }));
    }
  });
}

module.exports = { register };
