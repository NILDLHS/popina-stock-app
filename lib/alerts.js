const db = require('./db');
const { daysUntil } = require('./util');

function listLowStockAlerts() {
  return db.prepare(`
    SELECT * FROM (
      SELECT t.id as threshold_id, s.id as site_id, s.name as site_name, p.id as product_id, p.name as product_name,
             u.code as unit_code, t.min_quantity,
             COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.site_id = s.id AND m.product_id = p.id), 0) as current_qty
      FROM stock_thresholds t
      JOIN sites s ON s.id = t.site_id
      JOIN products p ON p.id = t.product_id
      JOIN units u ON u.id = p.unit_id
    ) sub
    WHERE current_qty < min_quantity
    ORDER BY (min_quantity - current_qty) DESC
  `).all();
}

function listExpiringLots(windowDays = 5) {
  const lots = db.prepare(`
    SELECT l.*, s.name as site_name, p.name as product_name, u.code as unit_code
    FROM stock_lots l
    JOIN sites s ON s.id = l.site_id
    JOIN products p ON p.id = l.product_id
    JOIN units u ON u.id = l.unit_id
    WHERE l.quantity > 0.0001 AND l.expiry_date IS NOT NULL
    ORDER BY l.expiry_date ASC
  `).all();
  return lots
    .map((l) => ({ ...l, days_left: daysUntil(l.expiry_date) }))
    .filter((l) => l.days_left !== null && l.days_left <= windowDays);
}

function listUnmappedPopinaEvents(limit = 20) {
  return db.prepare(`
    SELECT * FROM popina_sync_log WHERE status IN ('UNMAPPED','ERROR') ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = { listLowStockAlerts, listExpiringLots, listUnmappedPopinaEvents };
