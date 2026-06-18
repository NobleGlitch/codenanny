/**
 * Idempotent post-schema migrations.
 *
 * plugkit re-runs every schema.sql block on every boot, so plain
 * `ALTER TABLE ADD COLUMN` would fail on subsequent starts (sqlite has no
 * native `IF NOT EXISTS` for ADD COLUMN). We use PRAGMA table_info to detect
 * what's already there and only add what's missing.
 */
export function migrateSchema(db) {
  addColumnIfMissing(db, 'session_files', 'turn_uuid', 'TEXT');
}

function addColumnIfMissing(db, table, column, type) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
