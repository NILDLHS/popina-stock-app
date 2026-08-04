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

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / (1000 * 60 * 60 * 24));
}

module.exports = { id, esc, fmtQty, fmtDate, fmtMoney, parseForm, parseJson, readBody, daysUntil };
