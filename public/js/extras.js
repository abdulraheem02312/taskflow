// Small task and project extras: "Blocked" / repeat / like badges, task likes,
// repeating tasks, dependencies, favorites, archive and keyboard shortcuts.
// Loaded before app.js. Uses state, $, make, api, render, toast, openModal, navigate,
// openTask, updateTask, currentProject, refreshCounts, renderProjects,
// openNewTaskDialog and openPalette from the other files (only inside functions).

// Badges shown next to a task's name in rows and cards
function extraBadges(task) {
  const out = [];
  if (task.blocked_count && !task.completed) {
    const b = make('span', 'mini-badge blocked', 'Blocked');
    b.title = `Waiting on ${task.blocked_count} unfinished task${task.blocked_count === 1 ? '' : 's'}`;
    out.push(b);
  }
  if (task.repeat) {
    const r = make('span', 'mini-badge', '↻');
    r.title = `Repeats ${({ daily: 'every day', weekly: 'every week', monthly: 'every month' })[task.repeat]}`;
    out.push(r);
  }
  if (task.like_count) {
    const l = make('span', 'mini-badge like', `♥ ${task.like_count}`);
    l.title = `${task.like_count} like${task.like_count === 1 ? '' : 's'}`;
    out.push(l);
  }
  return out;
}

// ---------- Task like ----------

async function loadTaskLike(taskId) {
  const btn = $('detail-like');
  btn.classList.remove('on');
  $('detail-like-count').textContent = '';
  const data = (await api(`/api/likes?kind=task&ids=${taskId}`))[taskId];
  if (!data || state.openTaskId !== taskId) return;
  showLike(btn, $('detail-like-count'), data);
}

function showLike(btn, countEl, { liked, count }) {
  btn.classList.toggle('on', liked);
  btn.setAttribute('aria-pressed', String(liked));
  countEl.textContent = count || '';
}

document.getElementById('detail-like').addEventListener('click', async () => {
  const task = openTask();
  if (!task) return;
  const data = await api('/api/likes', { method: 'POST', body: { kind: 'task', id: task.id } });
  showLike($('detail-like'), $('detail-like-count'), data);
  task.like_count = data.count;
  render();
});

// ---------- Repeat ----------

document.getElementById('detail-repeat').addEventListener('change', (e) => {
  const task = openTask();
  if (task) updateTask(task, { repeat: e.target.value || null });
});

// Completing a repeating task makes the next one on the server: reload to show it
async function afterCompleteMaybeRepeat(task, wasRepeating) {
  if (!wasRepeating || !task.completed) return;
  toast('Done! The next one is scheduled.');
  if (state.page === 'project') {
    state.tasks = await api(`/api/projects/${state.projectId}/tasks`);
  } else if (state.page === 'home' || state.page === 'my-tasks') {
    state.tasks = await api('/api/my-tasks');
  }
  render();
}

// ---------- Dependencies ----------

async function loadDependencies(taskId) {
  $('dep-list').replaceChildren();
  $('dep-blocking').textContent = '';
  const task = openTask();
  const data = await api(`/api/tasks/${taskId}/dependencies`);
  if (state.openTaskId !== taskId) return;
  for (const t of data.blocked_by) {
    const li = make('li', 'dep-item' + (t.completed ? ' done' : ''));
    li.append(make('span', 'dep-dot'), make('span', 'dep-title', t.title));
    const x = make('button', 'icon-btn', '×');
    x.type = 'button';
    x.title = 'Remove';
    x.addEventListener('click', async () => {
      await api(`/api/tasks/${taskId}/dependencies/${t.id}`, { method: 'DELETE' });
      refreshTaskBlocked(taskId);
    });
    li.append(x);
    $('dep-list').append(li);
  }
  if (data.blocking.length) $('dep-blocking').textContent = `Waiting on this: ${data.blocking.map((t) => t.title).join(', ')}`;

  // Other tasks of the same project (on Home and My Tasks too, all loaded tasks of that project)
  const taken = new Set([taskId, ...data.blocked_by.map((t) => t.id)]);
  const add = $('dep-add');
  add.replaceChildren(new Option('+ Add a task this one waits for', ''));
  for (const t of state.tasks.filter((x) => x.project_id === task?.project_id && !taken.has(x.id) && !x.completed)) add.append(new Option(t.title, t.id));
}

document.getElementById('dep-add').addEventListener('change', async (e) => {
  const taskId = state.openTaskId;
  if (!e.target.value || !taskId) return;
  try {
    await api(`/api/tasks/${taskId}/dependencies`, { method: 'POST', body: { blocked_by_id: Number(e.target.value) } });
  } finally {
    e.target.value = '';
  }
  refreshTaskBlocked(taskId);
});

async function refreshTaskBlocked(taskId) {
  const fresh = await api(`/api/tasks/${taskId}`).catch(() => null);
  const task = state.tasks.find((t) => t.id === taskId);
  if (fresh && task) Object.assign(task, fresh);
  render();
  loadDependencies(taskId);
}

// ---------- Favorites and archive ----------

function renderProjectExtras(project) {
  const fav = $('project-fav');
  fav.textContent = project.favorite ? '★' : '☆';
  fav.classList.toggle('on', !!project.favorite);
  fav.setAttribute('aria-pressed', String(!!project.favorite));
  fav.title = project.favorite ? 'Remove from favorites' : 'Add to favorites';
  $('archived-banner').hidden = !project.archived;
  $('unarchive-btn').hidden = project.role !== 'owner';
}

document.getElementById('project-fav').addEventListener('click', async () => {
  const project = currentProject();
  if (!project) return;
  const updated = await api(`/api/projects/${project.id}/favorite`, { method: 'POST', body: { favorite: !project.favorite } });
  project.favorite = updated.favorite;
  renderProjectExtras(project);
  renderProjects();
});

async function setArchived(project, archived) {
  const updated = await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { archived } });
  project.archived = updated.archived;
  renderProjectExtras(project);
  renderProjects();
  toast(archived ? 'Project archived. Find it under Projects, Archived.' : 'Project is back in your sidebar');
}

document.getElementById('unarchive-btn').addEventListener('click', () => setArchived(currentProject(), false));

// ---------- Keyboard shortcuts ----------

const SHORTCUTS = [
  ['Q', 'Create a task'], ['/', 'Search this project (or everything)'], ['Ctrl K', 'Search everything'],
  ['G then H', 'Go to Home'], ['G then M', 'Go to My tasks'], ['G then I', 'Go to Inbox'], ['G then P', 'Go to Projects'],
  ['G then G', 'Go to Goals'], ['G then R', 'Go to Reporting'], ['Esc', 'Close the task panel or a dialog'], ['?', 'Show this list'],
];

function openShortcuts() {
  const { body } = openModal({ title: 'Keyboard shortcuts', className: 'create-modal' });
  const list = make('dl', 'shortcut-list');
  for (const [keys, what] of SHORTCUTS) {
    const dt = make('dt');
    for (const k of keys.split(' then ')) {
      if (dt.childNodes.length) dt.append(' then ');
      dt.append(make('kbd', '', k));
    }
    list.append(dt, make('dd', '', what));
  }
  body.append(list);
}

let goPending = 0;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop, .menu')) return;
  const key = e.key.toLowerCase();
  if (Date.now() - goPending < 1200) {
    goPending = 0;
    const to = { h: '/app', m: '/app/my-tasks', i: '/app/inbox', p: '/app/projects', g: '/app/goals', r: '/app/reporting' }[key];
    if (to) { e.preventDefault(); navigate(to); }
    return;
  }
  if (key === 'g') goPending = Date.now();
  else if (key === 'q') { e.preventDefault(); openNewTaskDialog(); }
  else if (e.key === '?') { e.preventDefault(); openShortcuts(); }
});
