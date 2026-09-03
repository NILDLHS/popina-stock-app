// Petit set d'icones SVG inline, dessinees a la main (traits simples, currentColor, 24x24 de base).
// Zero dependance externe (coherent avec le reste du projet) : pas de police d'icones ni de CDN.
const PATHS = {
  // Nav
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  movements: '<path d="M3 7h13M16 7l-3-3M16 7l-3 3"/><path d="M21 17H8M8 17l3 3M8 17l3-3"/>',
  sites: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>',
  products: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5L12 12l8-4.5"/><path d="M12 12v9"/>',
  suppliers: '<circle cx="8" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.6"/><path d="M2.5 20c.6-3.4 3-5.4 5.5-5.4s4.9 2 5.5 5.4"/><path d="M14.5 20c.4-2.4 1.8-4 3.6-4.4"/>',
  importcsv: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  orders: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  production: '<path d="M4 20l3-9 4 5 3-8 4 12"/><path d="M3 20h18"/>',
  transfers: '<path d="M3 7h11M11 3l4 4-4 4"/><path d="M21 17H10M13 13l-4 4 4 4"/>',
  popina: '<circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 118 0 4 4 0 01-8 0z"/>',

  // Actions / statuts
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".3" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  sync: '<path d="M3 12a9 9 0 0115-6.7M21 12a9 9 0 01-15 6.7"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  factory: '<path d="M3 21V10l5 3V10l5 3V10l5 3v8H3z"/><path d="M7 21v-4M12 21v-4M17 21v-4"/>',
  check: '<path d="M4 12l6 6L20 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

function icon(name, { size = 18, cls = '' } = {}) {
  const path = PATHS[name];
  if (!path) return '';
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

module.exports = { icon };
