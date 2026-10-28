// Board (Kanban) view: each section is a column, each task is a card.
// Loaded before app.js. Uses state, $, api, render and the task helpers from app.js
// (only inside functions, so the load order is safe).

let drag = null;          // the card being dragged, or null
let justDragged = false;  // stops the click that follows a drop from opening the task

function tasksInSection(sectionId, tasks = state.tasks) {
  return tasks
    .filter((t) => t.section_id === sectionId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

// Full rebuild: when the project, the view or the sections change
function renderBoard() {
  const board = $('board-view');
  const scroll = board.scrollLeft;
  board.innerHTML = '';
  for (const section of state.sections) board.append(buildColumn(section));
  board.append(buildAddColumn());
  board.scrollLeft = scroll;
  state.boardDirty = false;
  renderBoardCards();
}

// Light refresh: only cards and counts, so a half-typed task keeps its text and focus
function renderBoardCards() {
  for (const column of $('board-view').querySelectorAll('.column')) {
    const tasks = tasksInSection(Number(column.dataset.sectionId), visibleTasks());
    const list = column.querySelector('.column-cards');
    const scroll = list.scrollTop;
    list.innerHTML = '';
    for (const task of tasks) list.append(buildCard(task));
    list.scrollTop = scroll;
    column.querySelector('.column-count').textContent = tasks.filter((t) => !t.completed).length || '';
  }
}

// ---------- Columns ----------

function buildColumn(section) {
  const column = document.createElement('section');
  column.className = 'column';
  column.dataset.sectionId = section.id;
  column.dataset.dropSection = section.id; // drag and drop target (shared with the list view)

  const head = document.createElement('div');
  head.className = 'column-head';

  const title = document.createElement('h2');
  title.className = 'column-title';
  title.contentEditable = 'true';
  title.spellcheck = false;
  title.textContent = section.name;
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
  });
  title.addEventListener('blur', () => renameSection(section, title));

  const count = document.createElement('span');
  count.className = 'column-count';
  const dot = make('span', 'column-dot');
  dot.style.setProperty('--c', columnColor(section));
  head.append(dot, title, count);

  if (state.sections.length > 1) {
    const del = document.createElement('button');
    del.className = 'icon-btn column-delete';
    del.title = 'Delete section';
    del.innerHTML = '&times;';
    del.addEventListener('click', () => deleteSection(section));
    head.append(del);
  }

  const list = document.createElement('ul');
  list.className = 'column-cards drop-list';

  const form = document.createElement('form');
  form.className = 'column-add';
  const input = document.createElement('input');
  input.placeholder = '+ Add task';
  input.maxLength = 200;
  form.append(input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addTaskToSection(section.id, input);
  });

  column.append(head, list, form);
  return column;
}

// Status color for a column: common names get a meaning, others a color from the palette
function columnColor(section) {
  const name = section.name.trim().toLowerCase();
  if (/^(to ?do|backlog|ideas?|later)$/.test(name)) return '#9ca3af';
  if (/^(doing|in progress|working|active)$/.test(name)) return '#fbbf24';
  if (/^(review|testing|qa|in review)$/.test(name)) return '#a78bfa';
  if (/^(done|complete|completed|finished)$/.test(name)) return '#4ade80';
  if (/^(blocked|stuck|on hold)$/.test(name)) return '#ff6b6b';
  return ACCENTS[state.sections.indexOf(section) % ACCENTS.length];
}

function buildAddColumn() {
  const wrap = document.createElement('div');
  wrap.className = 'add-column';

  const button = document.createElement('button');
  button.className = 'btn btn-ghost';
  button.textContent = '+ Add section';

  const form = document.createElement('form');
  form.hidden = true;
  const input = document.createElement('input');
  input.placeholder = 'Section name';
  input.maxLength = 60;
  form.append(input);

  const close = () => {
    form.hidden = true;
    button.hidden = false;
    input.value = '';
  };

  button.addEventListener('click', () => {
    button.hidden = true;
    form.hidden = false;
    input.focus();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  input.addEventListener('blur', () => { if (!input.value.trim()) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const section = await api(`/api/projects/${state.projectId}/sections`, { method: 'POST', body: { name } });
    state.sections.push(section);
    state.boardDirty = true;
    render();
    $('board-view').scrollLeft = $('board-view').scrollWidth;
  });

  wrap.append(button, form);
  return wrap;
}

async function addTaskToSection(sectionId, input) {
  const title = input.value.trim();
  if (!title) return;
  const projectId = state.projectId;
  input.value = ''; // clear right away, same as the list view
  let task;
  try {
    task = await api(`/api/projects/${projectId}/tasks`, { method: 'POST', body: { title, section_id: sectionId } });
  } catch {
    if (!input.value) input.value = title;
    return;
  }
  if (projectId !== state.projectId) return refreshCounts();
  state.tasks.push(task);
  render();
  refreshCounts();
  const list = input.closest('.column')?.querySelector('.column-cards');
  if (list) list.scrollTop = list.scrollHeight;
}

async function renameSection(section, el) {
  const name = el.textContent.trim();
  if (name === section.name) return;
  if (!name) { el.textContent = section.name; return; }
  try {
    const updated = await api(`/api/sections/${section.id}`, { method: 'PATCH', body: { name } });
    section.name = updated.name;
    el.parentElement.querySelector('.column-dot')?.style.setProperty('--c', columnColor(section));
  } catch {
    el.textContent = section.name;
  }
}

async function deleteSection(section) {
  const target = state.sections.find((s) => s.id !== section.id);
  const count = tasksInSection(section.id).length;
  const message = count
    ? `Its ${count} task${count > 1 ? 's' : ''} will move to "${target.name}". No tasks are lost.`
    : 'This section is empty, so no tasks are affected.';
  const sure = await confirmDialog({ title: `Delete "${section.name}"?`, message, confirmText: 'Delete section' });
  if (!sure) return;
  await api(`/api/sections/${section.id}`, { method: 'DELETE' });
  toast(`Deleted section "${section.name}"`);
  await loadProjectData();
}

// ---------- Cards ----------

function buildCard(task) {
  const card = document.createElement('li');
  card.className = 'card'
    + (task.completed ? ' done' : '')
    + (task.id === state.openTaskId ? ' selected' : '');
  card.dataset.taskId = task.id;

  const top = document.createElement('div');
  top.className = 'card-top';
  const title = make('span', 'card-title');
  title.append(highlight(task.title));
  top.append(createCheck(task), title);
  card.append(top);

  // Labels under the title: priority, tags, subtask progress, due date
  const meta = make('div', 'card-meta');
  const badge = priorityBadge(task);
  if (badge) meta.append(badge);
  for (const tag of taskTags(task)) meta.append(tagPill(tag));
  const subs = subtaskCount(task);
  if (subs) meta.append(subs);
  if (task.due_date) {
    meta.append(make('span', 'card-due' + (isOverdue(task) ? ' overdue' : ''), formatDue(task.due_date)));
  }
  const talk = commentCount(task);
  if (talk) meta.append(talk);
  const files = attachmentCount(task);
  if (files) meta.append(files);
  meta.append(...extraBadges(task));
  const face = assigneeAvatar(task);
  if (face) {
    face.classList.add('card-assignee');
    meta.append(face);
  }
  if (meta.children.length) card.append(meta);

  card.addEventListener('click', () => { if (!justDragged) openDetail(task.id); });
  card.addEventListener('pointerdown', (e) => onCardPointerDown(e, task, card));
  card.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
  return card;
}

// ---------- Drag and drop ----------
// Pointer events work for both mouse and touch. With a mouse, dragging starts
// after moving a few pixels. On touch, you hold the card briefly first, so a
// normal swipe still scrolls the board.
// The list view uses the same code for its rows: a drop target is any element
// with data-drop-section, holding a .drop-list of items with data-task-id.

function onCardPointerDown(e, task, card) {
  if (e.button !== 0 || e.target.closest('.check') || drag) return;
  drag = {
    task,
    card,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    timer: null,
  };
  if (e.pointerType === 'touch') {
    drag.timer = setTimeout(() => { if (drag && !drag.active) startDrag(drag.startX, drag.startY); }, 250);
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancelDrag);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved < 6) return;
    // Touch moved before the hold finished: it's a scroll, not a drag
    if (e.pointerType === 'touch') return cancelDrag();
    startDrag(e.clientX, e.clientY);
  }
  moveDrag(e.clientX, e.clientY);
}

function startDrag(x, y) {
  const { card } = drag;
  const rect = card.getBoundingClientRect();
  drag.active = true;
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;

  // A copy of the card follows the pointer
  drag.ghost = card.cloneNode(true);
  drag.ghost.classList.add('card-ghost');
  drag.ghost.style.width = `${rect.width}px`;
  document.body.append(drag.ghost);

  // A gap shows where the card will land
  drag.placeholder = document.createElement('li');
  drag.placeholder.className = card.classList.contains('task-row') ? 'row-placeholder' : 'card-placeholder';
  drag.placeholder.style.height = `${rect.height}px`;
  card.after(drag.placeholder);

  card.classList.add('dragging');
  document.body.classList.add('is-dragging');
  moveDrag(x, y);
}

function moveDrag(x, y) {
  const tilt = drag.card.classList.contains('task-row') ? 0.6 : 2;
  drag.ghost.style.transform = `translate(${x - drag.offsetX}px, ${y - drag.offsetY}px) rotate(${tilt}deg)`;

  const target = document.elementFromPoint(x, y)?.closest('[data-drop-section]');
  if (target) {
    const list = target.querySelector('.drop-list');
    const items = [...list.querySelectorAll('[data-task-id]:not(.dragging)')];
    const before = items.find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (before) list.insertBefore(drag.placeholder, before);
    else list.append(drag.placeholder);
  }

  if (state.view === 'board') {
    // Scroll the board sideways when dragging near its edges
    const board = $('board-view');
    const r = board.getBoundingClientRect();
    if (x < r.left + 40) board.scrollLeft -= 15;
    else if (x > r.right - 40) board.scrollLeft += 15;
  } else {
    // Scroll the list up or down when dragging near its top or bottom
    const area = $('list-view');
    const r = area.getBoundingClientRect();
    if (y < r.top + 40) area.scrollTop -= 15;
    else if (y > r.bottom - 40) area.scrollTop += 15;
  }
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    // A plain click: let the click handler open the task
    stopListening();
    drag = null;
    return;
  }

  const { task, placeholder } = drag;
  const sectionId = Number(placeholder.closest('[data-drop-section]').dataset.dropSection);

  // The card it was dropped above (null = dropped at the end of the column)
  let next = placeholder.nextElementSibling;
  while (next && next.classList.contains('dragging')) next = next.nextElementSibling;
  const beforeId = next ? Number(next.dataset.taskId) : null;

  cancelDrag();
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);
  moveTask(task, sectionId, beforeId);
}

function cancelDrag() {
  if (!drag) return;
  stopListening();
  clearTimeout(drag.timer);
  drag.ghost?.remove();
  drag.placeholder?.remove();
  drag.card.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  drag = null;
}

function stopListening() {
  clearTimeout(drag.timer);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', cancelDrag);
}

// Put `task` just before task `beforeId` in the section (or at the end).
// Works on all tasks, not only the visible ones, so hidden (filtered out)
// cards keep their places.
async function moveTask(task, sectionId, beforeId) {
  // Show the new order right away, then save it
  const column = tasksInSection(sectionId).filter((t) => t.id !== task.id);
  let index = beforeId ? column.findIndex((t) => t.id === beforeId) : column.length;
  if (index === -1) index = column.length;
  column.splice(index, 0, task);
  column.forEach((t, i) => { t.position = i; });
  task.section_id = sectionId;
  render();

  try {
    const saved = await api(`/api/tasks/${task.id}/move`, { method: 'POST', body: { section_id: sectionId, index } });
    if (task.project_id !== state.projectId) return;
    const byId = new Map(saved.map((t) => [t.id, t]));
    for (const t of state.tasks) {
      const s = byId.get(t.id);
      if (s) Object.assign(t, s); // rules may have changed more than the place
    }
    render();
  } catch {
    loadProjectData(); // save failed: reload the real order from the server
  }
}

// While a card is being dragged on touch, stop the page from scrolling
document.addEventListener('touchmove', (e) => {
  if (drag && drag.active) e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drag) cancelDrag();
});
