// Database: Supabase Postgres (connection string in DATABASE_URL in .env).
// Works like the old SQLite version, except every call returns a promise:
//   await db.prepare('SELECT * FROM users WHERE id = ?').get(id)    -> one row or undefined
//   await db.prepare('SELECT ...').all(a, b)                         -> array of rows
//   await db.prepare('INSERT ...').run(a, b)                         -> { lastInsertRowid, changes }
// `?` placeholders are turned into Postgres' $1, $2, ... automatically.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL || '';
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('DATABASE_URL in .env is missing or still has [YOUR-PASSWORD] in it. Put your Supabase database password there.');
  process.exit(1);
}

// COUNT(*) and bigint columns arrive as strings by default; the app expects numbers
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

// Supabase needs SSL. Its certificate is signed by Supabase's own authority, which
// Node doesn't know, so the connection is encrypted without checking the certificate.
const pool = new pg.Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
pool.on('error', (err) => console.error('Database connection error:', err.message));

// "Today" in SQL means today where this server runs, like SQLite's 'localtime' did.
// Use ${TODAY} inside SQL strings (the time zone name is checked, so it's safe to put in SQL).
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const TODAY = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone) ? `local_today('${timeZone}')` : "local_today('UTC')";

// Inside transaction(), every query runs on the transaction's own connection
const txClient = new AsyncLocalStorage();
const conn = () => txClient.getStore() || pool;

// Tables with an `id` column: an INSERT into them reports the new id (lastInsertRowid)
const ID_TABLES = new Set(['users', 'projects', 'sections', 'tasks', 'subtasks', 'tags', 'project_invites', 'comments',
  'notifications', 'attachments', 'status_updates', 'portfolios', 'goals', 'rules']);

// `?` -> $1, $2, ... (skipping anything inside '...' strings)
function toPg(sql) {
  let n = 0;
  let out = '';
  let inString = false;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    out += ch === '?' && !inString ? `$${++n}` : ch;
  }
  const table = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(out)?.[1];
  if (table && ID_TABLES.has(table) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  return out;
}

// An id like "abc" or "99999999999" in a URL is simply "not found", like it was with SQLite
const BAD_INPUT = new Set(['22P02', '22003']);

async function query(sql, params) {
  try {
    return await conn().query(sql, params.map((p) => (p === undefined ? null : p)));
  } catch (err) {
    if (BAD_INPUT.has(err.code) && !txClient.getStore()) return { rows: [], rowCount: 0 };
    throw err;
  }
}

function prepare(sql) {
  const text = toPg(sql);
  return {
    get: async (...params) => (await query(text, params)).rows[0],
    all: async (...params) => (await query(text, params)).rows,
    run: async (...params) => {
      const result = await query(text, params);
      return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
    },
  };
}

// Run fn's queries all-or-nothing. Nested calls join the outer transaction.
export async function transaction(fn) {
  if (txClient.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Create or update the tables (safe to run every start)
await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const db = { prepare, transaction, pool };
export default db;
