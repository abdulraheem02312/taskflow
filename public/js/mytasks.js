// My Tasks: every task that is yours, in To do / Doing / Done.
// List view shows three sections, Board view three columns you drag cards between
// (or move with the ‹ › buttons on touch screens and keyboards).
// "Doing" is personal; moving a task to Done completes it, moving it out reopens it.
// Loaded before app.js. Uses state, $, make, api, render, openDetail, updateTask,
// createCheck, isMine, byDue, byCompleted, projectChip, priorityBadge, formatDue,
// isOverdue, extraBadges, refreshCounts and openNewTaskDialog (only inside functions).

const MT_COLUMNS = [
  { id: 'todo', title: 'To do', hint: 'Not started yet', color: '#9ca3af' },
  { id: 'doing', title: 'Doing', hint: 'What you are working on now', color: '#fbbf24' },
  { id: 'done', title: 'Done', hint: 'Finished in the last 14 days', color: '#4ade80' },
];

let mtView = 'list';
try { if (localStorage.getItem('mytasks-view') === 'board') mtView = 'board'; } catch {}
const mtCollapsed = new Set();

function mtColumnOf(task) {
  if (task.completed) return 'done';
  return task.my_state === 'doing' ? 'doing' : 'todo';
}

function myTaskGroups() {
  const mine = state.tasks.filter(isMine);
  const twoWeeksAgo = Date.now() - 14 * 86400000;
  return {
    todo: mine.filter((t) => mtColumnOf(t) === 'todo').sort(byDue),
    doing: mine.filter((t) => mtColumnOf(t) === 'doing').sort(byDue),
    done: mine.filter((t) => t.completed && (!t.completed_at || Date.parse(t.completed_at) >= twoWeeksAgo)).sort(byCompleted),
  };
}

// Move a task between columns (shown right away, then saved)
async function setMyColumn(task, column) {
  const from = mtColumnOf(task);
  if (from === column) return;
  const doing = column === 'doing' ? 'doing' : null;
  if (column === 'done') {
    task.my_state = null;
    api(`/api/my-tasks/${task.id}/state`, { method: 'POST', body: { state: 'todo' } }).catch(() => {});
    await toggleComplete(task);
    return;
  }
  task.my_state = doing;
  if (from === 'done') await updateTask(task, { completed: false });
  else render();
  await api(`/api/my-tasks/${task.id}/state`, { method: 'POST', body: { state: doing ? 'doing' : 'todo' } });
  if (from === 'done') refreshCounts();
}

function renderMyTasks() {
  const groups = myTaskGroups();
  const today = dateKey(new Date());
  const overdue = [...groups.todo, ...groups.doing].filter((t) => t.due_date && t.due_date < today).length;
  $('mytasks-sub').textContent = `${groups.todo.length} to do · ${groups.doing.length} doing · ${groups.done.length} done lately`
    + (overdue ? ` · ${overdue} overdue` : '');
  for (const btn of document.querySelectorAll('#mt-views .seg-btn')) {
    btn.classList.toggle('active', btn.dataset.view === mtView);
    btn.setAttribute('aria-pressed', String(btn.dataset.view === mtView));
  }

  const body = $('mytasks-body');
  const scroll = body.scrollTop;
  if (!state.tasks.filter(isMine).length) {
    const empty = make('div', 'page-empty');
    const add = make('button', 'btn btn-primary', '+ Add a task');
    add.type = 'button';
    add.addEventListener('click', () => openNewTaskDialog());
    empty.append(make('div', 'page-empty-icon', '✓'), make('h2', '', 'Nothing on your plate'),
      make('p', '', 'Tasks assigned to you, and tasks in your personal projects, show up here in To do, Doing and Done.'), add);
    body.replaceChildren(empty);
    return;
  }
  body.replaceChildren(mtView === 'board' ? buildMyBoard(groups) : buildMyList(groups));
  body.scrollTop = scroll;
}

// ---------- List ----------

function buildMyList(groups) {
  const wrap = make('div', 'mt-list');
  for (const col of MT_COLUMNS) {
    const tasks = groups[col.id];
    const collapsed = mtCollapsed.has(col.id);
    const card = make('section', 'widget mt-section' + (collapsed ? ' collapsed' : ''));
    card.dataset.column = col.id;
    const head = make('button', 'mt-section-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!collapsed));
    head.innerHTML = '<svg class="mt-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
    const dot = make('span', 'column-dot');
    dot.style.setProperty('--c', col.color);
    head.append(dot, make('span', 'mt-section-title', col.title), make('span', 'mt-count', String(tasks.length)), make('span', 'mt-hint', col.hint));
    head.addEventListener('click', () => {
      if (mtCollapsed.has(col.id)) mtCollapsed.delete(col.id);
      else mtCollapsed.add(col.id);
      renderMyTasks();
    });
    card.append(head);
    if (!collapsed) {
      const ul = make('ul', 'mt-rows');
      for (const task of tasks) ul.append(buildMyRow(task, col.id));
      if (!tasks.length) ul.append(make('li', 'mt-empty', { todo: 'Nothing waiting. Nice.', doing: 'Start a task from To do to see it here.', done: 'Tasks you finish show up here.' }[col.id]));
      card.append(ul);
      if (col.id === 'todo') {
        const add = make('button', 'mt-add-row', '+ Add task');
        add.type = 'button';
        add.addEventListener('click', () => openNewTaskDialog());
        card.append(add);
      }
    }
    wrap.append(card);
  }
  return wrap;
}

function buildMyRow(task, column) {
  const li = make('li', 'mt-row' + (task.completed ? ' done' : '') + (task.id === state.openTaskId ? ' selected' : ''));
  const name = make('span', 'mt-name');
  name.append(make('span', 'mt-title', task.title), ...extraBadges(task));
  const due = make('span', 'mt-due' + (isOverdue(task) ? ' overdue' : ''), formatDue(task.due_date));
  const prio = make('span', 'mt-prio');
  const badge = priorityBadge(task);
  if (badge) prio.append(badge);
  li.append(createCheck(task), name, projectChip(task), prio, due, moveButtons(task, column));
  li.addEventListener('click', () => openDetail(task.id));
  return li;
}

// ‹ › buttons: move one column left or right (also the touch and keyboard way)
function moveButtons(task, column) {
  const box = make('span', 'mt-move');
  const i = MT_COLUMNS.findIndex((c) => c.id === column);
  for (const [step, label] of [[-1, '‹'], [1, '›']]) {
    const target = MT_COLUMNS[i + step];
    if (!target) continue;
    const b = make('button', 'icon-btn', label);
    b.type = 'button';
    b.title = `Move to ${target.title}`;
    b.setAttribute('aria-label', `Move "${task.title}" to ${target.title}`);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setMyColumn(task, target.id);
    });
    box.append(b);
  }
  return box;
}

// ---------- Board ----------

let mtDragId = null;

function buildMyBoard(groups) {
  const board = make('div', 'mt-board');
  for (const col of MT_COLUMNS) {
    const column = make('section', 'mt-col');
    column.dataset.column = col.id;
    const head = make('div', 'mt-col-head');
    const dot = make('span', 'column-dot');
    dot.style.setProperty('--c', col.color);
    head.append(dot, make('span', 'mt-section-title', col.title), make('span', 'mt-count', String(groups[col.id].length)));
    const list = make('div', 'mt-cards');
    for (const task of groups[col.id]) list.append(buildMyCard(task, col.id));
    if (!groups[col.id].length) list.append(make('p', 'mt-drop-hint', 'Drop tasks here'));
    column.append(head, list);
    if (col.id === 'todo') {
      const add = make('button', 'mt-add-row', '+ Add task');
      add.type = 'button';
      add.addEventListener('click', () => openNewTaskDialog());
      column.append(add);
    }

    // Native drag and drop (mouse); the column lights up while a card is over it
    column.addEventListener('dragover', (e) => {
      if (mtDragId === null) return;
      e.preventDefault();
      column.classList.add('over');
    });
    column.addEventListener('dragleave', (e) => { if (!column.contains(e.relatedTarget)) column.classList.remove('over'); });
    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('over');
      const task = state.tasks.find((t) => t.id === mtDragId);
      mtDragId = null;
      if (task) setMyColumn(task, col.id);
    });
    board.append(column);
  }
  return board;
}

function buildMyCard(task, column) {
  const card = make('article', 'mt-card' + (task.completed ? ' done' : '') + (task.id === state.openTaskId ? ' selected' : ''));
  card.draggable = true;
  card.tabIndex = 0;
  const top = make('div', 'mt-card-top');
  top.append(createCheck(task), make('span', 'mt-title', task.title));
  const meta = make('div', 'mt-card-meta');
  meta.append(projectChip(task));
  const badge = priorityBadge(task);
  if (badge) meta.append(badge);
  meta.append(...extraBadges(task));
  if (task.due_date) meta.append(make('span', 'mt-due' + (isOverdue(task) ? ' overdue' : ''), formatDue(task.due_date)));
  card.append(top, meta, moveButtons(task, column));
  card.addEventListener('click', () => openDetail(task.id));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(task.id); });
  card.addEventListener('dragstart', (e) => {
    mtDragId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    mtDragId = null;
    document.querySelectorAll('.mt-col.over').forEach((c) => c.classList.remove('over'));
  });
  return card;
}

// ---------- Header controls ----------

for (const btn of document.querySelectorAll('#mt-views .seg-btn')) {
  btn.addEventListener('click', () => {
    mtView = btn.dataset.view;
    try { localStorage.setItem('mytasks-view', mtView); } catch {}
    renderMyTasks();
  });
}
document.getElementById('mt-add').addEventListener('click', () => openNewTaskDialog());
