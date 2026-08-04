const db = require('../lib/db');
const { layout } = require('../lib/render');
const { esc, readBody } = require('../lib/util');
const { parseCsvRecords, toCsv } = require('../lib/csv');
const { parseMultipart } = require('../lib/multipart');
const importer = require('../lib/importer');

function getTenantId() {
  return db.prepare('SELECT id FROM tenants LIMIT 1').get()?.id;
}

const TEMPLATES = {
  sites: {
    filename: 'modele_sites.csv',
    header: ['nom', 'type', 'adresse'],
    example: [
      ['Restaurant Toulouse Capitole', 'magasin', '2 place du Capitole, Toulouse'],
      ['Atelier de production B', 'production', '10 rue de la Logistique, Toulouse'],
    ],
    help: 'type accepte : magasin, production, franchise, client, entrepot.',
  },
  products: {
    filename: 'modele_produits.csv',
    header: ['sku', 'nom', 'type', 'unite', 'categorie', 'vendu_au_poids'],
    example: [
      ['SUCRE', 'Sucre en poudre', 'matiere_premiere', 'kg', 'Epicerie', ''],
      ['TARTE-CITRON', 'Tarte au citron', 'produit_fini', 'unit', 'Patisserie', ''],
    ],
    help: 'type accepte : matiere_premiere, semi_fini, produit_fini. unite : ex kg, L, unit, carton (creee automatiquement si inconnue). vendu_au_poids : oui/non.',
  },
  stock: {
    filename: 'modele_stock_initial.csv',
    header: ['site', 'produit_sku', 'quantite', 'lot', 'dlc'],
    example: [
      ['Restaurant Toulouse Capitole', 'SUCRE', '25', '', ''],
      ['Restaurant Toulouse Capitole', 'TARTE-CITRON', '6', 'LOT-0001', '2026-09-01'],
    ],
    help: 'site et produit_sku doivent deja exister dans l\'app (creez-les d\'abord via les imports Sites / Produits, ou manuellement). dlc au format AAAA-MM-JJ (optionnel). Chaque ligne cree une reception de stock (nouveau lot).',
  },
};

function reportToMessage(label, report) {
  const parts = [`${report.created} ${label} cree(s)`, `${report.updated} mis a jour`];
  if (report.errors.length > 0) {
    parts.push(`${report.errors.length} erreur(s)`);
  }
  let msg = parts.join(', ') + '.';
  if (report.errors.length > 0) {
    msg += ' ' + report.errors.slice(0, 8).map((e) => `Ligne ${e.line} : ${e.message}`).join(' | ');
    if (report.errors.length > 8) msg += ` (+ ${report.errors.length - 8} autre(s) erreur(s))`;
  }
  return msg;
}

async function readMultipartFile(req, fieldName) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw new Error('Formulaire invalide (fichier attendu).');
  }
  const buffer = await readBody(req);
  const { files } = parseMultipart(buffer, contentType);
  const file = files[fieldName];
  if (!file || !file.content || file.content.length === 0) {
    throw new Error('Aucun fichier selectionne.');
  }
  return file.content.toString('utf8');
}

function register(router) {
  router.get('/import', (req, res, ctx) => {
    const body = `
      <div class="page-header">
        <div><h1>Import CSV</h1><p class="subtitle">Import en masse des referentiels (sites, produits) et du stock initial, depuis un fichier CSV export d'Excel/Google Sheets.</p></div>
      </div>
      <div class="grid grid-3">
        ${['sites', 'products', 'stock'].map((key) => {
          const t = TEMPLATES[key];
          const titles = { sites: 'Sites', products: 'Produits & recettes', stock: 'Stock initial' };
          const actions = { sites: '/import/sites', products: '/import/products', stock: '/import/stock' };
          return `
          <div class="panel">
            <h2>${titles[key]}</h2>
            <p class="hint muted">${esc(t.help)}</p>
            <p><a href="/import/template/${key}.csv">&darr; Telecharger le modele CSV</a></p>
            <form method="POST" action="${actions[key]}" enctype="multipart/form-data">
              <div class="field"><label>Fichier CSV</label><input type="file" name="file" accept=".csv,text/csv" required /></div>
              <button class="btn" type="submit">Importer</button>
            </form>
          </div>`;
        }).join('')}
      </div>
    `;
    res.end(layout({ title: 'Import CSV', activePath: '/import', body, flash: ctx.flash }));
  });

  router.get('/import/template/:key.csv', (req, res, ctx) => {
    const key = ctx.params['key.csv']?.replace(/\.csv$/, '') || ctx.params.key;
    const t = TEMPLATES[key];
    if (!t) { res.statusCode = 404; return res.end('Modele introuvable'); }
    const csv = toCsv([t.header, ...t.example]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
    res.end(csv);
  });

  router.post('/import/sites', async (req, res) => {
    const tenantId = getTenantId();
    try {
      const text = await readMultipartFile(req, 'file');
      const report = importer.importSites(parseCsvRecords(text), tenantId);
      res.redirect('/import', { type: report.errors.length > 0 ? 'danger' : 'ok', message: reportToMessage('site(s)', report) });
    } catch (err) {
      res.redirect('/import', { type: 'danger', message: `Import impossible : ${err.message}` });
    }
  });

  router.post('/import/products', async (req, res) => {
    const tenantId = getTenantId();
    try {
      const text = await readMultipartFile(req, 'file');
      const report = importer.importProducts(parseCsvRecords(text), tenantId);
      res.redirect('/import', { type: report.errors.length > 0 ? 'danger' : 'ok', message: reportToMessage('produit(s)', report) });
    } catch (err) {
      res.redirect('/import', { type: 'danger', message: `Import impossible : ${err.message}` });
    }
  });

  router.post('/import/stock', async (req, res) => {
    const tenantId = getTenantId();
    try {
      const text = await readMultipartFile(req, 'file');
      const report = importer.importStock(parseCsvRecords(text), tenantId);
      res.redirect('/import', { type: report.errors.length > 0 ? 'danger' : 'ok', message: reportToMessage('reception(s) de stock', report) });
    } catch (err) {
      res.redirect('/import', { type: 'danger', message: `Import impossible : ${err.message}` });
    }
  });
}

module.exports = { register };
