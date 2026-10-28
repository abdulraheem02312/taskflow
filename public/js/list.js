// List view: tasks grouped under their sections, in the same order as the board.
// Sections can be collapsed, renamed, deleted and added here too, and rows can
// be dragged between them (the drag code lives in board.js).
// Loaded before app.js. Uses state, $, make, render, buildTaskRow, visibleTasks,
// filtersActive and the section helpers from board.js (only inside functions,
// so the load order is safe).

// Collapsed sections are remembered on this device
let collapsedSections = new Set();
try { collapsedSections = new Set(JSON.parse(localStorage.getItem('collapsed-sections') || '[]')); } catch {}

function saveCollapsed() {
  try { localStorage.setItem('collapsed-sections', JSON.stringify([...collapsedSections])); } catch {}
}

function renderTasks() {
  if (state.boardDirty || !$('task-list').children.length) renderListSections();
  renderListRows();
}

// Full rebuild: when the project, the view or the sections change
function renderListSections() {
  const list = $('task-list');
  list.replaceChildren();
  for (const section of state.sections) list.append(buildListSection(section));
  list.append(buildAddListSection());
  state.boardDirty = false;
}

// Light refresh: only rows and counts, so a half-typed task keeps its text and focus
function renderListRows() {
  const tasks = visibleTasks();
  const filtering = filtersActive();
  for (const group of $('task-list').querySelectorAll('.list-section')) {
    const inSection = tasksInSection(Number(group.dataset.dropSection), tasks);
    group.querySelector('.section-rows').replaceChildren(...inSection.map(buildTaskRow));
    group.querySelector('.column-count').textContent = inSection.filter((t) => !t.completed).length || '';
    group.hidden = filtering && inSection.length === 0; // while filtering, hide sections with no matches
  }
  $('empty-state').hidden = !filtering || tasks.length > 0;
  $('empty-state').textContent = 'No tasks match your search and filters.';
}

function buildListSection(section) {
  const collapsed = collapsedSections.has(section.id);
  const group = make('section', 'list-section' + (collapsed ? ' collapsed' : ''));
  group.dataset.dropSection = section.id;

  const head = make('div', 'list-section-head');
  const toggle = make('button', 'icon-btn section-toggle');
  toggle.type = 'button';
  toggle.title = collapsed ? 'Expand section' : 'Collapse section';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  toggle.addEventListener('click', () => {
    const now = !group.classList.toggle('collapsed');
    if (now) collapsedSections.delete(section.id);
    else collapsedSections.add(section.id);
    toggle.title = now ? 'Collapse section' : 'Expand section';
    toggle.setAttribute('aria-expanded', String(now));
    saveCollapsed();
  });

  const dot = make('span', 'column-dot');
  dot.style.setProperty('--c', columnColor(section));

  const title = make('h2', 'list-section-title', section.name);
  title.contentEditable = 'true';
  title.spellcheck = false;
  title.title = 'Click to rename';
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape') { e.stopPropagation(); title.textContent = section.name; title.blur(); }
  });
  title.addEventListener('blur', () => renameSection(section, title));

  head.append(toggle, dot, title, make('span', 'column-count'));
  if (state.sections.length > 1) {
    const del = make('button', 'icon-btn column-delete', '×');
    del.type = 'button';
    del.title = 'Delete section';
    del.addEventListener('click', () => deleteSection(section));
    head.append(del);
  }

  const rows = make('ul', 'section-rows drop-list');

  // "Add task" at the bottom of each section adds the task right there
  const form = make('form', 'section-add');
  const input = make('input');
  input.placeholder = 'Add task...';
  input.maxLength = 200;
  input.setAttribute('aria-label', `Add a task to ${section.name}`);
  form.append(input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addTaskToSection(section.id, input);
  });

  group.append(head, rows, form);
  return group;
}

// Same button and form as the board's "+ Add section", styled for the list
function buildAddListSection() {
  const wrap = buildAddColumn();
  wrap.className = 'list-add-section';
  wrap.querySelector('.btn').className = 'btn-link list-add-btn';
  return wrap;
}
