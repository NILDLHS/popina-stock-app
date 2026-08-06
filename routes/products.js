const db = require('../lib/db');
const { getTenantId } = require('../lib/tenant');
const { layout, productTypeBadge } = require('../lib/render');
const { esc, id, parseForm, fmtQty } = require('../lib/util');
const stock = require('../lib/stock');

function register(router) {
  router.get('/products', (req, res, ctx) => {
    const products = db.prepare(`
      SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id = p.unit_id ORDER BY p.type, p.name
    `).all();
    const units = db.prepare('SELECT * FROM units').all();

    const body = `
      <div class="page-header">
        <div><h1>Produits &amp; recettes</h1><p class="subtitle">Referentiel matieres premieres / semi-finis / produits finis et nomenclatures (BOM)</p></div>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Catalogue (${products.length})</h2>
          <table class="compact">
            <thead><tr><th>SKU</th><th>Nom</th><th>Type</th><th>Categorie</th><th>Unite</th><th>Statut</th><th></th><th></th></tr></thead>
            <tbody>
              ${products.map((p) => {
                const usage = stock.getProductUsage(p.id);
                return `
                <tr>
                  <td class="mono">${esc(p.sku)}</td>
                  <td>${esc(p.name)}${p.is_sold_by_weight ? ' <span class="badge badge-gray">au poids</span>' : ''}</td>
                  <td>${productTypeBadge(p.type)}</td>
                  <td class="muted">${esc(p.category || '-')}</td>
                  <td class="mono muted">${esc(p.unit_code)}</td>
                  <td>${p.is_active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
                  <td><a href="/products/${p.id}">Recette &amp; details &rarr;</a></td>
                  <td class="row-actions">
                    <form method="POST" action="/products/${p.id}/toggle-active">
                      <button class="btn btn-secondary btn-sm" type="submit">${p.is_active ? 'Desactiver' : 'Reactiver'}</button>
                    </form>
                    ${usage.total === 0
                      ? `<form method="POST" action="/products/${p.id}/delete" onsubmit="return confirm('Supprimer definitivement le produit \\'${esc(p.name).replace(/'/g, "\\'")}\\' ? Cette action est irreversible.');">
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
          <h2>Nouveau produit</h2>
          <form method="POST" action="/products">
            <div class="form-row">
              <div class="field"><label>SKU</label><input name="sku" required placeholder="Ex: FARINE" /></div>
              <div class="field"><label>Nom</label><input name="name" required placeholder="Ex: Farine T55" /></div>
            </div>
            <div class="form-row">
              <div class="field">
                <label>Type</label>
                <select name="type" required>
                  <option value="RAW">Matiere premiere</option>
                  <option value="SEMI">Semi-fini</option>
                  <option value="FINISHED">Produit fini (vendu en caisse)</option>
                </select>
              </div>
              <div class="field">
                <label>Unite</label>
                <select name="unit_id" required>
                  ${units.map((u) => `<option value="${u.id}">${esc(u.label)} (${u.code})</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field"><label>Categorie</label><input name="category" placeholder="Ex: Epicerie" /></div>
            <div class="field">
              <label><input type="checkbox" name="is_sold_by_weight" value="1" style="width:auto;display:inline-block;margin-right:6px" />Vendu au poids (ex: buffet, cereales)</label>
            </div>
            <button class="btn" type="submit">Creer le produit</button>
          </form>
        </div>
      </div>
    `;
    res.end(layout({ title: 'Produits', activePath: '/products', body, flash: ctx.flash }));
  });

  router.post('/products', async (req, res) => {
    const form = await parseForm(req);
    const tenantId = getTenantId();
    db.prepare('INSERT INTO products (id, tenant_id, sku, name, type, unit_id, category, is_sold_by_weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id('prod'), tenantId, form.sku.toUpperCase(), form.name, form.type, form.unit_id, form.category || null, form.is_sold_by_weight ? 1 : 0);
    res.redirect('/products', { type: 'ok', message: `Produit "${form.name}" cree.` });
  });

  router.get('/products/:id', (req, res, ctx) => {
    const product = db.prepare('SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = ?').get(ctx.params.id);
    if (!product) { res.statusCode = 404; return res.end('Produit introuvable'); }
    const recipe = stock.getRecipe(product.id);
    const allIngredients = db.prepare(`SELECT p.*, u.code as unit_code FROM products p JOIN units u ON u.id = p.unit_id WHERE p.type != 'FINISHED' AND p.id != ? AND p.is_active = 1 ORDER BY p.name`).all(product.id);
    const units = db.prepare('SELECT * FROM units').all();

    const body = `
      <div class="page-header">
        <div><h1>${esc(product.name)}</h1><p class="subtitle mono">${esc(product.sku)} &middot; ${productTypeBadge(product.type)}</p></div>
        <a href="/products" class="btn btn-secondary">&larr; Retour au catalogue</a>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Nomenclature / recette (BOM)</h2>
          ${recipe.length === 0 ? '<p class="empty">Aucune recette : ce produit est consomme directement (article de revente simple).</p>' : `
          <table class="compact">
            <thead><tr><th>Ingredient</th><th>Quantite par unite produite/vendue</th></tr></thead>
            <tbody>
              ${recipe.map((r) => `<tr><td>${esc(r.ingredient_name)} <span class="mono muted">(${esc(r.ingredient_sku)})</span></td><td class="mono">${fmtQty(r.quantity)} ${r.unit_code}</td></tr>`).join('')}
            </tbody>
          </table>`}
          ${product.type === 'RAW' ? '<p class="hint muted" style="margin-top:10px">Les matieres premieres ne portent pas de recette : elles sont elles-memes des ingredients.</p>' : `
          <hr class="sep" />
          <h3>Ajouter un ingredient</h3>
          <form method="POST" action="/products/${product.id}/recipe">
            <div class="form-row">
              <div class="field">
                <label>Ingredient</label>
                <select name="ingredient_product_id" required>
                  ${allIngredients.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.sku)})</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Quantite (pour 1 unite produite/vendue)</label><input name="quantity" type="number" step="0.0001" required /></div>
              <div class="field">
                <label>Unite</label>
                <select name="unit_id" required>${units.map((u) => `<option value="${u.id}">${esc(u.code)}</option>`).join('')}</select>
              </div>
            </div>
            <button class="btn" type="submit">Ajouter a la recette</button>
          </form>`}
        </div>
        <div class="panel">
          <h3>Fiche produit</h3>
          <table class="compact">
            <tr><td class="muted">Type</td><td>${productTypeBadge(product.type)}</td></tr>
            <tr><td class="muted">Categorie</td><td>${esc(product.category || '-')}</td></tr>
            <tr><td class="muted">Unite de stock</td><td class="mono">${esc(product.unit_code)}</td></tr>
            <tr><td class="muted">Vendu au poids</td><td>${product.is_sold_by_weight ? 'Oui' : 'Non'}</td></tr>
          </table>
        </div>
      </div>
    `;
    res.end(layout({ title: product.name, activePath: '/products', body, flash: ctx.flash }));
  });

  router.post('/products/:id/recipe', async (req, res, ctx) => {
    const form = await parseForm(req);
    db.prepare('INSERT INTO recipe_items (id, product_id, ingredient_product_id, quantity, unit_id) VALUES (?, ?, ?, ?, ?)')
      .run(id('ri'), ctx.params.id, form.ingredient_product_id, parseFloat(form.quantity), form.unit_id);
    res.redirect(`/products/${ctx.params.id}`, { type: 'ok', message: 'Ingredient ajoute a la recette.' });
  });

  router.post('/products/:id/toggle-active', (req, res, ctx) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!product) { res.statusCode = 404; return res.end('Produit introuvable'); }
    db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(product.is_active ? 0 : 1, product.id);
    res.redirect('/products', { type: 'ok', message: `Produit "${product.name}" ${product.is_active ? 'desactive' : 'reactive'}.` });
  });

  router.post('/products/:id/delete', (req, res, ctx) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!product) { res.statusCode = 404; return res.end('Produit introuvable'); }
    const usage = stock.getProductUsage(product.id);
    if (usage.total > 0) {
      return res.redirect('/products', { type: 'danger', message: `Impossible de supprimer "${product.name}" : encore reference ailleurs (${usage.details.map(([label, n]) => `${label}: ${n}`).join(', ')}). Desactivez-le a la place.` });
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    res.redirect('/products', { type: 'ok', message: `Produit "${product.name}" supprime definitivement.` });
  });
}

module.exports = { register };
