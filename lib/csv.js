// Parseur/generateur CSV minimal (RFC4180 : guillemets, virgules et retours ligne dans les champs),
// sans dependance externe (coherent avec le reste de l'app, voir README).

// Excel en localisation francaise exporte le CSV avec des points-virgules (la virgule etant deja
// le separateur decimal) : on detecte le separateur reellement utilise plutot que de supposer une virgule.
function detectDelimiter(text) {
  const firstLine = (text.split(/\r\n|\n|\r/)[0] || '');
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCsv(text, delimiter) {
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Transforme un CSV avec en-tete en tableau d'objets {colonne: valeur}, valeurs "trimmees".
function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function csvValue(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvValue).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsvRecords, toCsv };
