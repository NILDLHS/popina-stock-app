// Connexion SQLite (node:sqlite, integre a Node >= 22.5, aucune dependance externe)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.APP_DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PRODUCTION','STORE','FRANCHISEE','CLIENT','WAREHOUSE')),
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  internal_site_id TEXT REFERENCES sites(id),
  contact_email TEXT,
  contact_phone TEXT,
  lead_time_days INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('RAW','SEMI','FINISHED')),
  unit_id TEXT NOT NULL REFERENCES units(id),
  category TEXT,
  is_sold_by_weight INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, sku)
);

-- Nomenclature / recette (BOM) : un produit SEMI ou FINISHED consomme des ingredients
CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  ingredient_product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id)
);

-- Lots de stock (tracabilite DLC/DLUO)
CREATE TABLE IF NOT EXISTS stock_lots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  lot_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id),
  expiry_date TEXT,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Journal des mouvements de stock (audit trail immuable)
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  lot_id TEXT REFERENCES stock_lots(id),
  type TEXT NOT NULL CHECK (type IN (
    'RECEPTION','PRODUCTION_CONSUME','PRODUCTION_OUTPUT',
    'TRANSFER_OUT','TRANSFER_IN','SALE_CONSUME','LOSS','INVENTORY_ADJUST'
  )),
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id),
  reference_type TEXT,
  reference_id TEXT,
  related_site_id TEXT REFERENCES sites(id),
  note TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_thresholds (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  min_quantity REAL NOT NULL,
  UNIQUE(site_id, product_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CANCELED')) DEFAULT 'DRAFT',
  expected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_ordered REAL NOT NULL,
  quantity_received REAL NOT NULL DEFAULT 0,
  unit_id TEXT NOT NULL REFERENCES units(id),
  unit_price REAL
);

CREATE TABLE IF NOT EXISTS production_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','DONE','CANCELED')) DEFAULT 'DRAFT',
  lot_number TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  from_site_id TEXT NOT NULL REFERENCES sites(id),
  to_site_id TEXT NOT NULL REFERENCES sites(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SENT','RECEIVED','CANCELED')) DEFAULT 'DRAFT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id),
  unit_price REAL
);

-- Integration Popina : une ligne par site connecte a une location Popina
CREATE TABLE IF NOT EXISTS popina_sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  popina_location_id TEXT NOT NULL,
  api_key TEXT,
  webhook_secret TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS popina_product_mapping (
  id TEXT PRIMARY KEY,
  popina_site_id TEXT NOT NULL REFERENCES popina_sites(id),
  popina_product_catalog_id TEXT NOT NULL,
  popina_product_name TEXT,
  product_id TEXT REFERENCES products(id),
  UNIQUE(popina_site_id, popina_product_catalog_id)
);

CREATE TABLE IF NOT EXISTS popina_sync_log (
  id TEXT PRIMARY KEY,
  popina_site_id TEXT REFERENCES popina_sites(id),
  event_type TEXT,
  webhook_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('OK','ERROR','IGNORED','UNMAPPED')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_log_webhook_id ON popina_sync_log(webhook_id);
`;

db.exec(SCHEMA);

// Migration : ajout de is_active sur products (colonne absente des bases creees avant cette version)
const productCols = db.prepare("PRAGMA table_info(products)").all();
if (!productCols.some((c) => c.name === 'is_active')) {
  db.exec('ALTER TABLE products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
}

// Expose le chemin du fichier (pour la sauvegarde telechargeable, voir routes/import.js) sans
// changer la forme de l'export existant (tout le reste du code fait `const db = require('../lib/db')`).
db.DB_PATH = DB_PATH;

module.exports = db;
