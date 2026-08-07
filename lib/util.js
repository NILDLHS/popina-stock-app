const crypto = require('node:crypto');
const querystring = require('node:querystring');

function id(prefix) {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtQty(n) {
  if (n === null || n === undefined) return '-';
  const r = Math.round(n * 1000) / 1000;
  return r.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function fmtDate(s) {
  if (!s) return '-';
  return s.slice(0, 10);
}

function fmtMoney(cents) {
  if (cents === null || cents === undefined) return '-';
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('Payload trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseForm(req) {
  const raw = await readBody(req);
  return querystring.parse(raw.toString('utf8'));
}

async function parseJson(req) {
  const raw = await readBody(req);
  return { raw: raw.toString('utf8'), json: raw.length ? JSON.parse(raw.toString('utf8')) : {} };
}

// "Mon site" memorise : pas de compte utilisateur, juste un confort pour retrouver son site
// habituel d'une page a l'autre (voir /stock et /purchase-orders/quick).
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setCookie(res, name, value) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / (1000 * 60 * 60 * 24));
}

module.exports = { id, esc, fmtQty, fmtDate, fmtMoney, parseForm, parseJson, readBody, daysUntil, getCookie, setCookie };
