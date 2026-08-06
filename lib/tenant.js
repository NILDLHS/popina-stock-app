// Le modele de donnees est multi-tenant (voir README), mais un seul tenant existe reellement en V1.
// Il etait jusqu'ici uniquement cree par lib/seed.js : une base reinitialisee sans reseed n'avait
// alors aucun tenant, et toute creation (site, produit...) echouait avec une erreur SQLite peu claire.
// On le cree paresseusement au premier besoin pour ne jamais dependre de l'execution prealable du seed.
const db = require('./db');
const { id } = require('./util');

function getTenantId() {
  const row = db.prepare('SELECT id FROM tenants LIMIT 1').get();
  if (row) return row.id;
  const tenantId = id('tenant');
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, 'Mon groupe');
  return tenantId;
}

module.exports = { getTenantId };
