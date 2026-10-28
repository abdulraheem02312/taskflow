const state = {
  user: null,
  page: 'home',       // 'home', 'my-tasks' or 'project'
  projects: [],
  projectId: null,
  tasks: [],
  sections: [],
  tags: [],           // all of the user's tags
  subtasks: [],       // subtasks of the task open in the detail panel
  openTaskId: null,
  view: 'list',       // 'list' or 'board'
  boardDirty: true,   // board columns / list sections need a full rebuild
};

const $ = (id) => document.getElementById(id);

// Accent colors for projects, tags and board columns (black and white UI, colored meaning)
const ACCENTS = ['#60a5fa', '#4ade80', '#a78bfa', '#fbbf24', '#f472b6', '#2dd4bf', '#fb923c', '#f87171'];

// Create an element with an optional class and text
function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------- API helper ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Not logged in');
  }
  const data = await res.json();
  if (!res.ok) {
    toast(data.error || 'Something went wrong', 'error');
    throw new Error(data.error);
  }
  return data;
}

// ---------- Projects ----------

function currentProject() {
  return state.projects.find((p) => p.id === state.projectId);
}

async function loadProjects() {
  state.projects = await api('/api/projects');
  renderProjects();
}

// Sidebar: project links, which page is active, and the My Tasks count
// Archived projects stay out of the sidebar; favorites get their own list on top
function renderProjects() {
  const link = (project) => {
    const li = make('li');
    const a = make('a', 'project-item'
      + (state.page === 'project' && project.id === state.projectId ? ' active' : ''));
    a.href = `/app/projects/${project.id}`;
    const dot = make('span', 'project-dot');
    dot.style.background = project.color;
    a.append(dot, make('span', 'project-name', project.name), make('span', 'project-count', project.open_tasks || ''));
    li.append(a);
    return li;
  };
  const active = state.projects.filter((p) => !p.archived);
  const favorites = active.filter((p) => p.favorite);
  $('favorites-group').hidden = !favorites.length;
  $('favorite-list').replaceChildren(...favorites.map(link));
  $('project-list').replaceChildren(...active.map(link));

  for (const link of document.querySelectorAll('.side-link')) {
    link.classList.toggle('active', link.dataset.page === state.page || (state.page === 'portfolio' && link.dataset.page === 'portfolios'));
  }
  // My Tasks count: open tasks assigned to you, or unassigned in your personal projects
  const open = state.projects.reduce((sum, p) => sum + (p.my_open || 0), 0);
  $('my-tasks-count').textContent = open || '';
}

// ---------- Pages and URLs ----------
// /app = Home, /app/my-tasks = My Tasks, /app/projects/12 = a project (?task=34 opens a task)

const PAGES = {
  home: 'home-page', 'my-tasks': 'mytasks-page', inbox: 'inbox-page', settings: 'settings-page',
  projects: 'projects-page', reporting: 'reporting-page', project: 'project-page',
  portfolios: 'portfolios-page', portfolio: 'portfolio-page', goals: 'goals-page',
};

function navigate(url) {
  if (url !== location.pathname + location.search) history.pushState(null, '', url);
  route();
}

window.addEventListener('popstate', route);

async function route() {
  const path = location.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/app\/projects\/(\d+)$/);
  const taskId = Number(new URLSearchParams(location.search).get('task')) || null;

  if (match) {
    const id = Number(match[1]);
    if (state.projects.some((p) => p.id === id)) return showProject(id, taskId);
    toast('That project does not exist anymore', 'error');
  } else if (path === '/app/projects') {
    return showProjectsPage();
  } else if (path === '/app/reporting') {
    return showReportingPage();
  } else if (path === '/app/portfolios') {
    return showPortfolios();
  } else if (/^\/app\/portfolios\/\d+$/.test(path)) {
    return showPortfolio(Number(path.split('/').pop()));
  } else if (path === '/app/goals') {
    return showGoals();
  } else if (path === '/app/settings') {
    return showSettings();
  } else if (path === '/app/inbox') {
    return showInbox();
  } else if (path === '/app/my-tasks') {
    return showMyTasks();
  }
  if (location.pathname !== '/app' || location.search) history.replaceState(null, '', '/app');
  return showHome();
}

function showPage(page) {
  state.page = page;
  for (const [name, id] of Object.entries(PAGES)) $(id).hidden = name !== page;
  document.body.classList.remove('sidebar-open');
  // Close the task panel without touching the URL
  state.openTaskId = null;
  closeTagPicker();
  $('detail').hidden = true;
  renderProjects();
}

async function showProject(id, taskId) {
  showPage('project');
  state.projectId = id;
  renderProjects();

  const project = currentProject();
  document.title = `${project.name} | Taskflow`;
  $('project-title').textContent = project.name;
  $('project-color').style.background = project.color;
  $('project-color').textContent = projectInitial(project);
  renderProjectTeam(project); // members, Share, owner-only controls
  renderProjectStatus(project);
  renderProjectExtras(project);
  revealActiveTab(); // the page was hidden when the view was picked

  await loadProjectData();
  if (taskId && state.page === 'project' && state.tasks.some((t) => t.id === taskId)) openDetail(taskId);
}

async function showHome() {
  showPage('home');
  state.projectId = null;
  document.title = 'Home | Taskflow';
  loadHomeExtras(); // widget layout, notepad and people (draws again when they arrive)
  await loadAllTasks();
}

async function showMyTasks() {
  showPage('my-tasks');
  state.projectId = null;
  document.title = 'My Tasks | Taskflow';
  await loadAllTasks();
}

// Home and My Tasks work on the tasks of every project
async function loadAllTasks() {
  const page = state.page;
  render(); // draw right away with what we have
  const tasks = await api('/api/my-tasks');
  if (state.page !== page) return; // user moved on while loading
  state.tasks = tasks;
  render();
}

// Links inside the app change the page without reloading it
// (Ctrl/Cmd+click still opens a new tab, because the server knows these URLs too)
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="/app"]');
  if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const inner = e.target.closest('button'); // e.g. the ☆ and ⋯ buttons on a project card
  if (inner && link.contains(inner)) return;
  e.preventDefault();
  e.stopPropagation(); // e.g. a project link inside a task row shouldn't also open the task
  navigate(link.getAttribute('href'));
}, true);

// Fetch the open project's sections and tasks, then redraw
async function loadProjectData() {
  const id = state.projectId;
  const [sections, tasks] = await Promise.all([
    api(`/api/projects/${id}/sections`),
    api(`/api/projects/${id}/tasks`),
  ]);
  if (id !== state.projectId) return; // user switched project while loading
  state.sections = sections;
  state.tasks = tasks;
  state.boardDirty = true;
  render();
}

// ---------- Views ----------

const VIEWS = ['list', 'board', 'calendar', 'timeline', 'dashboard', 'files'];

function render() {
  if (state.page === 'home') return renderHome();
  if (state.page === 'my-tasks') return renderMyTasks();
  if (state.page === 'inbox') return renderInbox();
  if (state.page === 'settings') return renderSettings();
  if (state.page === 'projects') return renderProjectsPage();
  if (state.page === 'reporting') return renderReporting();
  if (state.page === 'portfolios') return renderPortfolios();
  if (state.page === 'portfolio') return renderPortfolio();
  if (state.page === 'goals') return renderGoals();
  renderFilterBar();
  if (state.view === 'board') {
    if (state.boardDirty) renderBoard();
    else renderBoardCards();
  } else if (state.view === 'calendar') {
    renderCalendar();
  } else if (state.view === 'timeline') {
    renderTimeline();
  } else if (state.view === 'dashboard') {
    renderDashboard();
  } else if (state.view === 'files') {
    renderFiles();
  } else {
    renderTasks();
  }
}

function setView(view) {
  state.view = view;
  try { localStorage.setItem('view', view); } catch {}
  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.classList.toggle('active', tab.dataset.view === view);
  }
  revealActiveTab();
  for (const name of VIEWS) $(`${name}-view`).hidden = view !== name;
  $('filter-bar').hidden = view === 'dashboard' || view === 'files'; // the dashboard always shows the whole project
  state.boardDirty = true;
  render();
}

for (const tab of document.querySelectorAll('.view-tab')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}

// On phones the tabs scroll sideways: keep the chosen one in view
function revealActiveTab() {
  document.querySelector('.view-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
document.fonts?.ready.then(revealActiveTab); // the web font makes the tabs a bit wider once it loads

async function refreshCounts() {
  const projects = await api('/api/projects');
  state.projects = projects;
  renderProjects();
  // Project progress bars use these counts
  if (state.page === 'home') renderHome();
  if (state.page === 'projects') renderProjectsPage();
}

// Rename project by editing the header
$('project-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});

$('project-title').addEventListener('blur', async (e) => {
  const project = currentProject();
  const name = e.target.textContent.trim();
  if (!project || name === project.name) return;
  if (!name) { e.target.textContent = project.name; return; }
  const updated = await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name } });
  project.name = updated.name;
  $('project-color').textContent = projectInitial(project);
  renderProjects();
});

function projectInitial(project) {
  return (project.name.trim()[0] || '').toUpperCase();
}

// Called from the Project settings dialog
async function deleteCurrentProject() {
  const project = currentProject();
  if (!project) return;
  const sure = await confirmDialog({
    title: 'Delete this project?',
    message: `"${project.name}" and all of its tasks will be deleted. This can't be undone.`,
    confirmText: 'Delete project',
  });
  if (!sure) return;
  await api(`/api/projects/${project.id}`, { method: 'DELETE' });
  toast(`Deleted "${project.name}"`);
  state.projects = state.projects.filter((p) => p.id !== project.id);
  navigate('/app');
}

// ---------- Tasks ----------

function formatDue(date) {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A Date as 'YYYY-MM-DD' in local time (same format as task.due_date)
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isOverdue(task) {
  if (!task.due_date || task.completed) return false;
  return task.due_date < dateKey(new Date());
}

// The round complete button, used by list rows and board cards
function createCheck(task) {
  const check = document.createElement('button');
  check.className = 'check' + (task.id === poppedTaskId ? ' pop' : '');
  check.title = task.completed ? 'Mark incomplete' : 'Mark complete';
  check.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleComplete(task);
  });
  return check;
}

// One row of the list view (the sections around the rows are built in list.js)
function buildTaskRow(task) {
  const li = document.createElement('li');
  li.className = 'task-row'
    + (task.completed ? ' done' : '')
    + (task.id === state.openTaskId ? ' selected' : '');
  li.dataset.taskId = task.id;

  const check = createCheck(task);

  // Name cell: title, then tags and subtask progress
  const name = make('span', 'task-name');
  const title = make('span', 'task-title');
  title.append(highlight(task.title));
  name.append(title);
  for (const tag of taskTags(task)) name.append(tagPill(tag));
  const subs = subtaskCount(task);
  if (subs) name.append(subs);
  const talk = commentCount(task);
  if (talk) name.append(talk);
  const files = attachmentCount(task);
  if (files) name.append(files);
  name.append(...extraBadges(task));

  const priority = make('span', 'col-priority');
  const badge = priorityBadge(task);
  if (badge) priority.append(badge);

  const due = make('span', 'task-due' + (isOverdue(task) ? ' overdue' : ''), formatDue(task.due_date));

  const who = make('span', 'col-assignee');
  const face = assigneeAvatar(task);
  if (face) who.append(face);

  li.append(check, name, who, priority, due);
  // Rows can be dragged to another place or section, same as board cards
  li.addEventListener('click', () => { if (!justDragged) openDetail(task.id); });
  li.addEventListener('pointerdown', (e) => onCardPointerDown(e, task, li));
  li.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
  return li;
}

async function updateTask(task, changes) {
  const updated = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: changes });
  Object.assign(task, updated);
  render();
  if (state.openTaskId === task.id) fillDetail(task);
  return updated;
}

let poppedTaskId = null; // the task just ticked, so its check can do a small pop

async function toggleComplete(task) {
  if (!task.completed) poppedTaskId = task.id;
  const wasRepeating = !!task.repeat && !task.completed;
  await updateTask(task, { completed: !task.completed });
  poppedTaskId = null;
  afterCompleteMaybeRepeat(task, wasRepeating);
  refreshCounts();
}

$('new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const projectId = state.projectId;
  const body = { title: form.elements.title.value, due_date: form.elements.due_date.value };
  // Clear right away so fast typing goes into the next task, not this one
  form.reset();
  form.elements.title.focus();
  let task;
  try {
    task = await api(`/api/projects/${projectId}/tasks`, { method: 'POST', body });
  } catch {
    if (!form.elements.title.value) form.elements.title.value = body.title;
    return;
  }
  if (projectId !== state.projectId) return refreshCounts();
  state.tasks.push(task);
  render();
  refreshCounts();
});

// ---------- Task detail panel ----------

function openTask() {
  return state.tasks.find((t) => t.id === state.openTaskId);
}

function openDetail(id) {
  state.openTaskId = id;
  fillDetail(openTask());
  $('detail').hidden = false;
  render();
  loadSubtasks(id);
  loadDependencies(id);
  loadTaskLike(id);
  loadAttachments(id);
  loadComments(id);
  syncTaskUrl();
}

function closeDetail() {
  state.openTaskId = null;
  closeTagPicker();
  $('detail').hidden = true;
  render();
  syncTaskUrl();
}

// In a project, the open task is part of the URL, so the link can be shared or bookmarked
function syncTaskUrl() {
  if (state.page !== 'project') return;
  const url = `/app/projects/${state.projectId}` + (state.openTaskId ? `?task=${state.openTaskId}` : '');
  if (url !== location.pathname + location.search) history.replaceState(null, '', url);
}

function fillDetail(task) {
  // On Home and My Tasks, show which project the task belongs to
  const project = state.projects.find((p) => p.id === task.project_id);
  const link = $('detail-project');
  link.hidden = state.page === 'project' || !project;
  if (project) {
    link.href = `/app/projects/${project.id}?task=${task.id}`;
    const dot = make('span', 'project-dot');
    dot.style.background = project.color;
    link.replaceChildren(dot, make('span', '', project.name));
  }

  $('detail-title').value = task.title;
  $('detail-due').value = task.due_date || '';
  // A start date needs a due date first
  $('detail-repeat').value = task.repeat || '';
  $('detail-start').value = task.start_date || '';
  $('detail-start').disabled = !task.due_date;
  $('detail-start').title = task.due_date ? '' : 'Pick a due date first';
  fillSectionSelect(task);
  $('detail-notes').value = task.notes;
  const btn = $('detail-complete');
  btn.textContent = task.completed ? '✓ Completed' : 'Mark complete';
  btn.classList.toggle('is-done', !!task.completed);
  btn.disabled = !!task.completed; // a done task is reopened with "Undone"
  $('detail-undone').disabled = !task.completed; // always visible, only usable on a done task
  fillDetailExtras(task);
  fillAssignee(task);
}

$('detail-close').addEventListener('click', closeDetail);

$('detail-complete').addEventListener('click', () => toggleComplete(openTask()));
$('detail-undone').addEventListener('click', () => {
  const task = openTask();
  if (task?.completed) toggleComplete(task);
});

$('detail-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});

$('detail-title').addEventListener('blur', (e) => {
  const task = openTask();
  const title = e.target.value.trim();
  if (!task || title === task.title) return;
  if (!title) { e.target.value = task.title; return; }
  updateTask(task, { title });
});

$('detail-due').addEventListener('change', (e) => {
  const task = openTask();
  if (!task) return;
  const due = e.target.value;
  const changes = { due_date: due };
  // Due date moved before the start date: the task becomes a one-day task on that date
  if (task.start_date && due && due < task.start_date) changes.start_date = null;
  updateTask(task, changes);
});

$('detail-start').addEventListener('change', (e) => {
  const task = openTask();
  if (!task || !task.due_date) return;
  const start = e.target.value;
  // Start date after the due date: the due date moves to that day too
  updateTask(task, start > task.due_date ? { start_date: null, due_date: start } : { start_date: start || null });
});

// Section (project page only): moves the task to the end of that section
function fillSectionSelect(task) {
  const field = $('detail-section-field');
  field.hidden = state.page !== 'project' || !state.sections.length;
  if (field.hidden) return;
  const select = $('detail-section');
  select.replaceChildren(...state.sections.map((s) => new Option(s.name, s.id)));
  select.value = String(task.section_id);
}

$('detail-section').addEventListener('change', (e) => {
  const task = openTask();
  if (task) moveTask(task, Number(e.target.value), null);
});

$('detail-notes').addEventListener('blur', (e) => {
  const task = openTask();
  if (task && e.target.value !== task.notes) updateTask(task, { notes: e.target.value });
});

$('detail-delete').addEventListener('click', async () => {
  const task = openTask();
  if (!task) return;
  const sure = await confirmDialog({
    title: 'Delete this task?',
    message: `"${task.title}" and its subtasks, comments and files will be deleted. This can't be undone.`,
    confirmText: 'Delete task',
  });
  if (!sure) return;
  await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
  toast('Task deleted');
  state.tasks = state.tasks.filter((t) => t.id !== task.id);
  closeDetail();
  refreshCounts();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.openTaskId) closeDetail();
});

// ---------- User + layout ----------
// (The top bar, its menus and the sidebar toggle are in topbar.js)

// On mobile, tapping outside the sidebar closes it
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('sidebar-open') && !$('sidebar').contains(e.target)) {
    document.body.classList.remove('sidebar-open');
  }
});

async function init() {
  state.user = await api('/api/me');
  $('user-avatar').textContent = initialsOf(state.user.name);
  $('user-avatar').style.background = AVATAR_COLORS[state.user.id % AVATAR_COLORS.length];
  $('user-btn').title = `${state.user.name} (account)`;

  let savedView = null;
  try { savedView = localStorage.getItem('view'); } catch {}
  setView(VIEWS.includes(savedView) ? savedView : 'list');

  state.tags = await api('/api/tags');
  await loadProjects();
  route();
  refreshUnread();
}

init();
