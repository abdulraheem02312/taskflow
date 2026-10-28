// File storage: Supabase Storage (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env).
// Files go in one private bucket. Only this server can read or write it, using the
// secret key; the browser always goes through the server, which checks who is asking.

const BASE = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
export const BUCKET = 'attachments';
export const storageReady = !!(BASE && KEY);

function call(path, { headers = {}, ...options } = {}) {
  // New secret keys (sb_secret_...) go in the apikey header only; the old service_role key is a JWT and goes in both
  const auth = KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {};
  return fetch(`${BASE}/storage/v1/${path}`, { ...options, headers: { apikey: KEY, ...auth, ...headers } });
}

async function check(response, what) {
  if (response.ok) return response;
  const err = new Error(`${what} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  err.status = response.status;
  throw err;
}

const json = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Make the private bucket if it isn't there yet, with the size limit set on it too
export async function ensureBucket(maxBytes) {
  const settings = { public: false, file_size_limit: maxBytes };
  const existing = await call(`bucket/${BUCKET}`);
  if (existing.ok) {
    await check(await call(`bucket/${BUCKET}`, { method: 'PUT', ...json({ id: BUCKET, ...settings }) }), 'Updating the storage bucket');
    return;
  }
  await check(await call('bucket', { method: 'POST', ...json({ id: BUCKET, name: BUCKET, ...settings }) }), 'Creating the storage bucket');
}

// body can be a stream (async iterable), so a file never has to fit in memory
export async function putObject(name, body) {
  await check(await call(`object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' },
    body,
    duplex: 'half',
  }), 'Uploading the file');
}

// The fetch Response, so the caller can stream response.body
export async function getObject(name) {
  return check(await call(`object/${BUCKET}/${name}`), 'Downloading the file');
}

export async function listObjects() {
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await check(await call(`object/list/${BUCKET}`, {
      method: 'POST', ...json({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    }), 'Listing files');
    const page = await response.json();
    names.push(...page.filter((o) => o.id).map((o) => o.name)); // entries without an id are folders
    if (page.length < 1000) return names;
  }
}

export async function removeObjects(names) {
  for (let i = 0; i < names.length; i += 1000) {
    await check(await call(`object/${BUCKET}`, { method: 'DELETE', ...json({ prefixes: names.slice(i, i + 1000) }) }), 'Deleting files');
  }
}
