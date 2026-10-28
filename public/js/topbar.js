// Top bar: sidebar toggle, the Create menu (task, project, invite), the account
// menu, and the small dropdown menu helper the Home widgets use too.
// Loaded before app.js. Uses state, $, make, api, render, navigate, toast,
// openModal, openDetail, loadMembers, refreshCounts, setThemePreference,
// themePreference, avatar and ACCENTS from the other files (only inside
// functions, so the load order is safe).

const MENU_ICONS = {
  task: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M7 10.2l2 2 4-4.4"/></svg>',
  project: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/></svg>',
  invite: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="7" r="3"/><path d="M2.5 16a5.5 5.5 0 0 1 11 0M15 6v6M12 9h6"/></svg>',
  settings: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>',
  logout: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 6.5L15.5 10 12 13.5M15.5 10H8"/></svg>',
  hide: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><path d="M4 16L16 4"/></svg>',
  wide: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3"/></svg>',
  up: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M6 9l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M6 11l4 4 4-4"/></svg>',
};

// ---------- Dropdown menu ----------
// items: { label, icon, onClick, danger, hint } | 'separator' | { element }

let openMenuState = null;

function closeMenu({ focusAnchor = false } = {}) {
  if (!openMenuState) return;
  const { menu, anchor, onDocDown, onKey } = openMenuState;
  document.removeEventListener('pointerdown', onDocDown, true);
  document.removeEventListener('keydown', onKey, true);
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  openMenuState = null;
  if (focusAnchor) anchor.focus();
}

function openMenu(anchor, items, { align = 'left', className = '' } = {}) {
  const sameAnchor = openMenuState?.anchor === anchor;
  closeMenu();
  if (sameAnchor) return; // a second click on the same button closes it

  const menu = make('div', `menu ${className}`);
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'separator') {
      menu.append(make('div', 'menu-sep'));
    } else if (item.element) {
      menu.append(item.element);
    } else {
      const btn = make('button', 'menu-item' + (item.danger ? ' danger' : ''));
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      if (item.icon) btn.innerHTML = item.icon;
      btn.append(make('span', 'menu-label', item.label));
      if (item.hint) btn.append(make('span', 'menu-hint', item.hint));
      btn.addEventListener('click', () => {
        closeMenu();
        item.onClick();
      });
      menu.append(btn);
    }
  }
  document.body.append(menu);

  // Under the button, kept inside the window
  const r = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  let left = align === 'right' ? r.right - width : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const buttons = () => [...menu.querySelectorAll('.menu-item, .menu-choice')];
  function onDocDown(e) {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  }
  // Arrow keys move between items; Escape closes only the menu
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ focusAnchor: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = buttons();
      const i = list.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  }
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  openMenuState = { menu, anchor, onDocDown, onKey };
  buttons()[0]?.focus();
  return menu;
}

// ---------- Sidebar toggle ----------
// On phones it slides the sidebar in; on bigger screens it hides it (remembered)

const phoneQuery = matchMedia('(max-width: 700px)');
try { document.body.classList.toggle('sidebar-collapsed', localStorage.getItem('sidebar-collapsed') === '1'); } catch {}

document.getElementById('sidebar-toggle').addEventListener('click', (e) => {
  e.stopPropagation(); // the "click outside closes the sidebar" handler shouldn't undo this
  if (phoneQuery.matches) {
    document.body.classList.toggle('sidebar-open');
    return;
  }
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); } catch {}
});

// ---------- Create menu ----------

document.getElementById('create-btn').addEventListener('click', (e) => {
  openMenu(e.currentTarget, [
    { label: 'Task', icon: MENU_ICONS.task, onClick: () => openNewTaskDialog() },
    { label: 'Project', icon: MENU_ICONS.project, onClick: () => openNewProjectDialog() },
    { label: 'Portfolio', icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6" width="14" height="10" rx="1.5"/><path d="M7.5 6V4.5h5V6M3 10.5h14"/></svg>', onClick: () => openNewPortfolioDialog() },
    { label: 'Goal', icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/></svg>', onClick: () => openGoalDialog() },
    'separator',
    { label: 'Invite teammates', icon: MENU_ICONS.invite, onClick: () => openInviteDialog() },
  ], { className: 'create-menu' });
});

document.getElementById('invite-btn').addEventListener('click', () => openInviteDialog());
document.getElementById('new-project-btn').addEventListener('click', () => openNewProjectDialog());

// A labelled field for the dialogs below
function dialogField(label, control) {
  const field = make('label', 'field');
  field.append(label, control);
  return field;
}

function projectSelect(selectedId) {
  const select = make('select');
  for (const p of state.projects) select.append(new Option(p.name, p.id));
  if (selectedId) select.value = String(selectedId);
  return select;
}

function noProjectsNote(body, close, text) {
  body.append(make('p', '', text));
  const actions = make('div', 'modal-actions');
  const create = make('button', 'btn btn-primary', 'Create a project');
  create.type = 'button';
  create.addEventListener('click', () => { close(); openNewProjectDialog(); });
  actions.append(create);
  body.append(actions);
}

function dialogActions(submitText) {
  const actions = make('div', 'modal-actions');
  const cancel = make('button', 'btn btn-ghost', 'Cancel');
  cancel.type = 'button';
  const submit = make('button', 'btn btn-primary', submitText);
  submit.type = 'submit';
  actions.append(cancel, submit);
  return { actions, cancel, submit };
}

// New task: name, project, due date and assignee, from anywhere in the app
function openNewTaskDialog({ projectId } = {}) {
  const { body, close } = openModal({ title: 'New task', className: 'create-modal' });
  if (!state.projects.length) return noProjectsNote(body, close, 'Tasks live inside projects. Create your first project, then add tasks to it.');

  const form = make('form', 'settings-form');
  const title = make('input');
  title.name = 'title';
  title.required = true;
  title.maxLength = 200;
  title.placeholder = 'What needs to be done?';
  title.autocomplete = 'off';
  const defaultProject = projectId || (state.page === 'project' ? state.projectId : state.projects[0].id);
  const project = projectSelect(defaultProject);
  const due = make('input');
  due.type = 'date';
  const assignee = make('select');

  async function fillAssignees() {
    const pid = Number(project.value);
    assignee.replaceChildren(new Option('Unassigned', ''));
    const data = await loadMembers(pid);
    if (Number(project.value) !== pid) return;
    for (const m of data.members) assignee.append(new Option(m.id === state.user.id ? `${m.name} (you)` : m.name, m.id));
  }
  project.addEventListener('change', fillAssignees);
  fillAssignees();

  const row = make('div', 'field-row');
  row.append(dialogField('Due date', due), dialogField('Assignee', assignee));
  const { actions, cancel, submit } = dialogActions('Create task');
  cancel.addEventListener('click', close);
  form.append(dialogField('Task name', title), dialogField('Project', project), row, actions);
  body.append(form);
  title.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = Number(project.value);
    submit.disabled = true;
    let task;
    try {
      task = await api(`/api/projects/${pid}/tasks`, { method: 'POST', body: { title: title.value, due_date: due.value } });
      if (assignee.value) task = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { assignee_id: Number(assignee.value) } });
    } catch {
      submit.disabled = false;
      return;
    }
    close();
    toast('Task created');
    showCreatedTask(task);
  });
}

// After creating a task, show it where the user is, or go to its project
async function showCreatedTask(task) {
  if (state.page === 'project' && state.projectId === task.project_id) {
    state.tasks.push(task);
    render();
    openDetail(task.id);
  } else if (state.page === 'home' || state.page === 'my-tasks') {
    state.tasks = await api('/api/my-tasks');
    render();
    openDetail(task.id);
  } else {
    navigate(`/app/projects/${task.project_id}?task=${task.id}`);
  }
  refreshCounts();
}

// New project: name and color
function openNewProjectDialog() {
  const { body, close } = openModal({ title: 'New project', className: 'create-modal' });
  const form = make('form', 'settings-form');
  const name = make('input');
  name.maxLength = 80;
  name.placeholder = 'For example: Website launch';
  name.autocomplete = 'off';

  // Color swatches (radio buttons, so arrow keys work)
  let color = ACCENTS[state.projects.length % ACCENTS.length];
  const swatches = make('div', 'swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'Color');
  for (const c of ACCENTS) {
    const label = make('label', 'swatch');
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'color';
    radio.value = c;
    radio.checked = c === color;
    radio.setAttribute('aria-label', c);
    radio.addEventListener('change', () => { color = c; });
    const dot = make('span');
    dot.style.background = c;
    label.append(radio, dot);
    swatches.append(label);
  }
  const colorField = make('div', 'field');
  colorField.append('Color', swatches);

  // Start blank, or from a ready-made template (sections and starter tasks)
  const template = make('select');
  template.append(new Option('Blank project', ''));
  const about = make('p', 'field-hint');
  api('/api/templates').then((list) => {
    for (const t of list) template.append(new Option(t.name, t.key));
    template.addEventListener('change', () => {
      const t = list.find((x) => x.key === template.value);
      about.textContent = t ? `${t.about}. Sections: ${t.sections.join(', ')}.` : '';
      if (t && !name.value) name.placeholder = t.name;
    });
  }).catch(() => {});

  const { actions, cancel, submit } = dialogActions('Create project');
  cancel.addEventListener('click', close);
  form.append(dialogField('Project name', name), dialogField('Start from', template), about, colorField, actions);
  body.append(form);
  name.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    let project;
    try {
      if (!template.value && !name.value.trim()) { toast('Give the project a name', 'error'); submit.disabled = false; return; }
      project = template.value
        ? await api('/api/projects/from-template', { method: 'POST', body: { template: template.value, name: name.value, color } })
        : await api('/api/projects', { method: 'POST', body: { name: name.value, color } });
    } catch {
      submit.disabled = false;
      return;
    }
    close();
    state.projects.push({ ...project, open_tasks: 0, total_tasks: 0, member_count: 1, my_open: 0 });
    navigate(`/app/projects/${project.id}`);
  });
}

// Invite: an email and the project they should join
function openInviteDialog() {
  const { body, close } = openModal({ title: 'Invite teammates', className: 'create-modal' });
  if (!state.projects.length) return noProjectsNote(body, close, 'People join a project. Create one first, then invite your teammates to it.');

  const form = make('form', 'settings-form');
  const email = make('input');
  email.type = 'email';
  email.required = true;
  email.placeholder = 'teammate@example.com';
  email.autocomplete = 'off';
  const project = projectSelect(state.page === 'project' ? state.projectId : null);
  const note = make('p', 'field-hint',
    'People who already use Taskflow join right away. Anyone else joins when they sign up with this email. No email is sent, so share the link yourself.');
  const { actions, cancel, submit } = dialogActions('Send invite');
  cancel.addEventListener('click', close);
  form.append(dialogField('Email', email), dialogField('Project', project), note, actions);
  body.append(form);
  email.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const pid = Number(project.value);
    try {
      const result = await api(`/api/projects/${pid}/members`, { method: 'POST', body: { email: email.value.trim() } });
      toast(result.added ? `${result.added.name} joined the project` : `Invite saved for ${result.invited}`);
    } catch {
      submit.disabled = false;
      return;
    }
    close();
    membersCache.delete(pid);
    if (state.page === 'project' && state.projectId === pid) renderProjectTeam(currentProject());
    refreshCounts();
  });
}

// ---------- Account menu ----------

document.getElementById('user-btn').addEventListener('click', (e) => {
  const head = make('div', 'menu-user');
  const info = make('div', 'menu-user-info');
  info.append(make('span', 'menu-user-name', state.user.name), make('span', 'menu-user-email', state.user.email));
  head.append(avatar(state.user, 'md'), info);

  // Theme: System / Light / Dark, switches right away and keeps the menu open
  const themeRow = make('div', 'menu-theme');
  themeRow.append(make('span', 'menu-theme-label', 'Theme'));
  const choices = make('div', 'seg');
  for (const [value, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
    const btn = make('button', 'seg-btn menu-choice' + (themePreference() === value ? ' active' : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      setThemePreference(value);
      for (const b of choices.children) b.classList.toggle('active', b === btn);
    });
    choices.append(btn);
  }
  themeRow.append(choices);

  openMenu(e.currentTarget, [
    { element: head },
    'separator',
    { label: 'Settings', icon: MENU_ICONS.settings, onClick: () => navigate('/app/settings') },
    { element: themeRow },
    'separator',
    { label: 'Log out', icon: MENU_ICONS.logout, danger: true, onClick: logOut },
  ], { align: 'right', className: 'user-menu' });
});

async function logOut() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}
