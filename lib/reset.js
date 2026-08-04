const fs = require('node:fs');
const path = require('node:path');
const dbPath = path.join(__dirname, '..', 'data', 'app.db');
for (const suffix of ['', '-shm', '-wal']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log('Base reinitialisee. Lance `npm run seed` pour repeupler les donnees de demo.');
