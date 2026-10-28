import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import db, { transaction, TODAY } from './db.js';
import {
  hashPassword, checkPassword, createSession, destroySession, destroyOtherSessions, destroyAllSessions,
  currentUser, requireUser,
} from './auth.js';
import { sendPasswordResetEmail } from './mail.js';
import { storageReady, ensureBucket, putObject, getObject, listObjects, removeObjects } from './storage.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Set in the .env file. Empty means the "Continue with Google" button stays hidden.
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClient = new OAuth2Client();

app.use(express.json());

// Clean URLs: /login.html -> /login
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5).replace(/\/index$/, '/');
    return res.redirect(301, clean || '/');
  }
  next();
});

// ---------- Pages ----------

// Public website home page (Features is served from public/ as /features)
app.get('/', (req, res) => res.sendFile('index.html', { root: 'public' }));
app.get('/index', (req, res) => res.redirect(301, '/'));
// Browsers ask for /favicon.ico on their own; point them to the real icon
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.png'));

// The app is one page; /app, /app/my-tasks and /app/projects/12 all load it,
// and the browser-side router shows the right screen
app.get('/app{/*rest}', async (req, res) => {
  if (!(await currentUser(req))) return res.redirect('/login');
  res.sendFile('app.html', { root: 'public' });
});

// Public project forms: /form/<token> (anyone with the link, no login)
app.get('/form/:token', (req, res) => res.sendFile('form.html', { root: 'public' }));

app.get(['/login', '/signup'], async (req, res, next) => {
  if (await currentUser(req)) return res.redirect('/app');
  // Google's sign-in button needs this when the site runs on http://localhost
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  next();
});

app.use(express.static('public', { extensions: ['html'], index: false }));

// ---------- Auth API ----------

app.post('/api/signup', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const exists = await db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);
  if (exists) {
    const error = exists.password_hash
      ? 'An account with this email already exists'
      : 'This email is already signed up with Google. Use "Continue with Google".';
    return res.status(409).json({ error });
  }

  const { lastInsertRowid } = await db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hashPassword(password));
  const userId = Number(lastInsertRowid);

  // Give every new user a starter project, and join any projects they were invited to
  await createProject(userId, 'My first project', '#a78bfa');
  await acceptInvites(userId, email);

  await createSession(res, userId);
  res.status(201).json({ id: userId, name, email });
});

app.post('/api/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user && !user.password_hash) {
    return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google".' });
  }
  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  await createSession(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email });
});

// Tells the login page whether Google sign-in is set up (the Client ID is public, not a secret)
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// "Continue with Google": the browser sends the ID token Google gave it.
// We check with Google that the token is real and made for our Client ID,
// then log in the matching user, or create one.
app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not set up yet' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: String(req.body.credential || ''),
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
  if (!payload.email || !payload.email_verified) {
    return res.status(401).json({ error: 'Your Google account email is not verified' });
  }

  const email = payload.email.toLowerCase();
  let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(payload.sub)
    || await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (user && !user.google_id) {
    // Existing email/password account with the same (Google-verified) email: link them
    await db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(payload.sub, user.id);
  }

  if (!user) {
    const name = String(payload.name || email.split('@')[0]).slice(0, 80);
    const { lastInsertRowid } = await db.prepare(
      "INSERT INTO users (name, email, password_hash, google_id) VALUES (?, ?, '', ?)",
    ).run(name, email, payload.sub);
    await createProject(Number(lastInsertRowid), 'My first project', '#a78bfa');
    await acceptInvites(Number(lastInsertRowid), email);
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  }

  await createSession(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.post('/api/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

// ---------- Account settings ----------

app.get('/api/me', requireUser, async (req, res) => {
  const row = await db.prepare('SELECT password_hash, google_id, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ ...req.user, has_password: !!row.password_hash, google: !!row.google_id, created_at: row.created_at });
});

app.patch('/api/me', requireUser, async (req, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Your name cannot be empty' });
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ ...req.user, name });
});

// Change your password (or set one, if you only used Google so far).
// Other devices are logged out, this one stays logged in.
app.post('/api/me/password', requireUser, async (req, res) => {
  const { password_hash: current } = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const password = String(req.body.password || '');
  if (current && !checkPassword(String(req.body.current || ''), current)) {
    return res.status(401).json({ error: 'Your current password is not right' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
  res.json({ ok: true, signedOut: await destroyOtherSessions(req, req.user.id) });
});

// Home page: widget layout and private notepad, saved with the account (so every device gets them)
const HOME_WIDGETS = ['overview', 'my-tasks', 'assigned', 'people', 'projects', 'notepad'];

app.get('/api/me/home', requireUser, async (req, res) => {
  const row = await db.prepare('SELECT home_layout, notepad FROM users WHERE id = ?').get(req.user.id);
  let layout = null;
  try { layout = JSON.parse(row.home_layout); } catch { /* never saved: the browser uses the default */ }
  res.json({ layout, notepad: row.notepad });
});

app.put('/api/me/home', requireUser, async (req, res) => {
  const { layout, notepad } = req.body;
  if (layout !== undefined) {
    // Only known widgets, each once, with a known size
    const seen = new Set();
    const clean = (Array.isArray(layout) ? layout : []).filter((w) => {
      if (!w || !HOME_WIDGETS.includes(w.id) || seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    }).map((w) => ({ id: w.id, size: w.size === 'full' ? 'full' : 'half', hidden: !!w.hidden }));
    if (!clean.length) return res.status(400).json({ error: 'Invalid layout' });
    await db.prepare('UPDATE users SET home_layout = ? WHERE id = ?').run(JSON.stringify(clean), req.user.id);
  }
  if (notepad !== undefined) {
    await db.prepare('UPDATE users SET notepad = ? WHERE id = ?').run(String(notepad).slice(0, 10000), req.user.id);
  }
  res.json({ ok: true });
});

// Everyone you share a project with (and you), for the People widget
app.get('/api/people', requireUser, async (req, res) => {
  res.json(await db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
    WHERE u.id IN (
      SELECT m.user_id FROM project_members m
      WHERE m.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
    )
    ORDER BY u.id = ? DESC, u.name
  `).all(req.user.id, req.user.id));
});

app.post('/api/me/logout-others', requireUser, async (req, res) => {
  res.json({ signedOut: await destroyOtherSessions(req, req.user.id) });
});

// Delete the account. Projects you own are deleted for everyone in them.
app.delete('/api/me', requireUser, async (req, res) => {
  if (String(req.body.confirm || '').trim().toLowerCase() !== req.user.email) {
    return res.status(400).json({ error: 'Type your email exactly to confirm' });
  }
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  sweepUploads(); // files on tasks of the deleted projects
  res.clearCookie('session');
  res.json({ ok: true });
});

// ---------- Forgot / reset password ----------

const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const RESET_MINUTES = 30;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Always the same answer, whether or not the email has an account,
// so this can't be used to find out who uses Taskflow
app.post('/api/password/forgot', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  res.json({ ok: true });

  try {
    const user = await db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) return;
    const recent = await db.prepare('SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > ?').get(user.id, Date.now() - 60000);
    if (recent) return; // at most one link a minute

    const token = randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id); // only the newest link works
    await db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, Date.now() + RESET_MINUTES * 60000, Date.now());
    await sendPasswordResetEmail(user, `${APP_URL}/reset-password?token=${token}`, RESET_MINUTES);
  } catch (err) {
    console.error('Could not send the reset email:', err.message);
  }
});

async function findReset(token) {
  const row = await db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token || '')));
  return row && row.expires_at > Date.now() ? row : null;
}

// The reset page asks first, so it can show "link expired" before you type anything
app.get('/api/password/reset', async (req, res) => {
  const row = await findReset(req.query.token);
  if (!row) return res.json({ valid: false });
  res.json({ valid: true, email: (await db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id)).email });
});

app.post('/api/password/reset', async (req, res) => {
  const row = await findReset(req.body.token);
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters' });

  await transaction(async () => {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id); // the link is used up
    await destroyAllSessions(row.user_id); // anyone logged in with the old password is logged out
  });
  await createSession(res, row.user_id);
  res.json({ ok: true });
});

// ---------- Projects API ----------

const DEFAULT_SECTIONS = ['To do', 'Doing', 'Done'];

// A project the user is a member of, with their role ('owner' or 'member'), or undefined
function findProject(projectId, userId) {
  return db.prepare(`
    SELECT p.*, m.role, m.favorite FROM projects p
    JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
    WHERE p.id = ?
  `).get(userId, projectId);
}

async function isMember(projectId, userId) {
  return !!(await db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId));
}

async function createProject(userId, name, color) {
  return transaction(async () => {
    const { lastInsertRowid } = await db.prepare('INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)')
      .run(userId, name, color);
    await db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").run(lastInsertRowid, userId);
    await ensureSections(lastInsertRowid);
    return lastInsertRowid;
  });
}

// Every project needs at least one section, and every task must sit in one.
// Fixes up projects and tasks created before the board view existed.
async function ensureSections(projectId) {
  const list = db.prepare('SELECT * FROM sections WHERE project_id = ? ORDER BY position, id');
  let sections = await list.all(projectId);
  if (sections.length === 0) {
    const insert = db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)');
    for (const [i, name] of DEFAULT_SECTIONS.entries()) await insert.run(projectId, name, i);
    sections = await list.all(projectId);
  }
  await db.prepare('UPDATE tasks SET section_id = ? WHERE project_id = ? AND section_id IS NULL')
    .run(sections[0].id, projectId);
  return sections;
}

function findSection(sectionId, userId) {
  return db.prepare(`
    SELECT s.* FROM sections s
    JOIN project_members m ON m.project_id = s.project_id AND m.user_id = ?
    WHERE s.id = ?
  `).get(userId, sectionId);
}

async function nextTaskPosition(sectionId) {
  return (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE section_id = ?')
    .get(sectionId)).pos;
}

app.get('/api/projects', requireUser, async (req, res) => {
  const projects = await db.prepare(`
    SELECT p.*, m.role, m.favorite,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 0) AS open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total_tasks,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
      -- "My Tasks": open tasks assigned to me, or unassigned ones in a project only I am in
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 0 AND (
        t.assignee_id = m.user_id OR (t.assignee_id IS NULL AND
          (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) = 1)
      )) AS my_open,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 0
        AND t.due_date IS NOT NULL AND t.due_date < ${TODAY}) AS overdue_tasks,
      (SELECT name FROM users u WHERE u.id = p.user_id) AS owner_name,
      (SELECT MAX(t.created_at) FROM tasks t WHERE t.project_id = p.id) AS last_task_at,
      (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name))::text, '[]') FROM (
        SELECT u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = p.id ORDER BY pm.role = 'owner' DESC, u.id LIMIT 4) x) AS members_json
    FROM projects p
    JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
    ORDER BY p.id
  `).all(req.user.id);
  for (const p of projects) {
    p.members = JSON.parse(p.members_json || '[]');
    delete p.members_json;
  }
  res.json(projects);
});

app.post('/api/projects', requireUser, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : '#60a5fa';
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const projectId = await createProject(req.user.id, name, color);
  res.status(201).json(await findProject(projectId, req.user.id));
});

app.patch('/api/projects/:id', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.role !== 'owner') return res.status(403).json({ error: 'Only the project owner can rename it' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : project.name;
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : project.color;
  const due = req.body.due_date !== undefined ? cleanDate(req.body.due_date) : project.due_date;
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : project.archived;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  await db.prepare('UPDATE projects SET name = ?, color = ?, due_date = ?, archived = ? WHERE id = ?').run(name, color, due, archived, project.id);
  res.json(await findProject(project.id, req.user.id));
});

app.delete('/api/projects/:id', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.role !== 'owner') return res.status(403).json({ error: 'Only the project owner can delete it' });
  await db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  sweepUploads();
  res.json({ ok: true });
});

// ---------- Members and invites API ----------

function projectMembers(projectId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY m.role = 'owner' DESC, u.name
  `).all(projectId);
}

// When someone signs up, the invites waiting for their email turn into memberships
async function acceptInvites(userId, email) {
  const invites = await db.prepare('SELECT * FROM project_invites WHERE email = ?').all(email);
  for (const invite of invites) {
    await db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT DO NOTHING")
      .run(invite.project_id, userId);
    await notify(userId, invite.invited_by, 'added', { projectId: invite.project_id });
  }
  await db.prepare('DELETE FROM project_invites WHERE email = ?').run(email);
}

app.get('/api/projects/:id/members', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const invites = await db.prepare('SELECT id, email, created_at FROM project_invites WHERE project_id = ? ORDER BY id')
    .all(project.id);
  res.json({ members: await projectMembers(project.id), invites, role: project.role });
});

// Any member can invite. Existing users join right away; other emails get a pending invite.
// (No email is sent: the person signs up with that email to join.)
app.post('/api/projects/:id/members', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  const user = await db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
  if (user) {
    if (await isMember(project.id, user.id)) return res.status(409).json({ error: `${user.name} is already in this project` });
    await db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')").run(project.id, user.id);
    await notify(user.id, req.user.id, 'added', { projectId: project.id });
    return res.status(201).json({ added: user });
  }

  const invited = await db.prepare('SELECT 1 FROM project_invites WHERE project_id = ? AND email = ?').get(project.id, email);
  if (invited) return res.status(409).json({ error: 'This email is already invited' });
  await db.prepare('INSERT INTO project_invites (project_id, email, invited_by) VALUES (?, ?, ?)').run(project.id, email, req.user.id);
  res.status(201).json({ invited: email });
});

// The owner can remove anyone except themselves; a member can remove only themselves (leave)
app.delete('/api/projects/:id/members/:userId', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const targetId = Number(req.params.userId);
  const leaving = targetId === req.user.id;
  if (!leaving && project.role !== 'owner') {
    return res.status(403).json({ error: 'Only the project owner can remove people' });
  }
  const target = await db.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, targetId);
  if (!target) return res.status(404).json({ error: 'That person is not in this project' });
  if (target.role === 'owner') {
    return res.status(400).json({ error: leaving ? "The owner can't leave. Delete the project instead." : "The owner can't be removed" });
  }

  await transaction(async () => {
    await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, targetId);
    // Their tasks in this project go back to unassigned
    await db.prepare('UPDATE tasks SET assignee_id = NULL, assigned_by = NULL WHERE project_id = ? AND assignee_id = ?').run(project.id, targetId);
  });
  res.json({ ok: true });
});

app.delete('/api/projects/:id/invites/:inviteId', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { changes } = await db.prepare('DELETE FROM project_invites WHERE id = ? AND project_id = ?')
    .run(req.params.inviteId, project.id);
  if (!changes) return res.status(404).json({ error: 'Invite not found' });
  res.json({ ok: true });
});

// ---------- Sections (board columns) API ----------

app.get('/api/projects/:id/sections', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await ensureSections(project.id));
});

app.post('/api/projects/:id/sections', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Section name is required' });
  const { pos } = await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM sections WHERE project_id = ?')
    .get(project.id);
  const { lastInsertRowid } = await db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)')
    .run(project.id, name, pos);
  res.status(201).json(await findSection(lastInsertRowid, req.user.id));
});

app.patch('/api/sections/:id', requireUser, async (req, res) => {
  const section = await findSection(req.params.id, req.user.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Section name is required' });
  await db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, section.id);
  res.json(await findSection(section.id, req.user.id));
});

// Deleting a section keeps its tasks: they move to the end of the first other section
app.delete('/api/sections/:id', requireUser, async (req, res) => {
  const section = await findSection(req.params.id, req.user.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  const target = await db.prepare('SELECT * FROM sections WHERE project_id = ? AND id != ? ORDER BY position, id')
    .get(section.project_id, section.id);
  if (!target) return res.status(400).json({ error: 'A project needs at least one section' });

  await transaction(async () => {
    // One query moves them all, keeping their order
    await db.prepare(`
      UPDATE tasks SET section_id = ?, position = ? + moving.n - 1
      FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM tasks WHERE section_id = ?) moving
      WHERE tasks.id = moving.id
    `).run(target.id, await nextTaskPosition(target.id), section.id);
    await db.prepare('DELETE FROM sections WHERE id = ?').run(section.id);
  });
  res.json({ ok: true });
});

// ---------- Tasks API ----------

const PRIORITIES = ['low', 'medium', 'high'];
const REPEATS = ['daily', 'weekly', 'monthly'];

// Every task sent to the browser also carries its tags, subtask progress,
// assignee name and number of comments
const TASK_FIELDS = `
  t.*,
  (SELECT COALESCE(json_agg(tag_id)::text, '[]') FROM task_tags WHERE task_id = t.id) AS tag_ids,
  (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) AS subtasks_total,
  (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) AS subtasks_done,
  (SELECT name FROM users WHERE id = t.assignee_id) AS assignee_name,
  (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count,
  (SELECT COUNT(*) FROM attachments WHERE task_id = t.id) AS attachment_count,
  (SELECT COUNT(*) FROM task_dependencies d JOIN tasks b ON b.id = d.blocked_by_id WHERE d.task_id = t.id AND b.completed = 0) AS blocked_count,
  (SELECT COUNT(*) FROM likes WHERE kind = 'task' AND item_id = t.id) AS like_count
`;

function parseTask(task) {
  if (task) task.tag_ids = JSON.parse(task.tag_ids);
  return task;
}

async function findTask(taskId, userId) {
  return parseTask(await db.prepare(`
    SELECT ${TASK_FIELDS} FROM tasks t
    JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?
    WHERE t.id = ?
  `).get(userId, taskId));
}

// Add an inbox notification for someone (never for the person who did the action)
async function notify(userId, actorId, type, { projectId = null, taskId = null, body = null } = {}) {
  if (!userId || userId === actorId) return;
  await db.prepare('INSERT INTO notifications (user_id, actor_id, type, project_id, task_id, body) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, actorId, type, projectId, taskId, body);
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

app.get('/api/projects/:id/tasks', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await ensureSections(project.id);
  res.json(await projectTasks(project.id));
});

async function projectTasks(projectId) {
  return (await db.prepare(`SELECT ${TASK_FIELDS} FROM tasks t WHERE t.project_id = ? ORDER BY t.completed, t.id`)
    .all(projectId)).map(parseTask);
}

app.post('/api/projects/:id/tasks', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title is required' });

  // No section given (list view): use the project's first section
  const sections = await ensureSections(project.id);
  const section = sections.find((s) => s.id === Number(req.body.section_id)) || sections[0];

  const { lastInsertRowid } = await db.prepare(`
    INSERT INTO tasks (project_id, title, due_date, section_id, position) VALUES (?, ?, ?, ?, ?)
  `).run(project.id, title, cleanDate(req.body.due_date), section.id, await nextTaskPosition(section.id));
  await applyRules(Number(lastInsertRowid), [{ type: 'added', sectionId: section.id }]);
  res.status(201).json(await findTask(lastInsertRowid, req.user.id));
});

// Drag and drop: put a task at `index` inside `section_id`, then renumber that column
app.post('/api/tasks/:id/move', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const section = await findSection(req.body.section_id, req.user.id);
  if (!section || section.project_id !== task.project_id) {
    return res.status(400).json({ error: 'Invalid section' });
  }

  const ids = (await db.prepare('SELECT id FROM tasks WHERE section_id = ? AND id != ? ORDER BY position, id')
    .all(section.id, task.id)).map((r) => r.id);
  const index = Math.max(0, Math.min(Number(req.body.index) || 0, ids.length));
  ids.splice(index, 0, task.id);

  // One query renumbers the whole column
  await db.prepare(`
    UPDATE tasks SET section_id = ?, position = x.n - 1
    FROM unnest(?::int[]) WITH ORDINALITY AS x(id, n) WHERE tasks.id = x.id
  `).run(section.id, ids);
  if (section.id !== task.section_id) await applyRules(task.id, [{ type: 'moved', sectionId: section.id }]);
  res.json(await projectTasks(task.project_id));
});

app.patch('/api/tasks/:id', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const b = req.body;
  const title = b.title !== undefined ? String(b.title).trim() : task.title;
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const notes = b.notes !== undefined ? String(b.notes) : task.notes;
  const due = b.due_date !== undefined ? cleanDate(b.due_date) : task.due_date;
  // Start date: only with a due date, never after it, and a one-day task keeps none
  let start = b.start_date !== undefined ? cleanDate(b.start_date) : task.start_date;
  if (!due || start === due) start = null;
  if (start && start > due) return res.status(400).json({ error: 'The start date must be on or before the due date' });
  const completed = b.completed !== undefined ? (b.completed ? 1 : 0) : task.completed;
  const priority = b.priority !== undefined
    ? (PRIORITIES.includes(b.priority) ? b.priority : null)
    : task.priority;
  const repeat = b.repeat !== undefined ? (REPEATS.includes(b.repeat) ? b.repeat : null) : task.repeat;

  // Assignee: null (unassigned) or someone who is in this project
  let assigneeId = task.assignee_id;
  if (b.assignee_id !== undefined) {
    assigneeId = b.assignee_id === null || b.assignee_id === '' ? null : Number(b.assignee_id);
    if (assigneeId !== null && !(await isMember(task.project_id, assigneeId))) {
      return res.status(400).json({ error: 'That person is not in this project' });
    }
  }

  // Remember who assigned it (only when the assignee changes)
  let assignedBy = task.assigned_by;
  if (assigneeId !== task.assignee_id) assignedBy = assigneeId ? req.user.id : null;

  await transaction(async () => {
    // Remember when a task gets completed; clear it if it's reopened
    const completedAt = !completed ? null : (task.completed ? task.completed_at : new Date().toISOString());
    await db.prepare(`
      UPDATE tasks SET title = ?, notes = ?, start_date = ?, due_date = ?, completed = ?, completed_at = ?, priority = ?,
        assignee_id = ?, assigned_by = ?, repeat = ?
      WHERE id = ?
    `).run(title, notes, start, due, completed, completedAt, priority, assigneeId, assignedBy, repeat, task.id);

    // tag_ids replaces the task's whole tag list. Allowed: your own tags, and tags
    // already used in this project (so teammates share labels). Others are ignored.
    if (Array.isArray(b.tag_ids)) {
      const allowed = new Set((await db.prepare(`
        SELECT id FROM tags WHERE user_id = ?
        UNION SELECT tt.tag_id FROM task_tags tt JOIN tasks x ON x.id = tt.task_id WHERE x.project_id = ?
      `).all(req.user.id, task.project_id)).map((t) => t.id));
      await db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(task.id);
      const insert = db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
      for (const id of b.tag_ids.map(Number)) if (allowed.has(id)) await insert.run(task.id, id);
    }
  });

  const where = { projectId: task.project_id, taskId: task.id };
  if (assigneeId && assigneeId !== task.assignee_id) await notify(assigneeId, req.user.id, 'assigned', where);
  if (completed && !task.completed && assigneeId) await notify(assigneeId, req.user.id, 'completed', where);
  if (completed && !task.completed) {
    await applyRules(task.id, [{ type: 'completed' }]);
    if (repeat) await repeatTask(task.id);
  }

  res.json(await findTask(task.id, req.user.id));
});

app.get('/api/tasks/:id', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.delete('/api/tasks/:id', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  sweepUploads();
  res.json({ ok: true });
});

// ---------- My Tasks and search (across all projects) ----------

const TASK_WITH_PROJECT = `
  SELECT ${TASK_FIELDS}, p.name AS project_name, p.color AS project_color,
    (SELECT state FROM my_task_state s WHERE s.task_id = t.id AND s.user_id = m.user_id) AS my_state
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
  WHERE 1 = 1
`;

// Every task in every project of this user (Home and My Tasks)
app.get('/api/my-tasks', requireUser, async (req, res) => {
  const tasks = (await db.prepare(`${TASK_WITH_PROJECT} ORDER BY t.completed, t.due_date IS NULL, t.due_date, t.id`)
    .all(req.user.id)).map(parseTask);
  res.json(tasks);
});

// My Tasks board: put a task in my To do or Doing column (Done = completing it)
app.post('/api/my-tasks/:id/state', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (req.body.state === 'doing') {
    await db.prepare(`INSERT INTO my_task_state (user_id, task_id, state) VALUES (?, ?, 'doing')
      ON CONFLICT (user_id, task_id) DO UPDATE SET state = excluded.state`).run(req.user.id, task.id);
  } else {
    await db.prepare('DELETE FROM my_task_state WHERE user_id = ? AND task_id = ?').run(req.user.id, task.id);
  }
  res.json({ ok: true, my_state: req.body.state === 'doing' ? 'doing' : null });
});

// Ctrl+K search: projects by name, tasks by name or description (any letter case)
app.get('/api/search', requireUser, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ projects: [], tasks: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; // treat % and _ as normal characters

  const projects = await db.prepare(`
    SELECT p.id, p.name, p.color FROM projects p
    JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
    WHERE p.name ILIKE ? ESCAPE '\\' ORDER BY p.name LIMIT 5
  `).all(req.user.id, like);

  // Open tasks first, then name matches before description matches, then by due date
  const tasks = (await db.prepare(`
    ${TASK_WITH_PROJECT} AND (t.title ILIKE ? ESCAPE '\\' OR t.notes ILIKE ? ESCAPE '\\')
    ORDER BY t.completed, CASE WHEN t.title ILIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
      t.due_date IS NULL, t.due_date, t.id DESC
    LIMIT 20
  `).all(req.user.id, like, like, like)).map(parseTask);

  res.json({ projects, tasks });
});

// ---------- Subtasks API ----------

function findSubtask(subtaskId, userId) {
  return db.prepare(`
    SELECT s.* FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?
    WHERE s.id = ?
  `).get(userId, subtaskId);
}

app.get('/api/tasks/:id/subtasks', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(await db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id').all(task.id));
});

app.post('/api/tasks/:id/subtasks', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Subtask title is required' });
  const { pos } = await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM subtasks WHERE task_id = ?')
    .get(task.id);
  const { lastInsertRowid } = await db.prepare('INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)')
    .run(task.id, title, pos);
  res.status(201).json(await findSubtask(lastInsertRowid, req.user.id));
});

app.patch('/api/subtasks/:id', requireUser, async (req, res) => {
  const sub = await findSubtask(req.params.id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Subtask not found' });
  const title = req.body.title !== undefined ? String(req.body.title).trim() : sub.title;
  if (!title) return res.status(400).json({ error: 'Subtask title is required' });
  const completed = req.body.completed !== undefined ? (req.body.completed ? 1 : 0) : sub.completed;
  await db.prepare('UPDATE subtasks SET title = ?, completed = ? WHERE id = ?').run(title, completed, sub.id);
  res.json(await findSubtask(sub.id, req.user.id));
});

app.delete('/api/subtasks/:id', requireUser, async (req, res) => {
  const sub = await findSubtask(req.params.id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Subtask not found' });
  await db.prepare('DELETE FROM subtasks WHERE id = ?').run(sub.id);
  res.json({ ok: true });
});

// ---------- Tags API ----------

const TAG_COLORS = ['#4ade80', '#60a5fa', '#a78bfa', '#fbbf24', '#f472b6', '#2dd4bf', '#fb923c', '#f87171']; // accent colors on the black and white UI

// Your own tags, plus tags teammates have put on tasks in projects you share
app.get('/api/tags', requireUser, async (req, res) => {
  res.json(await db.prepare(`
    SELECT * FROM tags WHERE user_id = ?
    UNION
    SELECT tg.* FROM tags tg
    JOIN task_tags tt ON tt.tag_id = tg.id
    JOIN tasks t ON t.id = tt.task_id
    JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?
    ORDER BY name
  `).all(req.user.id, req.user.id));
});

// Creating a tag that already exists (any letter case) just returns the existing one
app.post('/api/tags', requireUser, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Tag name is required' });
  const existing = await db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(req.user.id, name);
  if (existing) return res.json(existing);

  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?').get(req.user.id);
  const { lastInsertRowid } = await db.prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)')
    .run(req.user.id, name, TAG_COLORS[n % TAG_COLORS.length]);
  res.status(201).json(await db.prepare('SELECT * FROM tags WHERE id = ?').get(lastInsertRowid));
});

// Deleting a tag removes it from every task
app.delete('/api/tags/:id', requireUser, async (req, res) => {
  const { changes } = await db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!changes) return res.status(404).json({ error: 'Tag not found' });
  res.json({ ok: true });
});

// ---------- Comments API ----------

const COMMENT_FIELDS = `c.id, c.task_id, c.user_id, c.body, c.created_at, u.name AS user_name,
  (SELECT COUNT(*) FROM likes WHERE kind = 'comment' AND item_id = c.id) AS like_count`;

app.get('/api/tasks/:id/comments', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(await db.prepare(`
    SELECT ${COMMENT_FIELDS} FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id
  `).all(task.id));
});

app.post('/api/tasks/:id/comments', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Write something first' });

  // Who hears about it: the assignee and everyone who commented before
  const earlier = (await db.prepare('SELECT DISTINCT user_id FROM comments WHERE task_id = ?').all(task.id)).map((r) => r.user_id);
  const { lastInsertRowid } = await db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)')
    .run(task.id, req.user.id, body);
  // @Name mentions (full or first name of a project member) get their own notification
  const lower = body.toLowerCase();
  const mentioned = (await projectMembers(task.project_id)).filter((m) => lower.includes(`@${m.name.toLowerCase()}`)
    || lower.includes(`@${m.name.split(/\s+/)[0].toLowerCase()}`)).map((m) => m.id);
  for (const userId of mentioned) await notify(userId, req.user.id, 'mention', { projectId: task.project_id, taskId: task.id, body: body.slice(0, 140) });
  const recipients = new Set([task.assignee_id, ...earlier].filter((id) => !mentioned.includes(id)));
  for (const userId of recipients) {
    await notify(userId, req.user.id, 'comment', { projectId: task.project_id, taskId: task.id, body: body.slice(0, 140) });
  }

  res.status(201).json(await db.prepare(`SELECT ${COMMENT_FIELDS} FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
    .get(lastInsertRowid));
});

// Only the person who wrote a comment can delete it
app.delete('/api/comments/:id', requireUser, async (req, res) => {
  const comment = await db.prepare(`
    SELECT c.* FROM comments c
    JOIN tasks t ON t.id = c.task_id
    JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?
    WHERE c.id = ?
  `).get(req.user.id, req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own comments' });
  await db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
});

// ---------- Attachments API ----------
// The browser sends the raw file as the request body (not a form), with its
// name in the X-File-Name header. The server streams it on to Supabase Storage
// under a random name, so a file never sits in memory and a file name can never
// point at another file. Downloads also go through the server, which checks
// that you are in the task's project.

// Supabase's free plan allows files up to 50 MB (paid plans allow much bigger ones)
const MAX_UPLOAD_MB = 50;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const uploading = new Set(); // stored names still being uploaded; the sweep leaves them alone

if (storageReady) {
  ensureBucket(MAX_UPLOAD_BYTES).then(sweepUploads)
    .catch((err) => console.error('File storage is not working:', err.message));
} else {
  console.log('File uploads are off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to turn them on.');
}

// Only these are ever shown inside the page (as previews). Every other file,
// SVG and HTML included, is always downloaded, so it can't run scripts here.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const ATTACHMENT_FIELDS = 'a.id, a.task_id, a.user_id, a.name, a.size, a.created_at, u.name AS user_name';

function extOf(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function withKind(attachment) {
  if (attachment) attachment.is_image = extOf(attachment.name) in IMAGE_TYPES;
  return attachment;
}

function cleanFileName(raw) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { /* bad encoding: use the fallback */ }
  name = name.replace(/[\x00-\x1f\x7f\\/]/g, '_').trim();
  if (name.length > 180) {
    const ext = extOf(name);
    name = name.slice(0, 170) + (ext ? `.${ext}` : '');
  }
  return name || 'file';
}

// An attachment on a task in one of your projects, plus your role in that project
function findAttachment(attachmentId, userId) {
  return db.prepare(`
    SELECT a.*, t.project_id, m.role FROM attachments a
    JOIN tasks t ON t.id = a.task_id
    JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ?
    WHERE a.id = ?
  `).get(userId, attachmentId);
}

// Deleting a task, project or account removes its attachment rows (cascade);
// this removes the stored files that no row points to anymore. Runs in the
// background: a failure is only logged, and the next sweep tries again.
let sweeping = false;
async function sweepUploads() {
  if (!storageReady || sweeping) return;
  sweeping = true;
  try {
    // Files first, rows second: a file whose upload finishes in between already has its row
    const stored = await listObjects();
    const keep = new Set((await db.prepare('SELECT stored_name FROM attachments').all()).map((r) => r.stored_name));
    const orphans = stored.filter((name) => !keep.has(name) && !uploading.has(name));
    if (orphans.length) await removeObjects(orphans);
  } catch (err) {
    console.error('Could not clean up stored files:', err.message);
  } finally {
    sweeping = false;
  }
}

// Tell the assignee. Several files added in a row become one notification
// listing them, instead of one per file.
async function notifyAttached(task, actorId, name) {
  if (!task.assignee_id || task.assignee_id === actorId) return;
  const recent = await db.prepare(`
    SELECT id, body FROM notifications
    WHERE user_id = ? AND actor_id = ? AND task_id = ? AND type = 'attached' AND read_at IS NULL
      AND created_at > to_char((now() AT TIME ZONE 'utc') - interval '10 minutes', 'YYYY-MM-DD HH24:MI:SS')
    ORDER BY id DESC
  `).get(task.assignee_id, actorId, task.id);
  if (!recent) return notify(task.assignee_id, actorId, 'attached', { projectId: task.project_id, taskId: task.id, body: name });
  let body = recent.body.endsWith('...') ? recent.body : `${recent.body}, ${name}`;
  if (body.length > 140) body = `${body.slice(0, 137)}...`;
  await db.prepare('UPDATE notifications SET body = ?, created_at = now_text() WHERE id = ?').run(body, recent.id);
}

app.get('/api/tasks/:id/attachments', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json((await db.prepare(`
    SELECT ${ATTACHMENT_FIELDS} FROM attachments a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.task_id = ? ORDER BY a.id
  `).all(task.id)).map(withKind));
});

// Files tab: every attachment on every task of a project, newest first
app.get('/api/projects/:id/attachments', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json((await db.prepare(`
    SELECT ${ATTACHMENT_FIELDS}, t.title AS task_title FROM attachments a
    JOIN tasks t ON t.id = a.task_id LEFT JOIN users u ON u.id = a.user_id
    WHERE t.project_id = ? ORDER BY a.id DESC
  `).all(project.id)).map(withKind));
});

app.post('/api/tasks/:id/attachments', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!storageReady) return res.status(503).json({ error: 'File uploads are not set up yet' });

  const tooBig = () => res.status(413).set('Connection', 'close').json({ error: `Files can be up to ${MAX_UPLOAD_MB} MB` });
  if (Number(req.get('Content-Length')) > MAX_UPLOAD_BYTES) return tooBig();

  const name = cleanFileName(req.get('X-File-Name'));
  const storedName = randomBytes(16).toString('hex');
  let size = 0;
  // Counts the bytes and stops the upload as soon as it goes over the limit
  const limit = new Transform({
    transform(chunk, encoding, done) {
      size += chunk.length;
      done(size > MAX_UPLOAD_BYTES ? Object.assign(new Error('too big'), { tooBig: true }) : null, chunk);
    },
  });
  req.on('error', (err) => limit.destroy(err)); // the browser gave up halfway

  uploading.add(storedName);
  try {
    await putObject(storedName, req.pipe(limit));
    if (!size) {
      await removeObjects([storedName]);
      return res.status(400).json({ error: 'This file is empty' });
    }
    const { lastInsertRowid } = await db.prepare(
      'INSERT INTO attachments (task_id, user_id, name, size, stored_name) VALUES (?, ?, ?, ?, ?)',
    ).run(task.id, req.user.id, name, size, storedName);

    await notifyAttached(task, req.user.id, name);
    res.status(201).json(withKind(await db.prepare(`
      SELECT ${ATTACHMENT_FIELDS} FROM attachments a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?
    `).get(lastInsertRowid)));
  } catch (err) {
    if (res.headersSent) return;
    if (err.tooBig || err.cause?.tooBig || err.status === 413) return tooBig();
    if (!req.destroyed) console.error('Upload failed:', err.message);
    res.status(400).json({ error: 'The upload did not finish. Try again.' }); // lost if the browser already gave up
  } finally {
    uploading.delete(storedName);
    sweepUploads(); // removes the stored file if the upload broke halfway
  }
});

// Images open inside the page as previews; everything else (or ?download=1) downloads
app.get('/api/attachments/:id', requireUser, async (req, res) => {
  const attachment = await findAttachment(req.params.id, req.user.id);
  if (!attachment) return res.status(404).json({ error: 'File not found' });

  let stored;
  try {
    stored = await getObject(attachment.stored_name);
  } catch (err) {
    console.error('Download failed:', err.message);
    return res.status(err.status === 404 || err.status === 400 ? 404 : 502).json({ error: 'This file could not be loaded' });
  }

  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
  });
  const length = stored.headers.get('content-length');
  if (length) res.set('Content-Length', length);
  const imageType = IMAGE_TYPES[extOf(attachment.name)];
  if (imageType && req.query.download === undefined) {
    res.set('Content-Type', imageType);
  } else {
    res.attachment(attachment.name);
    res.set('Content-Type', 'application/octet-stream');
  }
  Readable.fromWeb(stored.body).on('error', () => res.destroy()).pipe(res);
});

// The person who uploaded a file, or the project owner, can delete it
app.delete('/api/attachments/:id', requireUser, async (req, res) => {
  const attachment = await findAttachment(req.params.id, req.user.id);
  if (!attachment) return res.status(404).json({ error: 'File not found' });
  if (attachment.user_id !== req.user.id && attachment.role !== 'owner') {
    return res.status(403).json({ error: 'Only the person who added this file, or the project owner, can delete it' });
  }
  await db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
  sweepUploads();
  res.json({ ok: true });
});

// ---------- Inbox API ----------

// Only notifications about projects you are still in
const INBOX_WHERE = `
  n.user_id = ? AND (n.project_id IS NULL OR EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = n.project_id AND pm.user_id = n.user_id
  ))
`;

app.get('/api/inbox', requireUser, async (req, res) => {
  res.json(await db.prepare(`
    SELECT n.id, n.type, n.body, n.read_at, n.created_at, n.project_id, n.task_id, n.archived_at, n.bookmarked,
      n.actor_id, a.name AS actor_name, p.name AS project_name, p.color AS project_color, t.title AS task_title, t.completed AS task_completed
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN projects p ON p.id = n.project_id
    LEFT JOIN tasks t ON t.id = n.task_id
    WHERE ${INBOX_WHERE} AND ${({ archive: 'n.archived_at IS NOT NULL', bookmarks: 'n.bookmarked = 1', mentions: "n.type = 'mention' AND n.archived_at IS NULL" })[req.query.tab] || 'n.archived_at IS NULL'}
    ORDER BY n.id DESC LIMIT 150
  `).all(req.user.id));
});

app.get('/api/inbox/unread', requireUser, async (req, res) => {
  const { count } = await db.prepare(`SELECT COUNT(*) AS count FROM notifications n WHERE ${INBOX_WHERE} AND n.read_at IS NULL AND n.archived_at IS NULL`)
    .get(req.user.id);
  res.json({ count });
});

// Mark some notifications (ids) or all of them as read
// One notification: { read, archived, bookmarked } (any of them)
app.patch('/api/inbox/:id', requireUser, async (req, res) => {
  const n = await db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  const b = req.body;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const readAt = b.read === undefined ? n.read_at : (b.read ? n.read_at || now : null);
  const archivedAt = b.archived === undefined ? n.archived_at : (b.archived ? n.archived_at || now : null);
  const bookmarked = b.bookmarked === undefined ? n.bookmarked : (b.bookmarked ? 1 : 0);
  await db.prepare('UPDATE notifications SET read_at = ?, archived_at = ?, bookmarked = ? WHERE id = ?')
    .run(archivedAt && !readAt ? now : readAt, archivedAt, bookmarked, n.id);
  res.json(await db.prepare('SELECT id, read_at, archived_at, bookmarked FROM notifications WHERE id = ?').get(n.id));
});

// Archive everything in the Activity tab (they are read too)
app.post('/api/inbox/archive-all', requireUser, async (req, res) => {
  const { changes } = await db.prepare('UPDATE notifications SET archived_at = now_text(), read_at = COALESCE(read_at, now_text()) WHERE user_id = ? AND archived_at IS NULL')
    .run(req.user.id);
  res.json({ archived: changes });
});

app.post('/api/inbox/read', requireUser, async (req, res) => {
  if (Array.isArray(req.body.ids)) {
    const ids = req.body.ids.map(Number).filter(Number.isInteger);
    await db.prepare('UPDATE notifications SET read_at = now_text() WHERE id = ANY(?::int[]) AND user_id = ? AND read_at IS NULL')
      .run(ids, req.user.id);
  } else {
    await db.prepare('UPDATE notifications SET read_at = now_text() WHERE user_id = ? AND read_at IS NULL').run(req.user.id);
  }
  res.json({ ok: true });
});

// ---------- Repeating tasks ----------
// Completing a repeating task creates the next one (dates moved by a day, week or month);
// the repeat moves to the new task, so the finished one stays finished.

function shiftDate(key, repeat) {
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (repeat === 'daily') date.setDate(date.getDate() + 1);
  else if (repeat === 'weekly') date.setDate(date.getDate() + 7);
  else date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function repeatTask(taskId) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!t?.repeat) return;
  const due = t.due_date ? shiftDate(t.due_date, t.repeat) : shiftDate(new Date().toISOString().slice(0, 10), t.repeat);
  await db.prepare(`INSERT INTO tasks (project_id, title, notes, section_id, position, priority, assignee_id, assigned_by, due_date, start_date, repeat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.project_id, t.title, t.notes, t.section_id, await nextTaskPosition(t.section_id), t.priority,
    t.assignee_id, t.assigned_by, due, shiftDate(t.start_date, t.repeat), t.repeat);
  await db.prepare('UPDATE tasks SET repeat = NULL WHERE id = ?').run(t.id);
}

// ---------- Dependencies ("blocked by") ----------

app.get('/api/tasks/:id/dependencies', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const list = (sql) => db.prepare(sql).all(task.id);
  res.json({
    blocked_by: await list('SELECT t.id, t.title, t.completed FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_by_id WHERE d.task_id = ? ORDER BY t.id'),
    blocking: await list('SELECT t.id, t.title, t.completed FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE d.blocked_by_id = ? ORDER BY t.id'),
  });
});

app.post('/api/tasks/:id/dependencies', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  const blocker = await findTask(req.body.blocked_by_id, req.user.id);
  if (!task || !blocker) return res.status(404).json({ error: 'Task not found' });
  if (blocker.id === task.id || blocker.project_id !== task.project_id) return res.status(400).json({ error: 'Pick another task in this project' });
  // No circles: the blocker must not (directly or indirectly) wait on this task
  const circle = await db.prepare(`
    WITH RECURSIVE waits(id) AS (
      SELECT blocked_by_id FROM task_dependencies WHERE task_id = ?
      UNION SELECT d.blocked_by_id FROM task_dependencies d JOIN waits ON d.task_id = waits.id
    )
    SELECT 1 FROM waits WHERE id = ? LIMIT 1
  `).get(blocker.id, task.id);
  if (circle) return res.status(400).json({ error: 'That would make the two tasks wait on each other' });
  await db.prepare('INSERT INTO task_dependencies (task_id, blocked_by_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(task.id, blocker.id);
  res.status(201).json({ ok: true });
});

app.delete('/api/tasks/:id/dependencies/:otherId', requireUser, async (req, res) => {
  const task = await findTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND blocked_by_id = ?').run(task.id, req.params.otherId);
  res.json({ ok: true });
});

// ---------- Likes ----------

// The ids of tasks or comments (out of `ids`) that this user can see
function visibleItems(kind) {
  return kind === 'task'
    ? 'SELECT t.id FROM tasks t JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ? WHERE t.id = ANY(?::int[])'
    : `SELECT c.id FROM comments c JOIN tasks t ON t.id = c.task_id
       JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ? WHERE c.id = ANY(?::int[])`;
}

const likeCount = async (kind, id) => (await db.prepare('SELECT COUNT(*) AS n FROM likes WHERE kind = ? AND item_id = ?').get(kind, id)).n;

app.get('/api/likes', requireUser, async (req, res) => {
  const { kind } = req.query;
  const ids = String(req.query.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!['task', 'comment'].includes(kind)) return res.status(400).json({ error: 'Bad kind' });
  // One query for all of them
  const rows = await db.prepare(`
    SELECT v.id,
      (SELECT COUNT(*) FROM likes l WHERE l.kind = ? AND l.item_id = v.id) AS count,
      EXISTS (SELECT 1 FROM likes l WHERE l.kind = ? AND l.item_id = v.id AND l.user_id = ?) AS liked
    FROM (${visibleItems(kind)}) v
  `).all(kind, kind, req.user.id, req.user.id, ids);
  const out = {};
  for (const row of rows) out[row.id] = { count: row.count, liked: row.liked };
  res.json(out);
});

// Like or unlike (toggles)
app.post('/api/likes', requireUser, async (req, res) => {
  const kind = String(req.body.kind);
  const id = Number(req.body.id);
  if (!['task', 'comment'].includes(kind) || !Number.isInteger(id)
    || !(await db.prepare(visibleItems(kind)).get(req.user.id, [id]))) return res.status(404).json({ error: 'Not found' });
  const liked = await db.prepare('SELECT 1 FROM likes WHERE kind = ? AND item_id = ? AND user_id = ?').get(kind, id, req.user.id);
  if (liked) await db.prepare('DELETE FROM likes WHERE kind = ? AND item_id = ? AND user_id = ?').run(kind, id, req.user.id);
  else await db.prepare('INSERT INTO likes (kind, item_id, user_id) VALUES (?, ?, ?)').run(kind, id, req.user.id);
  res.json({ liked: !liked, count: await likeCount(kind, id) });
});

// ---------- Favorites (per person) ----------

app.post('/api/projects/:id/favorite', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await db.prepare('UPDATE project_members SET favorite = ? WHERE project_id = ? AND user_id = ?').run(req.body.favorite ? 1 : 0, project.id, req.user.id);
  res.json(await findProject(project.id, req.user.id));
});

// ---------- Project status updates ----------

const STATUSES = ['on_track', 'at_risk', 'off_track', 'on_hold', 'complete'];
const STATUS_NAMES = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', on_hold: 'On hold', complete: 'Complete' };

app.get('/api/projects/:id/status', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await db.prepare(`
    SELECT s.*, u.name AS user_name FROM status_updates s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.project_id = ? ORDER BY s.id DESC LIMIT 50
  `).all(project.id));
});

// Any member can post an update; it becomes the project's current status
app.post('/api/projects/:id/status', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const status = String(req.body.status || '');
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Pick a status' });
  const body = String(req.body.body || '').trim().slice(0, 2000);
  await db.prepare('INSERT INTO status_updates (project_id, user_id, status, body) VALUES (?, ?, ?, ?)').run(project.id, req.user.id, status, body);
  await db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, project.id);
  for (const m of await projectMembers(project.id)) {
    await notify(m.id, req.user.id, 'status', { projectId: project.id, body: `${STATUS_NAMES[status]}${body ? `: ${body.slice(0, 120)}` : ''}` });
  }
  res.status(201).json(await findProject(project.id, req.user.id));
});

// ---------- Portfolios (personal) ----------

// Projects with the numbers a portfolio or goal shows
const PROJECT_STATS = `
  SELECT p.*, m.role,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total_tasks,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 0) AS open_tasks,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed = 0 AND t.due_date < ${TODAY}) AS overdue_tasks,
    (SELECT name FROM users WHERE id = p.user_id) AS owner_name
  FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
`;

function findPortfolio(id, userId) {
  return db.prepare('SELECT * FROM portfolios WHERE id = ? AND user_id = ?').get(id, userId);
}

app.get('/api/portfolios', requireUser, async (req, res) => {
  res.json(await db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM portfolio_projects pp JOIN project_members m ON m.project_id = pp.project_id AND m.user_id = f.user_id
      WHERE pp.portfolio_id = f.id) AS project_count
    FROM portfolios f WHERE f.user_id = ? ORDER BY f.id
  `).all(req.user.id));
});

app.post('/api/portfolios', requireUser, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Portfolio name is required' });
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : '#60a5fa';
  const { lastInsertRowid } = await db.prepare('INSERT INTO portfolios (user_id, name, color) VALUES (?, ?, ?)').run(req.user.id, name, color);
  res.status(201).json(await findPortfolio(lastInsertRowid, req.user.id));
});

app.get('/api/portfolios/:id', requireUser, async (req, res) => {
  const portfolio = await findPortfolio(req.params.id, req.user.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  const projects = await db.prepare(`${PROJECT_STATS} WHERE p.id IN (SELECT project_id FROM portfolio_projects WHERE portfolio_id = ?) ORDER BY p.name`)
    .all(req.user.id, portfolio.id);
  res.json({ ...portfolio, projects });
});

app.patch('/api/portfolios/:id', requireUser, async (req, res) => {
  const portfolio = await findPortfolio(req.params.id, req.user.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 80) : portfolio.name;
  if (!name) return res.status(400).json({ error: 'Portfolio name is required' });
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : portfolio.color;
  await db.prepare('UPDATE portfolios SET name = ?, color = ? WHERE id = ?').run(name, color, portfolio.id);
  res.json(await findPortfolio(portfolio.id, req.user.id));
});

app.delete('/api/portfolios/:id', requireUser, async (req, res) => {
  const { changes } = await db.prepare('DELETE FROM portfolios WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!changes) return res.status(404).json({ error: 'Portfolio not found' });
  res.json({ ok: true });
});

app.post('/api/portfolios/:id/projects', requireUser, async (req, res) => {
  const portfolio = await findPortfolio(req.params.id, req.user.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  if (!(await findProject(req.body.project_id, req.user.id))) return res.status(404).json({ error: 'Project not found' });
  await db.prepare('INSERT INTO portfolio_projects (portfolio_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(portfolio.id, Number(req.body.project_id));
  res.status(201).json({ ok: true });
});

app.delete('/api/portfolios/:id/projects/:projectId', requireUser, async (req, res) => {
  const portfolio = await findPortfolio(req.params.id, req.user.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  await db.prepare('DELETE FROM portfolio_projects WHERE portfolio_id = ? AND project_id = ?').run(portfolio.id, req.params.projectId);
  res.json({ ok: true });
});

// ---------- Goals (personal) ----------

// Progress: the average completion of linked projects you are in, or the number typed in
async function goalWithProgress(goal, userId) {
  const projects = await db.prepare(`${PROJECT_STATS} WHERE p.id IN (SELECT project_id FROM goal_projects WHERE goal_id = ?) ORDER BY p.name`)
    .all(userId, goal.id);
  const measured = projects.length
    ? Math.round(projects.reduce((sum, p) => sum + (p.total_tasks ? (p.total_tasks - p.open_tasks) / p.total_tasks : 0), 0) / projects.length * 100)
    : null;
  return { ...goal, projects, project_ids: projects.map((p) => p.id), progress: measured ?? goal.progress, measured: measured !== null };
}

async function saveGoalFields(goal, b, userId) {
  const title = b.title !== undefined ? String(b.title).trim().slice(0, 200) : goal.title;
  if (!title) return 'Goal title is required';
  const notes = b.notes !== undefined ? String(b.notes).slice(0, 4000) : goal.notes;
  const due = b.due_date !== undefined ? cleanDate(b.due_date) : goal.due_date;
  const status = b.status !== undefined ? (STATUSES.includes(b.status) ? b.status : null) : goal.status;
  const progress = b.progress !== undefined ? Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0))) : goal.progress;
  // Checked before the transaction: a bad id inside it would break the whole transaction
  const projectIds = [];
  if (Array.isArray(b.project_ids)) {
    for (const pid of b.project_ids.map(Number)) if (Number.isInteger(pid) && await isMember(pid, userId)) projectIds.push(pid);
  }
  await transaction(async () => {
    await db.prepare('UPDATE goals SET title = ?, notes = ?, due_date = ?, status = ?, progress = ? WHERE id = ?')
      .run(title, notes, due, status, progress, goal.id);
    if (Array.isArray(b.project_ids)) {
      await db.prepare('DELETE FROM goal_projects WHERE goal_id = ?').run(goal.id);
      const link = db.prepare('INSERT INTO goal_projects (goal_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
      for (const pid of projectIds) await link.run(goal.id, pid);
    }
  });
  return null;
}

app.get('/api/goals', requireUser, async (req, res) => {
  const goals = await db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY due_date IS NULL, due_date, id').all(req.user.id);
  res.json(await Promise.all(goals.map((g) => goalWithProgress(g, req.user.id))));
});

app.post('/api/goals', requireUser, async (req, res) => {
  if (!String(req.body.title || '').trim()) return res.status(400).json({ error: 'Goal title is required' });
  const { lastInsertRowid } = await db.prepare("INSERT INTO goals (user_id, title) VALUES (?, '')").run(req.user.id);
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(lastInsertRowid);
  await saveGoalFields(goal, req.body, req.user.id);
  res.status(201).json(await goalWithProgress(await db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id), req.user.id));
});

app.patch('/api/goals/:id', requireUser, async (req, res) => {
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const error = await saveGoalFields(goal, req.body, req.user.id);
  if (error) return res.status(400).json({ error });
  res.json(await goalWithProgress(await db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id), req.user.id));
});

app.delete('/api/goals/:id', requireUser, async (req, res) => {
  const { changes } = await db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!changes) return res.status(404).json({ error: 'Goal not found' });
  res.json({ ok: true });
});

// ---------- Rules (automations) ----------
// Triggers: task added, moved into a section, completed.
// Actions: complete, move to a section, assign, set priority, set the due date N days out.
// Actions never set off other rules, so rules can't loop.

const RULE_TRIGGERS = ['added', 'moved', 'completed'];
const RULE_ACTIONS = ['complete', 'move', 'assign', 'priority', 'due'];

async function applyRules(taskId, events) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;
  const rules = await db.prepare('SELECT * FROM rules WHERE project_id = ? AND enabled = 1 ORDER BY id').all(task.project_id);
  for (const rule of rules) {
    const hit = events.some((e) => (rule.trigger === 'added' && e.type === 'added')
      || (rule.trigger === 'completed' && e.type === 'completed')
      || (rule.trigger === 'moved' && (e.type === 'moved' || e.type === 'added') && e.sectionId === rule.trigger_value));
    if (!hit) continue;
    const v = rule.action_value;
    if (rule.action === 'complete') {
      await db.prepare('UPDATE tasks SET completed = 1, completed_at = ? WHERE id = ? AND completed = 0').run(new Date().toISOString(), taskId);
    } else if (rule.action === 'move') {
      const section = await db.prepare('SELECT id FROM sections WHERE id = ? AND project_id = ?').get(Number(v), task.project_id);
      if (section) await db.prepare('UPDATE tasks SET section_id = ?, position = ? WHERE id = ?').run(section.id, await nextTaskPosition(section.id), taskId);
    } else if (rule.action === 'assign') {
      if (await isMember(task.project_id, Number(v))) {
        await db.prepare('UPDATE tasks SET assignee_id = ?, assigned_by = ? WHERE id = ?').run(Number(v), rule.created_by, taskId);
        await notify(Number(v), rule.created_by, 'assigned', { projectId: task.project_id, taskId });
      }
    } else if (rule.action === 'priority') {
      if (PRIORITIES.includes(v)) await db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(v, taskId);
    } else if (rule.action === 'due') {
      const d = new Date();
      d.setDate(d.getDate() + Math.max(0, Math.min(365, Number(v) || 0)));
      const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await db.prepare('UPDATE tasks SET due_date = ?, start_date = CASE WHEN start_date > ? THEN NULL ELSE start_date END WHERE id = ?').run(due, due, taskId);
    }
  }
}

function findRule(id, userId) {
  return db.prepare('SELECT r.* FROM rules r JOIN project_members m ON m.project_id = r.project_id AND m.user_id = ? WHERE r.id = ?').get(userId, id);
}

app.get('/api/projects/:id/rules', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await db.prepare('SELECT * FROM rules WHERE project_id = ? ORDER BY id').all(project.id));
});

app.post('/api/projects/:id/rules', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { trigger, action } = req.body;
  if (!RULE_TRIGGERS.includes(trigger) || !RULE_ACTIONS.includes(action)) return res.status(400).json({ error: 'Pick a trigger and an action' });
  const inProject = (sid) => db.prepare('SELECT 1 FROM sections WHERE id = ? AND project_id = ?').get(Number(sid), project.id);
  const triggerValue = trigger === 'moved' ? Number(req.body.trigger_value) : null;
  if (trigger === 'moved' && !(await inProject(triggerValue))) return res.status(400).json({ error: 'Pick a section' });
  let actionValue = req.body.action_value == null ? null : String(req.body.action_value);
  if (action === 'move' && !(await inProject(actionValue))) return res.status(400).json({ error: 'Pick a section to move to' });
  if (action === 'assign' && !(await isMember(project.id, Number(actionValue)))) return res.status(400).json({ error: 'Pick someone in this project' });
  if (action === 'priority' && !PRIORITIES.includes(actionValue)) return res.status(400).json({ error: 'Pick a priority' });
  if (action === 'due') actionValue = String(Math.max(0, Math.min(365, Number(actionValue) || 0)));
  if (action === 'complete') actionValue = null;
  const { lastInsertRowid } = await db.prepare('INSERT INTO rules (project_id, trigger, trigger_value, action, action_value, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(project.id, trigger, triggerValue, action, actionValue, req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM rules WHERE id = ?').get(lastInsertRowid));
});

app.patch('/api/rules/:id', requireUser, async (req, res) => {
  const rule = await findRule(req.params.id, req.user.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, rule.id);
  res.json(await db.prepare('SELECT * FROM rules WHERE id = ?').get(rule.id));
});

app.delete('/api/rules/:id', requireUser, async (req, res) => {
  const rule = await findRule(req.params.id, req.user.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await db.prepare('DELETE FROM rules WHERE id = ?').run(rule.id);
  res.json({ ok: true });
});

// ---------- Templates and duplicating ----------

const TEMPLATES = {
  launch: { name: 'Product launch', about: 'Plan, build and ship a launch', sections: {
    Planning: ['Define launch goals', 'Pick the launch date', 'Write the positioning'],
    Building: ['Landing page', 'Demo video', 'Pricing page'],
    Launch: ['Email announcement', 'Social posts', 'Press outreach'],
    Done: [] } },
  bugs: { name: 'Bug tracker', about: 'Report, fix and verify bugs', sections: {
    'New bugs': ['Example: login button does nothing on Safari'], Investigating: [], Fixing: [], 'Ready to test': [], Closed: [] } },
  sprint: { name: 'Weekly sprint', about: 'Backlog to done, one week at a time', sections: {
    Backlog: ['Sprint planning meeting'], 'This week': [], 'In progress': [], Review: [], Done: [] } },
  content: { name: 'Content calendar', about: 'Ideas, drafts and published posts', sections: {
    Ideas: ['Blog: 5 tips for beginners', 'Video: product walkthrough'], Writing: [], Editing: [], Scheduled: [], Published: [] } },
  event: { name: 'Event planning', about: 'Venue, guests and the big day', sections: {
    'To book': ['Venue', 'Catering', 'Photographer'], Guests: ['Make the guest list', 'Send invites'], 'Day of': ['Set up the venue'], Done: [] } },
  onboarding: { name: 'Employee onboarding', about: 'A new teammate\'s first weeks', sections: {
    'Before day one': ['Prepare laptop and accounts', 'Send welcome email'], 'First week': ['Team intro meeting', 'Read the handbook'],
    'First month': ['First project check-in'], Done: [] } },
};

app.get('/api/templates', requireUser, (req, res) => {
  res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, about: t.about, sections: Object.keys(t.sections) })));
});

// Build a project from a list of [section name, [task titles]]
function createProjectWith(userId, name, color, sections) {
  return transaction(async () => {
    const projectId = Number((await db.prepare('INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)').run(userId, name, color)).lastInsertRowid);
    await db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").run(projectId, userId);
    const addTask = db.prepare('INSERT INTO tasks (project_id, section_id, position, title, notes, priority, due_date, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [i, [sectionName, tasks]] of sections.entries()) {
      const { lastInsertRowid: sectionId } = await db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)').run(projectId, sectionName, i);
      for (const [j, t] of tasks.entries()) {
        await addTask.run(projectId, sectionId, j, t.title, t.notes || '', t.priority || null, t.due_date || null, t.start_date || null);
      }
    }
    return projectId;
  });
}

app.post('/api/projects/from-template', requireUser, async (req, res) => {
  const template = TEMPLATES[req.body.template];
  if (!template) return res.status(400).json({ error: 'Unknown template' });
  const name = String(req.body.name || template.name).trim().slice(0, 80) || template.name;
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : '#60a5fa';
  const id = await createProjectWith(req.user.id, name, color,
    Object.entries(template.sections).map(([s, titles]) => [s, titles.map((title) => ({ title }))]));
  res.status(201).json(await findProject(id, req.user.id));
});

// Copy sections and open tasks (titles, notes, priorities, dates) into a new project you own
app.post('/api/projects/:id/duplicate', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const name = String(req.body.name || `${project.name} (copy)`).trim().slice(0, 80);
  const openTasks = db.prepare('SELECT * FROM tasks WHERE section_id = ? AND completed = 0 ORDER BY position, id');
  const sections = [];
  for (const s of await ensureSections(project.id)) sections.push([s.name, await openTasks.all(s.id)]);
  const id = await createProjectWith(req.user.id, name, project.color, sections);
  res.status(201).json(await findProject(id, req.user.id));
});

// ---------- Forms ----------

app.get('/api/projects/:id/form', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await db.prepare('SELECT * FROM forms WHERE project_id = ?').get(project.id)
    || { project_id: project.id, token: null, enabled: 0, title: '', description: '', section_id: null });
});

app.put('/api/projects/:id/form', requireUser, async (req, res) => {
  const project = await findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const old = await db.prepare('SELECT * FROM forms WHERE project_id = ?').get(project.id);
  const sectionId = (await db.prepare('SELECT id FROM sections WHERE id = ? AND project_id = ?').get(Number(req.body.section_id), project.id))?.id ?? null;
  await db.prepare(`INSERT INTO forms (project_id, token, enabled, title, description, section_id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled, title = excluded.title, description = excluded.description, section_id = excluded.section_id`)
    .run(project.id, old?.token || randomBytes(12).toString('hex'), req.body.enabled ? 1 : 0,
      String(req.body.title || '').trim().slice(0, 120), String(req.body.description || '').slice(0, 1000), sectionId);
  res.json(await db.prepare('SELECT * FROM forms WHERE project_id = ?').get(project.id));
});

function openForm(token) {
  return db.prepare(`SELECT f.*, p.name AS project_name, p.user_id AS owner_id FROM forms f JOIN projects p ON p.id = f.project_id
    WHERE f.token = ? AND f.enabled = 1`).get(String(token));
}

app.get('/api/forms/:token', async (req, res) => {
  const form = await openForm(req.params.token);
  if (!form) return res.status(404).json({ error: 'This form is closed or the link is wrong' });
  res.json({ title: form.title || form.project_name, description: form.description, project_name: form.project_name });
});

// At most 10 submissions an hour from one address, and a hidden "website" field bots fill in
const formHits = new Map();
app.post('/api/forms/:token', async (req, res) => {
  const form = await openForm(req.params.token);
  if (!form) return res.status(404).json({ error: 'This form is closed or the link is wrong' });
  if (req.body.website) return res.json({ ok: true });
  const now = Date.now();
  const hits = (formHits.get(req.ip) || []).filter((t) => now - t < 3600000);
  if (hits.length >= 10) return res.status(429).json({ error: 'Too many submissions. Try again in an hour.' });
  formHits.set(req.ip, [...hits, now]);

  const title = String(req.body.title || '').trim().slice(0, 200);
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().slice(0, 120);
  if (!title || !name) return res.status(400).json({ error: 'Please fill in your name and a title' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'That email does not look right' });
  const sections = await ensureSections(form.project_id);
  const sectionId = sections.some((s) => s.id === form.section_id) ? form.section_id : sections[0].id;
  const notes = `${String(req.body.details || '').slice(0, 4000)}\n\nSent by ${name}${email ? ` (${email})` : ''} through the form.`.trim();
  const { lastInsertRowid } = await db.prepare('INSERT INTO tasks (project_id, title, notes, section_id, position) VALUES (?, ?, ?, ?, ?)')
    .run(form.project_id, title, notes, sectionId, await nextTaskPosition(sectionId));
  await applyRules(Number(lastInsertRowid), [{ type: 'added', sectionId }]);
  await notify(form.owner_id, null, 'form', { projectId: form.project_id, taskId: Number(lastInsertRowid), body: `From ${name}` });
  res.status(201).json({ ok: true });
});

// ---------- Not found ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).sendFile('404.html', { root: 'public' }));

const server = app.listen(PORT, () => console.log(`Asana clone running at http://localhost:${PORT}`));
// Node cuts off any request after 5 minutes by default, which would stop big uploads halfway.
// Headers still have to arrive within 60 seconds (headersTimeout), so slow-header attacks stay blocked.
server.requestTimeout = 0;
