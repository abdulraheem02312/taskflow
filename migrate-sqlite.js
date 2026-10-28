// One-time copy of the old SQLite database (data/asana.db) into Supabase Postgres.
// Usage: node --env-file=.env migrate-sqlite.js
// Keeps every id the same, so links, sessions and invites keep working.
// Stops without doing anything if Supabase already has users in it.
import { DatabaseSync } from 'node:sqlite';
import db, { transaction } from './db.js';

// Parents before children, so every foreign key already has its row
const TABLES = ['users', 'sessions', 'projects', 'sections', 'tasks', 'subtasks', 'tags', 'task_tags', 'project_members',
  'project_invites', 'comments', 'notifications', 'password_resets', 'attachments', 'status_updates', 'portfolios',
  'portfolio_projects', 'goals', 'goal_projects', 'rules', 'forms', 'task_dependencies', 'likes', 'my_task_state'];

const sqlite = new DatabaseSync('data/asana.db', { readOnly: true });
const { pool } = db;

if ((await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n > 0) {
  console.log('Supabase already has users in it, so nothing was copied (to avoid doubling everything).');
  process.exit(0);
}

const quote = (name) => `"${name}"`;

await transaction(async () => {
  for (const table of TABLES) {
    const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) continue;
    // Only columns both databases have
    const pgColumns = new Set((await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?").all(table))
      .map((c) => c.column_name));
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => pgColumns.has(c));
    const rows = sqlite.prepare(`SELECT ${columns.map(quote).join(', ')} FROM ${table}`).all();

    // 500 rows per INSERT
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = chunk.map((_, r) => `(${columns.map((__, c) => `$${r * columns.length + c + 1}`).join(', ')})`);
      const params = chunk.flatMap((row) => columns.map((c) => (typeof row[c] === 'bigint' ? Number(row[c]) : row[c])));
      await txQuery(`INSERT INTO ${table} (${columns.map(quote).join(', ')}) VALUES ${values.join(', ')}`, params);
    }
    console.log(`${table}: ${rows.length}`);

    // New rows continue after the highest copied id
    if (pgColumns.has('id')) {
      await txQuery(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`, []);
    }
  }
});

// Runs inside the transaction (db.prepare only takes ? placeholders, this has $n ones)
function txQuery(sql, params) {
  return db.prepare(sql.replace(/\$\d+/g, '?')).run(...params);
}

console.log('Done. Everything from data/asana.db is now in Supabase.');
await pool.end();
