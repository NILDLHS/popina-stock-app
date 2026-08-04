// Authentification HTTP Basic minimale, a activer via variables d'environnement avant tout
// hebergement partage (l'app n'a pas de RBAC en V1, voir README). Sans dependance externe.
const crypto = require('node:crypto');

function isEnabled() {
  return Boolean(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verifie l'en-tete Authorization: Basic. Retourne true si valide, false sinon.
function check(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return safeEqual(user, process.env.BASIC_AUTH_USER) && safeEqual(pass, process.env.BASIC_AUTH_PASS);
}

function requireAuth(res) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="Stock Multi-Sites", charset="UTF-8"');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Authentification requise.');
}

module.exports = { isEnabled, check, requireAuth };
