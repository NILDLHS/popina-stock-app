const http = require('node:http');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const querystring = require('node:querystring');

const Router = require('./lib/router');
const auth = require('./lib/auth');
const router = new Router();

require('./routes/dashboard').register(router);
require('./routes/sites').register(router);
require('./routes/products').register(router);
require('./routes/stock').register(router);
require('./routes/suppliers').register(router);
require('./routes/purchaseOrders').register(router);
require('./routes/production').register(router);
require('./routes/transfers').register(router);
require('./routes/movements').register(router);
require('./routes/popina').register(router);
require('./routes/import').register(router);

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

function parseFlash(query) {
  if (!query.flash) return null;
  const idx = query.flash.indexOf('|');
  if (idx === -1) return null;
  return { type: query.flash.slice(0, idx), message: query.flash.slice(idx + 1) };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname);

  // Authentification HTTP Basic (si BASIC_AUTH_USER/BASIC_AUTH_PASS sont definis, voir README) :
  // exclut les webhooks Popina, qui s'authentifient eux-memes par signature HMAC (lib/popina.js).
  if (auth.isEnabled() && !pathname.startsWith('/webhooks/popina/') && !auth.check(req)) {
    return auth.requireAuth(res);
  }

  // Fichiers statiques (CSS)
  if (req.method === 'GET' && pathname.startsWith('/') && MIME[path.extname(pathname)]) {
    const filePath = path.join(PUBLIC_DIR, pathname);
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath)) {
      res.setHeader('Content-Type', MIME[path.extname(pathname)]);
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  const match = router.match(req.method, pathname);
  if (!match) {
    res.statusCode = 404;
    res.end('Page introuvable : ' + pathname);
    return;
  }

  const query = querystring.parse(parsed.query || '');
  const ctx = { params: match.params, query, flash: parseFlash(query) };

  res.redirect = (destPath, flash) => {
    let dest = destPath;
    if (flash) {
      const sep = dest.includes('?') ? '&' : '?';
      dest += `${sep}flash=${encodeURIComponent(flash.type + '|' + flash.message)}`;
    }
    res.statusCode = 302;
    res.setHeader('Location', dest);
    res.end();
  };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    await match.handler(req, res, ctx);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Erreur serveur : ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur demarre sur http://localhost:${PORT}`);
  if (auth.isEnabled()) {
    console.log('Authentification HTTP Basic activee (BASIC_AUTH_USER/BASIC_AUTH_PASS).');
  } else {
    console.warn('ATTENTION : aucune authentification (BASIC_AUTH_USER/BASIC_AUTH_PASS non definis). Ne pas exposer publiquement en l\'etat.');
  }
});
