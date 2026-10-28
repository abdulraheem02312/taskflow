// Calendar view: a month grid with each task on its due date.
// Loaded before app.js. Uses state, $, api, render and the task helpers from app.js
// (only inside functions, so the load order is safe).

let calMonth = null;      // first day of the month on screen
let calSelected = null;   // 'YYYY-MM-DD' of the selected day (phone layout shows its tasks)
let calAdding = null;     // 'YYYY-MM-DD' of the day whose quick-add box is open
let calDrag = null;       // the task chip being dragged, or null
let calJustDragged = false;

function renderCalendar() {
  const view = $('calendar-view');
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!calSelected) calSelected = dateKey(now);

  // Keep half-typed quick-add text (and focus) through the redraw
  const drafts = {};
  let focused = null;
  for (const input of view.querySelectorAll('input[data-keep]')) {
    drafts[input.dataset.keep] = input.value;
    if (input === document.activeElement) focused = input.dataset.keep;
  }

  view.innerHTML = '';
  view.append(buildCalToolbar(), buildCalWeekdays(), buildCalGrid(), buildCalAgenda());

  for (const input of view.querySelectorAll('input[data-keep]')) {
    if (drafts[input.dataset.keep]) input.value = drafts[input.dataset.keep];
    if (focused === input.dataset.keep) input.focus();
  }
}

function showMonth(year, month) {
  calMonth = new Date(year, month, 1);
  calAdding = null;
  renderCalendar();
}

// Tasks grouped by due date: unfinished first, then oldest first
function tasksByDate() {
  const map = new Map();
  for (const task of visibleTasks()) {
    if (!task.due_date) continue;
    if (!map.has(task.due_date)) map.set(task.due_date, []);
    map.get(task.due_date).push(task);
  }
  for (const list of map.values()) list.sort((a, b) => a.completed - b.completed || a.id - b.id);
  return map;
}

// ---------- Toolbar and grid ----------

function buildCalToolbar() {
  const bar = make('div', 'cal-toolbar');
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();

  const today = make('button', 'btn btn-ghost', 'Today');
  today.addEventListener('click', () => {
    const now = new Date();
    calSelected = dateKey(now);
    showMonth(now.getFullYear(), now.getMonth());
  });

  const prev = make('button', 'icon-btn cal-nav', '‹');
  prev.title = 'Previous month';
  prev.addEventListener('click', () => showMonth(year, month - 1));

  const next = make('button', 'icon-btn cal-nav', '›');
  next.title = 'Next month';
  next.addEventListener('click', () => showMonth(year, month + 1));

  const label = make('h2', '', calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  const unscheduled = visibleTasks().filter((t) => !t.due_date && !t.completed).length;
  const note = make('span', 'cal-unscheduled',
    unscheduled ? `${unscheduled} task${unscheduled > 1 ? 's' : ''} with no due date` : '');

  bar.append(today, prev, next, label, note);
  return bar;
}

function buildCalWeekdays() {
  const row = make('div', 'cal-weekdays');
  // Jan 1 2023 was a Sunday, so this gives Sun..Sat in the user's language
  for (let i = 0; i < 7; i++) {
    row.append(make('div', '', new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' })));
  }
  return row;
}

function buildCalGrid() {
  const grid = make('div', 'cal-grid');
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const offset = calMonth.getDay(); // empty slots before the 1st
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  grid.style.setProperty('--weeks', weeks);

  const today = dateKey(new Date());
  const byDate = tasksByDate();
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(year, month, 1 - offset + i);
    grid.append(buildCalDay(date, month, today, byDate.get(dateKey(date)) || []));
  }
  return grid;
}

function buildCalDay(date, month, today, tasks) {
  const key = dateKey(date);
  const day = make('div', 'cal-day');
  day.dataset.date = key;
  if (date.getMonth() !== month) day.classList.add('other-month');
  if (key === today) day.classList.add('today');
  if (key === calSelected) day.classList.add('selected');

  const head = make('div', 'cal-day-head');
  const label = date.getDate() === 1
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : String(date.getDate());
  const add = make('button', 'icon-btn cal-add-btn', '+');
  add.title = 'Add a task on this day';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    calAdding = key;
    renderCalendar();
    $('calendar-view').querySelector(`.cal-day[data-date="${key}"] .cal-add input`)?.focus();
  });
  head.append(make('span', 'cal-date', label), add);

  const list = make('ul', 'cal-tasks');
  for (const task of tasks) list.append(buildCalChip(task));

  // Phone layout: small dots instead of task names
  const dots = make('div', 'cal-dots');
  for (const task of tasks.slice(0, 3)) dots.append(make('span', task.completed ? 'dot done' : 'dot'));

  day.append(head, list, dots);
  if (calAdding === key) {
    day.append(buildCalAddForm(key, `day-${key}`, 'Task name', () => {
      calAdding = null;
      renderCalendar();
    }));
  }

  day.addEventListener('click', () => {
    calSelected = key;
    renderCalendar();
  });
  return day;
}

function buildCalChip(task) {
  const chip = make('li', 'cal-chip'
    + (task.completed ? ' done' : '')
    + (isOverdue(task) ? ' overdue' : '')
    + (task.id === state.openTaskId ? ' selected' : ''));
  const color = currentProject()?.color || '#ffffff';
  chip.style.background = `${color}26`; // project color at 15% opacity
  chip.style.borderLeftColor = color;
  chip.title = task.title;

  const check = createCheck(task);
  check.classList.add('small');
  const title = make('span', 'cal-chip-title');
  title.append(highlight(task.title));
  chip.append(check, title);
  makeCalDraggable(chip, task);
  return chip;
}

// ---------- Quick add ----------

function buildCalAddForm(dueDate, keepKey, placeholder, onClose) {
  const form = make('form', 'cal-add');
  const input = make('input');
  input.placeholder = placeholder;
  input.maxLength = 200;
  input.dataset.keep = keepKey;
  form.append(input);

  form.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && onClose) onClose();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      if (onClose) onClose();
      return;
    }
    const projectId = state.projectId;
    input.value = ''; // clear right away so the next task can be typed
    let task;
    try {
      task = await api(`/api/projects/${projectId}/tasks`, { method: 'POST', body: { title, due_date: dueDate } });
    } catch {
      if (!input.value) input.value = title;
      return;
    }
    if (projectId !== state.projectId) return refreshCounts();
    state.tasks.push(task);
    render();
    refreshCounts();
  });
  return form;
}

// ---------- Phone layout: task list for the selected day ----------

function buildCalAgenda() {
  const wrap = make('div', 'cal-agenda');
  const [y, m, d] = calSelected.split('-').map(Number);
  const heading = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  wrap.append(make('h3', '', heading));

  const list = make('ul', 'cal-agenda-list');
  const tasks = tasksByDate().get(calSelected) || [];
  for (const task of tasks) {
    const row = make('li', 'cal-agenda-row' + (task.completed ? ' done' : ''));
    row.append(createCheck(task), make('span', 'cal-agenda-title', task.title));
    makeCalDraggable(row, task);
    list.append(row);
  }
  if (tasks.length === 0) list.append(make('li', 'empty-day', 'No tasks on this day'));

  wrap.append(list, buildCalAddForm(calSelected, `agenda-${calSelected}`, '+ Add task'));
  return wrap;
}

// ---------- Drag a task to another day ----------
// Same idea as the board: mouse drags after a small move,
// touch needs a short hold so normal swipes still scroll.

function makeCalDraggable(el, task) {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!calJustDragged) openDetail(task.id);
  });
  el.addEventListener('pointerdown', (e) => calPointerDown(e, task, el));
  el.addEventListener('contextmenu', (e) => { if (calDrag) e.preventDefault(); });
}

function calPointerDown(e, task, el) {
  if (e.button !== 0 || e.target.closest('.check') || calDrag) return;
  calDrag = {
    task,
    el,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    target: null,
    timer: null,
  };
  if (e.pointerType === 'touch') {
    calDrag.timer = setTimeout(() => { if (calDrag && !calDrag.active) calStartDrag(); }, 250);
  }
  window.addEventListener('pointermove', calPointerMove);
  window.addEventListener('pointerup', calPointerUp);
  window.addEventListener('pointercancel', calCancelDrag);
}

function calPointerMove(e) {
  if (!calDrag || e.pointerId !== calDrag.pointerId) return;
  if (!calDrag.active) {
    if (Math.hypot(e.clientX - calDrag.startX, e.clientY - calDrag.startY) < 6) return;
    if (e.pointerType === 'touch') return calCancelDrag();
    calStartDrag();
  }
  calMoveDrag(e.clientX, e.clientY);
}

function calStartDrag() {
  const { el } = calDrag;
  const rect = el.getBoundingClientRect();
  calDrag.active = true;
  calDrag.offsetX = calDrag.startX - rect.left;
  calDrag.offsetY = calDrag.startY - rect.top;

  calDrag.ghost = el.cloneNode(true);
  calDrag.ghost.classList.add('cal-ghost');
  calDrag.ghost.style.width = `${Math.min(rect.width, 220)}px`;
  document.body.append(calDrag.ghost);

  el.classList.add('dragging');
  document.body.classList.add('is-dragging');
  calMoveDrag(calDrag.startX, calDrag.startY);
}

function calMoveDrag(x, y) {
  calDrag.ghost.style.transform = `translate(${x - calDrag.offsetX}px, ${y - calDrag.offsetY}px) rotate(2deg)`;
  const day = document.elementFromPoint(x, y)?.closest('.cal-day') || null;
  if (day !== calDrag.target) {
    calDrag.target?.classList.remove('drop-target');
    day?.classList.add('drop-target');
    calDrag.target = day;
  }
}

function calPointerUp(e) {
  if (!calDrag || e.pointerId !== calDrag.pointerId) return;
  const { active, task, target } = calDrag;
  calCancelDrag();
  if (!active) return; // a plain click: the click handler opens the task

  calJustDragged = true;
  setTimeout(() => { calJustDragged = false; }, 0);

  const date = target?.dataset.date;
  if (!date || date === task.due_date) return;

  // Show the new date right away, then save it.
  // A task that runs over several days (Timeline) moves as a whole.
  const oldDate = task.due_date;
  const oldStart = task.start_date;
  const changes = { due_date: date };
  if (oldStart && oldDate) changes.start_date = shiftDateKey(oldStart, dayDiff(keyToDate(oldDate), keyToDate(date)));
  task.due_date = date;
  if (changes.start_date) task.start_date = changes.start_date;
  calSelected = date;
  render();
  updateTask(task, changes).catch(() => {
    task.due_date = oldDate;
    task.start_date = oldStart;
    render();
  });
}

function calCancelDrag() {
  if (!calDrag) return;
  clearTimeout(calDrag.timer);
  window.removeEventListener('pointermove', calPointerMove);
  window.removeEventListener('pointerup', calPointerUp);
  window.removeEventListener('pointercancel', calCancelDrag);
  calDrag.ghost?.remove();
  calDrag.target?.classList.remove('drop-target');
  calDrag.el.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  calDrag = null;
}

// While a task is being dragged on touch, stop the page from scrolling
document.addEventListener('touchmove', (e) => {
  if (calDrag && calDrag.active) e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && calDrag) calCancelDrag();
});
