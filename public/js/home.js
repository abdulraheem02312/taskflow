// Home dashboard and My Tasks: views over the tasks of every project.
// Home is made of widgets you can hide, resize and reorder (saved with your account).
// Loaded before app.js. Uses state, $, make, api, render, openDetail, createCheck,
// openMenu, openModal, openNewTaskDialog, openNewProjectDialog, openInviteDialog,
// avatar and the task helpers from the other files (only inside functions, so the
// load order is safe).



function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Earliest due date first, tasks without a date last
function byDue(a, b) {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id;
}

function byCompleted(a, b) {
  return (b.completed_at || '').localeCompare(a.completed_at || '') || b.id - a.id;
}

function projectOf(task) {
  return state.projects.find((p) => p.id === task.project_id);
}

// "Mine" = assigned to me, or unassigned in a project where I'm the only member
function isMine(task) {
  if (task.assignee_id) return task.assignee_id === state.user?.id;
  return (projectOf(task)?.member_count || 1) <= 1;
}

// Small link to a task's project, used in Home and My Tasks rows
function projectChip(task) {
  const project = projectOf(task);
  const name = project?.name || task.project_name || '';
  const chip = make('a', 'project-chip');
  chip.href = `/app/projects/${task.project_id}`;
  chip.title = `Open ${name}`;
  const dot = make('span', 'project-dot');
  dot.style.background = project?.color || task.project_color || '#fff';
  chip.append(dot, make('span', 'project-chip-name', name));
  return chip;
}

// ---------- Home: widgets ----------

const HOME_WIDGETS = {
  overview: { title: 'My week', about: 'Due today, overdue, finished this week and open tasks', fill: fillOverview },
  'my-tasks': { title: 'My tasks', about: 'Your upcoming, overdue and completed tasks', fill: fillMyTasksWidget },
  assigned: { title: "Tasks I've assigned", about: 'Tasks you gave to teammates, and how they are going', fill: fillAssignedWidget },
  people: { title: 'People', about: 'Who has overdue, finished and upcoming work', fill: fillPeopleWidget },
  projects: { title: 'Projects', about: 'Your projects and how far along they are', fill: fillProjectsWidget },
  notepad: { title: 'Private notepad', about: 'Notes, links and reminders only you can see', fill: fillNotepadWidget },
};

const DEFAULT_LAYOUT = [
  { id: 'overview', size: 'full' },
  { id: 'my-tasks', size: 'half' },
  { id: 'projects', size: 'half' },
  { id: 'assigned', size: 'half' },
  { id: 'people', size: 'half' },
  { id: 'notepad', size: 'full' },
];

const homeState = {
  loaded: false,      // layout and notepad have arrived from the server
  layout: [],         // [{ id, size: 'half' | 'full', hidden }]
  notepad: '',
  people: [],         // everyone you share a project with
  built: null,        // the layout the widgets on screen were built from
  tabs: { 'my-tasks': 'upcoming', assigned: 'upcoming' },
  layoutTimer: null,
  noteTimer: null,
};

// Saved layout, plus any widget added to Taskflow after it was saved
function normalizeLayout(saved) {
  const list = (Array.isArray(saved) ? saved : DEFAULT_LAYOUT)
    .filter((w) => HOME_WIDGETS[w.id])
    .map((w) => ({ id: w.id, size: w.size === 'full' ? 'full' : 'half', hidden: !!w.hidden }));
  for (const w of DEFAULT_LAYOUT) if (!list.some((x) => x.id === w.id)) list.push({ ...w, hidden: false });
  return list;
}

async function loadHomeExtras() {
  let prefs = null;
  let people;
  try {
    [prefs, people] = await Promise.all([homeState.loaded ? null : api('/api/me/home'), api('/api/people')]);
  } catch {
    return;
  }
  if (prefs) {
    homeState.layout = normalizeLayout(prefs.layout);
    homeState.notepad = prefs.notepad || '';
    homeState.loaded = true;
    homeState.built = null;
  }
  homeState.people = people;
  if (state.page === 'home') renderHome();
}

function renderHome() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (state.user?.name || '').split(/\s+/)[0];
  $('home-greeting').textContent = firstName ? `${greeting}, ${firstName}` : greeting;
  $('home-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // "✓ 3 tasks completed · 2 collaborators" for the last 7 days
  const weekAgo = Date.now() - 7 * 86400000;
  const doneThisWeek = state.tasks.filter((t) => isMine(t) && t.completed && Date.parse(t.completed_at) >= weekAgo).length;
  const others = Math.max(0, homeState.people.length - 1);
  const done = make('span');
  done.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  done.append(`${doneThisWeek} task${doneThisWeek === 1 ? '' : 's'} completed this week`);
  const team = make('span');
  team.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16a5 5 0 0 1 10 0M13 4.5a2.8 2.8 0 0 1 0 5.2M14.5 11.5a5 5 0 0 1 3 4.5"/></svg>';
  team.append(`${others} collaborator${others === 1 ? '' : 's'}`);
  $('home-summary').replaceChildren(done, team);
  if (!homeState.loaded) return;

  const key = JSON.stringify(homeState.layout);
  if (homeState.built !== key) buildHomeWidgets(key);
  for (const card of $('home-widgets').querySelectorAll('.home-widget')) {
    const widget = HOME_WIDGETS[card.dataset.widget];
    widget.fill(card.querySelector('.widget-body'), card.querySelector('.widget-tools'), card);
  }
}

// The cards themselves; rebuilt only when the layout changes, so typing in the
// notepad is never interrupted by a redraw
function buildHomeWidgets(key) {
  homeState.built = key;
  const box = $('home-widgets');
  box.replaceChildren();
  const visible = homeState.layout.filter((w) => !w.hidden);

  for (const w of visible) {
    const widget = HOME_WIDGETS[w.id];
    const card = make('section', `widget home-widget size-${w.size}` + (w.id === 'overview' ? ' widget-bare' : ''));
    card.dataset.widget = w.id;
    const head = make('div', 'widget-head');
    const more = make('button', 'icon-btn widget-more', '⋯');
    more.type = 'button';
    more.title = 'Widget options';
    more.setAttribute('aria-label', `${widget.title} options`);
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => openWidgetMenu(more, w.id));
    head.append(make('h2', '', widget.title), make('div', 'widget-tools'), more);
    card.append(head, make('div', 'widget-body'));
    box.append(card);
  }

  if (!visible.length) {
    const empty = make('div', 'page-empty home-empty-all');
    const btn = make('button', 'btn btn-primary', 'Add widgets');
    btn.type = 'button';
    btn.addEventListener('click', openCustomizeHome);
    empty.append(make('div', 'page-empty-icon', '▦'), make('h2', '', 'Your Home is empty'),
      make('p', '', 'Add the widgets you want to see when you open Taskflow.'), btn);
    box.append(empty);
  } else if (visible.length < homeState.layout.length) {
    const add = make('button', 'widget-add');
    add.type = 'button';
    add.innerHTML = '<span class="browse-plus" aria-hidden="true">+</span><span>Add widgets</span>';
    add.addEventListener('click', openCustomizeHome);
    box.append(add);
  }
}

function changeLayout(fn) {
  fn(homeState.layout);
  homeState.built = null;
  renderHome();
  clearTimeout(homeState.layoutTimer);
  homeState.layoutTimer = setTimeout(() => {
    api('/api/me/home', { method: 'PUT', body: { layout: homeState.layout } }).catch(() => {});
  }, 400);
}

// Move a widget among the visible ones (hidden ones keep their place)
function moveWidget(id, step) {
  changeLayout((layout) => {
    const visible = layout.filter((w) => !w.hidden);
    const i = visible.findIndex((w) => w.id === id);
    const other = visible[i + step];
    if (!other) return;
    const a = layout.indexOf(visible[i]);
    const b = layout.indexOf(other);
    [layout[a], layout[b]] = [layout[b], layout[a]];
  });
}

function openWidgetMenu(button, id) {
  const w = homeState.layout.find((x) => x.id === id);
  const visible = homeState.layout.filter((x) => !x.hidden);
  const i = visible.indexOf(w);
  const items = [
    {
      label: w.size === 'full' ? 'Make it half width' : 'Make it full width',
      icon: MENU_ICONS.wide,
      onClick: () => changeLayout(() => { w.size = w.size === 'full' ? 'half' : 'full'; }),
    },
  ];
  if (i > 0) items.push({ label: 'Move up', icon: MENU_ICONS.up, onClick: () => moveWidget(id, -1) });
  if (i < visible.length - 1) items.push({ label: 'Move down', icon: MENU_ICONS.down, onClick: () => moveWidget(id, 1) });
  items.push('separator', {
    label: 'Hide widget',
    icon: MENU_ICONS.hide,
    onClick: () => {
      changeLayout(() => { w.hidden = true; });
      toast(`"${HOME_WIDGETS[id].title}" hidden. Bring it back with Customize.`);
    },
  });
  openMenu(button, items, { align: 'right' });
}

// Customize: show or hide each widget, pick its width and its order
function openCustomizeHome() {
  const { body } = openModal({ title: 'Home widgets', className: 'customize-modal' });
  const intro = make('p', '', 'Turn a box on to show it on Home, off to hide it. To make a box wider or move it, use the ⋯ button on the box itself.');
  const list = make('ul', 'customize-list');
  const reset = make('button', 'btn-link', 'Reset to default');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    changeLayout((layout) => { layout.splice(0, layout.length, ...normalizeLayout(null)); });
    draw();
  });
  body.append(intro, list, reset);

  function draw() {
    list.replaceChildren();
    homeState.layout.forEach((w) => {
      const widget = HOME_WIDGETS[w.id];
      const li = make('li', 'customize-row' + (w.hidden ? ' off' : ''));

      const toggle = make('label', 'switch');
      const box = make('input');
      box.type = 'checkbox';
      box.checked = !w.hidden;
      box.setAttribute('aria-label', `Show ${widget.title}`);
      box.addEventListener('change', () => {
        changeLayout(() => { w.hidden = !box.checked; });
        draw();
      });
      toggle.append(box, make('span', 'switch-track'));

      const info = make('div', 'customize-info');
      info.append(make('span', 'customize-name', widget.title), make('span', 'customize-about', widget.about));

      li.append(toggle, info, make('span', 'customize-state', w.hidden ? 'Hidden' : 'Shown'));
      list.append(li);
    });
  }
  draw();
}

document.getElementById('home-customize').addEventListener('click', openCustomizeHome);

// ---------- Widget contents ----------

// Upcoming / Overdue / Completed tabs used by two widgets
function widgetTabs(tools, id) {
  const seg = make('div', 'seg');
  seg.setAttribute('role', 'tablist');
  for (const [value, label] of [['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Completed']]) {
    const on = homeState.tabs[id] === value;
    const btn = make('button', 'seg-btn' + (on ? ' active' : ''), label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(on));
    btn.addEventListener('click', () => {
      homeState.tabs[id] = value;
      renderHome();
    });
    seg.append(btn);
  }
  tools.replaceChildren(seg);
}

function pickTab(tasks, tab) {
  const today = dateKey(new Date());
  if (tab === 'overdue') return tasks.filter((t) => !t.completed && t.due_date && t.due_date < today).sort(byDue);
  if (tab === 'completed') return tasks.filter((t) => t.completed).sort(byCompleted);
  return tasks.filter((t) => !t.completed && (!t.due_date || t.due_date >= today)).sort(byDue);
}

function widgetFooter(...parts) {
  const foot = make('div', 'widget-foot');
  foot.append(...parts);
  return foot;
}

function footerLink(text, href) {
  const link = make('a', 'widget-link', text);
  link.href = href;
  return link;
}

function footerButton(text, onClick) {
  const btn = make('button', 'btn-link widget-action', text);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function fillOverview(body) {
  const today = dateKey(new Date());
  const mine = state.tasks.filter(isMine);
  const open = mine.filter((t) => !t.completed);
  const weekAgo = Date.now() - 7 * 86400000;
  const stats = [
    { label: 'Due today', value: open.filter((t) => t.due_date === today).length, kind: 'today' },
    { label: 'Overdue', value: open.filter((t) => t.due_date && t.due_date < today).length, kind: 'alert' },
    { label: 'Completed, last 7 days', value: mine.filter((t) => t.completed && Date.parse(t.completed_at) >= weekAgo).length, kind: 'done' },
    { label: 'Open tasks', value: open.length, kind: 'open' },
  ];
  const box = make('div', 'stats');
  for (const s of stats) {
    // The number only gets its color when there is something to show (0 stays calm)
    const card = make('a', `stat ${s.kind}` + (s.value ? '' : ' zero'));
    card.href = '/app/my-tasks';
    card.append(make('span', 'stat-value', String(s.value)), make('span', 'stat-label', s.label));
    box.append(card);
  }
  body.replaceChildren(box);
}

function fillMyTasksWidget(body, tools) {
  widgetTabs(tools, 'my-tasks');
  const tab = homeState.tabs['my-tasks'];
  const list = pickTab(state.tasks.filter(isMine), tab);
  const ul = make('ul', 'home-list');
  for (const task of list.slice(0, 7)) ul.append(buildHomeRow(task));
  if (!list.length) {
    const empty = {
      upcoming: state.projects.length ? 'Nothing coming up. Enjoy the calm.' : 'Create a project to start adding tasks.',
      overdue: 'No overdue tasks. Nice work.',
      completed: 'Tasks you complete will show up here.',
    };
    ul.append(make('li', 'home-empty', empty[tab]));
  }
  body.replaceChildren(ul, widgetFooter(
    footerButton('+ Create task', () => openNewTaskDialog()),
    footerLink(list.length > 7 ? `View all ${list.length}` : 'View all tasks', '/app/my-tasks'),
  ));
}

function fillAssignedWidget(body, tools) {
  widgetTabs(tools, 'assigned');
  const me = state.user.id;
  const given = state.tasks.filter((t) => t.assigned_by === me && t.assignee_id && t.assignee_id !== me);
  const tab = homeState.tabs.assigned;
  const list = pickTab(given, tab);

  const ul = make('ul', 'home-list');
  for (const task of list.slice(0, 7)) {
    const li = buildHomeRow(task, { withProject: false });
    li.append(avatar({ id: task.assignee_id, name: task.assignee_name }));
    ul.append(li);
  }
  const alone = homeState.people.length <= 1;
  if (!list.length) {
    const text = alone ? 'Invite teammates, then assign them tasks to track them here.'
      : {
        upcoming: 'When you assign a task to a teammate, you can follow it here.',
        overdue: 'Nothing you assigned is overdue.',
        completed: 'Tasks your teammates finish show up here.',
      }[tab];
    ul.append(make('li', 'home-empty', text));
  }
  body.replaceChildren(ul, widgetFooter(alone
    ? footerButton('+ Invite teammates', () => openInviteDialog())
    : footerButton('+ Assign a task', () => openNewTaskDialog())));
}

function fillPeopleWidget(body) {
  const today = dateKey(new Date());
  const week = addDays(7);
  const weekAgo = Date.now() - 7 * 86400000;
  const me = state.user.id;
  const people = homeState.people.length ? homeState.people : [state.user];

  const ul = make('ul', 'people-list');
  for (const person of people) {
    const theirs = state.tasks.filter((t) => (person.id === me ? isMine(t) : t.assignee_id === person.id));
    const overdue = theirs.filter((t) => !t.completed && t.due_date && t.due_date < today).length;
    const done = theirs.filter((t) => t.completed && Date.parse(t.completed_at) >= weekAgo).length;
    const upcoming = theirs.filter((t) => !t.completed && t.due_date && t.due_date >= today && t.due_date <= week).length;

    const li = make('li', 'person-row');
    const info = make('div', 'person-info');
    info.append(make('span', 'person-name', person.id === me ? `${person.name} (you)` : person.name),
      make('span', 'person-email', person.email || ''));
    const chips = make('div', 'person-chips');
    chips.append(
      make('span', 'person-chip overdue' + (overdue ? '' : ' zero'), `${overdue} overdue`),
      make('span', 'person-chip done' + (done ? '' : ' zero'), `${done} completed`),
      make('span', 'person-chip' + (upcoming ? '' : ' zero'), `${upcoming} upcoming`),
    );
    li.title = 'Completed in the last 7 days, upcoming in the next 7 days';
    li.append(avatar(person, 'md'), info, chips);
    ul.append(li);
  }
  const parts = [ul];
  if (people.length <= 1) {
    parts.push(make('p', 'home-empty people-hint', 'Invite teammates to see who is on track and who needs help.'));
    parts.push(widgetFooter(footerButton('+ Invite teammates', () => openInviteDialog())));
  }
  body.replaceChildren(...parts);
}

function fillProjectsWidget(body, tools, card) {
  const grid = make('div', 'project-grid' + (card.classList.contains('size-full') ? ' wide' : ''));
  for (const project of state.projects.filter((p) => !p.archived).slice(0, 8)) {
    const total = project.total_tasks || 0;
    const done = total - (project.open_tasks || 0);
    const percent = total ? Math.round((done / total) * 100) : 0;

    const link = make('a', 'project-card');
    link.href = `/app/projects/${project.id}`;
    const icon = make('span', 'project-color', projectInitial(project));
    icon.style.background = project.color;
    const info = make('span', 'project-card-info');
    info.append(
      make('span', 'project-card-name', project.name),
      make('span', 'project-card-meta', total ? `${done} of ${total} done` : 'No tasks yet'),
    );
    const bar = make('span', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-label', `${project.name} progress`);
    const fill = make('span');
    fill.style.width = `${percent}%`;
    fill.style.setProperty('--fill', project.color);
    bar.append(fill);
    link.append(icon, info, bar);
    grid.append(link);
  }

  const add = make('button', 'project-card add');
  add.type = 'button';
  add.innerHTML = '<span class="plus">+</span><span>New project</span>';
  add.addEventListener('click', () => openNewProjectDialog());
  grid.append(add);
  body.replaceChildren(grid, widgetFooter(footerLink(
    state.projects.length > 8 ? `View all ${state.projects.length} projects` : 'View all projects', '/app/projects')));
}

// Saved to your account a moment after you stop typing
function fillNotepadWidget(body, tools) {
  if (body.querySelector('textarea')) return; // keep what is being typed
  const area = make('textarea', 'notepad');
  area.value = homeState.notepad;
  area.maxLength = 10000;
  area.placeholder = 'Jot down a quick note, a to-do or a link. Only you can see this.';
  area.setAttribute('aria-label', 'Private notepad');
  const status = make('span', 'notepad-status');
  tools.replaceChildren(status);
  area.addEventListener('input', () => {
    homeState.notepad = area.value;
    status.textContent = 'Saving...';
    clearTimeout(homeState.noteTimer);
    homeState.noteTimer = setTimeout(async () => {
      try {
        await api('/api/me/home', { method: 'PUT', body: { notepad: homeState.notepad } });
        status.textContent = 'Saved';
      } catch {
        status.textContent = 'Not saved';
      }
    }, 700);
  });
  body.replaceChildren(area);
}

function buildHomeRow(task, { withProject = true } = {}) {
  const li = make('li', 'home-row'
    + (task.completed ? ' done' : '')
    + (task.id === state.openTaskId ? ' selected' : '')
    + (withProject ? '' : ' no-project'));
  li.append(createCheck(task), make('span', 'home-title', task.title));
  if (withProject) li.append(projectChip(task));
  li.append(make('span', 'home-due' + (isOverdue(task) ? ' overdue' : ''), formatDue(task.due_date)));
  li.addEventListener('click', () => openDetail(task.id));
  return li;
}

