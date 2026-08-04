const { esc } = require('./util');

const NAV = [
  { group: 'Pilotage', items: [
    { href: '/', label: 'Tableau de bord' },
    { href: '/movements', label: 'Mouvements de stock' },
  ]},
  { group: 'Referentiels', items: [
    { href: '/sites', label: 'Sites' },
    { href: '/products', label: 'Produits & recettes' },
    { href: '/suppliers', label: 'Fournisseurs' },
    { href: '/import', label: 'Import CSV' },
  ]},
  { group: 'Operations', items: [
    { href: '/stock', label: 'Stock par site' },
    { href: '/purchase-orders', label: 'Commandes fournisseurs' },
    { href: '/production', label: 'Production' },
    { href: '/transfers', label: 'Transferts inter-sites' },
  ]},
  { group: 'Integration Popina', items: [
    { href: '/popina/sites', label: 'Sites connectes' },
    { href: '/popina/mapping', label: 'Mapping produits' },
    { href: '/popina/log', label: 'Journal de synchro' },
  ]},
];

function layout({ title, activePath, body, flash }) {
  const navHtml = NAV.map((section) => `
    <div class="group-label">${esc(section.group)}</div>
    ${section.items.map((item) => `<a href="${item.href}" class="${item.href === activePath ? 'active' : ''}">${esc(item.label)}</a>`).join('')}
  `).join('');

  const flashHtml = flash ? `<div class="alert alert-${flash.type}">${esc(flash.message)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · Gestion de stock</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">Stock Multi-Sites<small>MVP &middot; Groupe demo &middot; integration Popina</small></div>
      <nav>${navHtml}</nav>
    </aside>
    <main class="main">
      ${flashHtml}
      ${body}
    </main>
  </div>
</body>
</html>`;
}

function siteTypeBadge(type) {
  const map = {
    PRODUCTION: ['badge-blue', 'Production'],
    STORE: ['badge-green', 'Magasin'],
    FRANCHISEE: ['badge-orange', 'Franchise'],
    CLIENT: ['badge-gray', 'Client externe'],
    WAREHOUSE: ['badge-gray', 'Entrepot'],
  };
  const [cls, label] = map[type] || ['badge-gray', type];
  return `<span class="badge ${cls}">${label}</span>`;
}

function productTypeBadge(type) {
  const map = {
    RAW: ['badge-gray', 'Matiere premiere'],
    SEMI: ['badge-blue', 'Semi-fini'],
    FINISHED: ['badge-green', 'Produit fini'],
  };
  const [cls, label] = map[type] || ['badge-gray', type];
  return `<span class="badge ${cls}">${label}</span>`;
}

function movementBadge(type) {
  const map = {
    RECEPTION: ['badge-green', 'Reception'],
    PRODUCTION_CONSUME: ['badge-orange', 'Conso. production'],
    PRODUCTION_OUTPUT: ['badge-blue', 'Sortie production'],
    TRANSFER_OUT: ['badge-orange', 'Transfert sortant'],
    TRANSFER_IN: ['badge-blue', 'Transfert entrant'],
    SALE_CONSUME: ['badge-gray', 'Vente (caisse)'],
    LOSS: ['badge-red', 'Perte'],
    INVENTORY_ADJUST: ['badge-orange', 'Ajustement inventaire'],
  };
  const [cls, label] = map[type] || ['badge-gray', type];
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(status) {
  const map = {
    DRAFT: ['badge-gray', 'Brouillon'],
    SENT: ['badge-blue', 'Envoye'],
    PARTIAL: ['badge-orange', 'Partiel'],
    RECEIVED: ['badge-green', 'Recu'],
    DONE: ['badge-green', 'Termine'],
    CANCELED: ['badge-red', 'Annule'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function syncStatusBadge(status) {
  const map = {
    OK: ['badge-green', 'OK'],
    ERROR: ['badge-red', 'Erreur'],
    IGNORED: ['badge-gray', 'Ignore'],
    UNMAPPED: ['badge-orange', 'Produit non mappe'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

module.exports = { layout, siteTypeBadge, productTypeBadge, movementBadge, statusBadge, syncStatusBadge };
