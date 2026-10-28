// Timeline (Gantt) view: one row per task, grouped by section, with a bar from
// the task's start date to its due date. Drag a bar to move it, drag its ends to
// change the dates, and drag across an empty row to give a task its dates.
// Loaded before app.js. Uses state, $, make, render, updateTask, openDetail,
// createCheck, highlight, visibleTasks, filtersActive, tasksInSection,
// columnColor, addTaskToSection, collapsedSections, saveCollapsed, avatar and
// dateKey from the other files (only inside functions, so the load order is safe).

const TL_ZOOMS = {
  day: { dayW: 40, label: 'Days', pad: [14, 45], grow: 30 },
  week: { dayW: 16, label: 'Weeks', pad: [35, 150], grow: 90 },
  month: { dayW: 5, label: 'Months', pad: [90, 400], grow: 240 },
};

let tlZoom = 'day';
try { if (TL_ZOOMS[localStorage.getItem('timeline-zoom')]) tlZoom = localStorage.getItem('timeline-zoom'); } catch {}

let tlRange = null;        // { lo, days, dayW } of the timeline on screen
let tlShownProject = null; // the project the timeline last showed (a new one scrolls to today)
let tlExtraBefore = 0;     // extra days added by scrolling to the edges
let tlExtraAfter = 0;
let tlFocusDate = null;    // keep this date centered on the next redraw (zoom change)
let tlDrag = null;         // the bar being dragged or drawn, or null
let tlBusy = false;        // ignore scroll events caused by a redraw
let tlScale = null;        // header segments of the last drawing (the body's grid lines use them too)

// ---------- Dates ----------

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDay(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Whole days from a to b (Math.round absorbs daylight saving hours)
function dayDiff(a, b) {
  return Math.round((b - a) / 86400000);
}

function shiftDateKey(key, n) {
  return dateKey(shiftDay(keyToDate(key), n));
}

function shortDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function rangeText(startKey, endKey) {
  const a = shortDate(keyToDate(startKey));
  return startKey === endKey ? a : `${a} to ${shortDate(keyToDate(endKey))}`;
}

// A task's bar: start date (or the due date for one-day tasks) to due date
function taskSpan(task) {
  if (!task.due_date) return null;
  return { start: task.start_date || task.due_date, end: task.due_date };
}

function nameWidth() {
  return window.innerWidth < 700 ? 140 : 260;
}

// ---------- Range ----------

// From a little before the earliest bar (or today) to a while after the latest,
// starting on a Monday (or the 1st of a month), and at least one screen wide
function timelineRange(tasks, trackWidth) {
  const zoom = TL_ZOOMS[tlZoom];
  const today = keyToDate(dateKey(new Date()));
  let lo = shiftDay(today, -zoom.pad[0] - tlExtraBefore);
  let hi = shiftDay(today, zoom.pad[1] + tlExtraAfter);
  for (const task of tasks) {
    const span = taskSpan(task);
    if (!span) continue;
    const a = shiftDay(keyToDate(span.start), -7);
    const b = shiftDay(keyToDate(span.end), 21);
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  lo = tlZoom === 'month' ? new Date(lo.getFullYear(), lo.getMonth(), 1) : shiftDay(lo, -((lo.getDay() + 6) % 7));
  hi = new Date(hi.getFullYear(), hi.getMonth() + 1, 0);
  let days = dayDiff(lo, hi) + 1;
  days = Math.max(days, Math.ceil(trackWidth / zoom.dayW) + 7);
  return { lo, days, dayW: zoom.dayW };
}

const dayX = (date) => dayDiff(tlRange.lo, date) * tlRange.dayW;

// ---------- Drawing ----------

function renderTimeline() {
  const view = $('timeline-view');
  const old = view.querySelector('.tl-scroll');
  const nameW = nameWidth();

  // Remember what was on screen, so the redraw doesn't jump
  let leftDays = null;
  let top = 0;
  const newProject = tlShownProject !== state.projectId;
  if (newProject) {
    tlExtraBefore = 0;
    tlExtraAfter = 0;
  } else if (old && tlRange) {
    leftDays = old.scrollLeft / tlRange.dayW;
    top = old.scrollTop;
    if (tlFocusDate === null) tlFocusDate = { date: shiftDay(tlRange.lo, Math.floor(leftDays)), frac: leftDays % 1, edge: true };
  }

  const tasks = visibleTasks();
  const viewWidth = old?.clientWidth || view.clientWidth || window.innerWidth;
  tlRange = timelineRange(tasks, viewWidth - nameW);

  const scroll = make('div', 'tl-scroll');
  const canvas = make('div', `tl-canvas zoom-${tlZoom}`);
  canvas.style.setProperty('--tl-name', `${nameW}px`);
  canvas.style.setProperty('--tl-day', `${tlRange.dayW}px`);
  canvas.style.width = `${nameW + tlRange.days * tlRange.dayW}px`;
  canvas.append(buildTlHead(), buildTlBody(tasks));
  scroll.append(canvas);
  scroll.addEventListener('scroll', () => onTlScroll(scroll));

  tlBusy = true;
  view.replaceChildren(buildTlToolbar(tasks), scroll);
  const trackW = scroll.clientWidth - nameW;
  if (newProject) {
    // First look at this project: today a quarter of the way in
    scroll.scrollLeft = dayX(keyToDate(dateKey(new Date()))) - trackW / 4;
    tlShownProject = state.projectId;
  } else if (tlFocusDate) {
    const x = (dayDiff(tlRange.lo, tlFocusDate.date) + tlFocusDate.frac) * tlRange.dayW;
    scroll.scrollLeft = tlFocusDate.edge ? x : x - trackW / 2;
  }
  scroll.scrollTop = top;
  tlFocusDate = null;
  requestAnimationFrame(() => { tlBusy = false; });
}

// Near either end, add more days (the redraw keeps the same date on screen)
function onTlScroll(scroll) {
  if (tlBusy || tlDrag) return;
  const grow = TL_ZOOMS[tlZoom].grow;
  if (scroll.scrollLeft + scroll.clientWidth > scroll.scrollWidth - 120) tlExtraAfter += grow;
  else if (scroll.scrollLeft < 40 && tlExtraBefore < 3650) tlExtraBefore += grow;
  else return;
  tlBusy = true;
  requestAnimationFrame(renderTimeline);
}

function buildTlToolbar(tasks) {
  const bar = make('div', 'cal-toolbar tl-toolbar');

  const today = make('button', 'btn btn-ghost', 'Today');
  today.type = 'button';
  today.addEventListener('click', () => {
    const scroll = $('timeline-view').querySelector('.tl-scroll');
    const x = dayX(keyToDate(dateKey(new Date())));
    scroll.scrollTo({ left: x - (scroll.clientWidth - nameWidth()) / 4, behavior: 'smooth' });
  });

  const zooms = make('div', 'tl-zoom');
  zooms.setAttribute('role', 'group');
  zooms.setAttribute('aria-label', 'Zoom');
  for (const [key, zoom] of Object.entries(TL_ZOOMS)) {
    const btn = make('button', 'tl-zoom-btn' + (key === tlZoom ? ' active' : ''), zoom.label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(key === tlZoom));
    btn.addEventListener('click', () => setTimelineZoom(key));
    zooms.append(btn);
  }

  const undated = tasks.filter((t) => !t.due_date && !t.completed).length;
  const note = make('span', 'cal-unscheduled',
    undated ? `${undated} task${undated > 1 ? 's' : ''} without dates: drag across a row to schedule` : 'Drag a bar to move it, or its ends to change the dates');

  bar.append(today, zooms, note);
  return bar;
}

function setTimelineZoom(zoom) {
  if (zoom === tlZoom) return;
  // Keep the date in the middle of the screen in the middle
  const scroll = $('timeline-view').querySelector('.tl-scroll');
  if (scroll && tlRange) {
    const middle = (scroll.scrollLeft + (scroll.clientWidth - nameWidth()) / 2) / tlRange.dayW;
    tlFocusDate = { date: shiftDay(tlRange.lo, Math.floor(middle)), frac: middle % 1, edge: false };
  }
  tlZoom = zoom;
  tlExtraBefore = 0;
  tlExtraAfter = 0;
  try { localStorage.setItem('timeline-zoom', zoom); } catch {}
  renderTimeline();
}

// Days the range covers, grouped into segments (months, weeks, days or years)
function tlSegments(keyOf) {
  const segments = [];
  for (let i = 0; i < tlRange.days; i++) {
    const date = shiftDay(tlRange.lo, i);
    const key = keyOf(date);
    const last = segments[segments.length - 1];
    if (last && last.key === key) last.count++;
    else segments.push({ key, date, start: i, count: 1 });
  }
  return segments;
}

const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
const weekKey = (d) => dateKey(shiftDay(d, -((d.getDay() + 6) % 7)));

// The two header rows, and the segments that get a grid line
function buildTlScale() {
  const todayKey = dateKey(new Date());
  if (tlZoom === 'month') {
    return {
      top: tlSegments((d) => d.getFullYear()).map((s) => ({ ...s, label: String(s.date.getFullYear()) })),
      bottom: tlSegments(monthKey).map((s) => ({ ...s, label: s.date.toLocaleDateString(undefined, { month: 'short' }) })),
    };
  }
  const months = tlSegments(monthKey).map((s) => ({
    ...s, label: s.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  }));
  if (tlZoom === 'week') {
    return {
      top: months,
      bottom: tlSegments(weekKey).map((s) => ({ ...s, label: shortDate(keyToDate(s.key)) })),
    };
  }
  return {
    top: months,
    bottom: tlSegments(dateKey).map((s) => ({
      ...s,
      label: String(s.date.getDate()),
      weekday: s.date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      today: s.key === todayKey,
      weekend: s.date.getDay() === 0 || s.date.getDay() === 6,
    })),
  };
}

function buildTlHead() {
  const scale = buildTlScale();
  tlScale = scale;
  const head = make('div', 'tl-head');
  const corner = make('div', 'tl-corner', 'Task name');

  const rows = make('div', 'tl-scale');
  for (const [name, segments] of [['top', scale.top], ['bottom', scale.bottom]]) {
    const row = make('div', `tl-scale-row ${name}`);
    for (const s of segments) {
      const seg = make('div', 'tl-seg' + (s.today ? ' today' : '') + (s.weekend ? ' weekend' : ''));
      seg.style.width = `${s.count * tlRange.dayW}px`;
      if (s.weekday) seg.append(make('span', 'tl-weekday', s.weekday));
      seg.append(make('span', 'tl-seg-label', s.label));
      row.append(seg);
    }
    rows.append(row);
  }
  head.append(corner, rows);
  return head;
}

function buildTlBody(tasks) {
  const body = make('div', 'tl-body');

  // Background: grid lines, weekends and today, behind every row
  const bg = make('div', 'tl-bg');
  for (const s of tlScale.bottom) {
    const line = make('div', 'tl-line');
    line.style.left = `${s.start * tlRange.dayW}px`;
    bg.append(line);
  }
  if (tlZoom !== 'month') {
    for (let i = 0; i < tlRange.days; i++) {
      if (shiftDay(tlRange.lo, i).getDay() !== 6) continue;
      const weekend = make('div', 'tl-weekend');
      weekend.style.left = `${i * tlRange.dayW}px`;
      weekend.style.width = `${2 * tlRange.dayW}px`;
      bg.append(weekend);
    }
  }
  const todayLine = make('div', 'tl-today');
  todayLine.style.left = `${dayX(keyToDate(dateKey(new Date()))) + tlRange.dayW / 2}px`;
  bg.append(todayLine);
  body.append(bg);

  const filtering = filtersActive();
  for (const section of state.sections) {
    const inSection = tasksInSection(section.id, tasks);
    if (filtering && !inSection.length) continue;
    body.append(buildTlGroup(section, inSection));
  }
  if (filtering && !tasks.length) body.append(make('p', 'empty tl-empty', 'No tasks match your search and filters.'));
  return body;
}

function buildTlGroup(section, tasks) {
  const collapsed = collapsedSections.has(section.id);
  const color = columnColor(section);
  const group = make('div', 'tl-group' + (collapsed ? ' collapsed' : ''));

  const head = make('div', 'tl-row tl-section-row');
  const name = make('div', 'tl-name tl-section-name');
  const toggle = make('button', 'icon-btn section-toggle');
  toggle.type = 'button';
  toggle.title = collapsed ? 'Expand section' : 'Collapse section';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  toggle.addEventListener('click', () => {
    if (collapsed) collapsedSections.delete(section.id);
    else collapsedSections.add(section.id);
    saveCollapsed();
    renderTimeline();
  });
  const dot = make('span', 'column-dot');
  dot.style.setProperty('--c', color);
  name.append(toggle, dot, make('span', 'tl-section-title', section.name),
    make('span', 'column-count', tasks.filter((t) => !t.completed).length || ''));
  head.append(name, make('div', 'tl-track'));
  group.append(head);
  if (collapsed) return group;

  for (const task of tasks) group.append(buildTlRow(task, color));

  // "Add task" row: the new task lands in this section, without dates yet
  const addRow = make('div', 'tl-row tl-add-row');
  const addName = make('div', 'tl-name');
  const form = make('form', 'tl-add');
  const input = make('input');
  input.placeholder = 'Add task...';
  input.maxLength = 200;
  input.dataset.section = section.id;
  input.setAttribute('aria-label', `Add a task to ${section.name}`);
  form.append(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addTaskToSection(section.id, input);
    $('timeline-view').querySelector(`.tl-add input[data-section="${section.id}"]`)?.focus();
  });
  addName.append(form);
  addRow.append(addName, make('div', 'tl-track'));
  group.append(addRow);
  return group;
}

function buildTlRow(task, color) {
  const row = make('div', 'tl-row tl-task-row'
    + (task.completed ? ' done' : '')
    + (task.id === state.openTaskId ? ' selected' : ''));
  row.dataset.taskId = task.id;

  const name = make('div', 'tl-name');
  const title = make('span', 'tl-title');
  title.append(highlight(task.title));
  name.append(createCheck(task), title);
  name.addEventListener('click', () => openDetail(task.id));

  const track = make('div', 'tl-track' + (task.due_date ? '' : ' undated'));
  track.style.setProperty('--c', color);
  const span = taskSpan(task);
  if (span) track.append(buildTlBar(task, keyToDate(span.start), keyToDate(span.end)));
  track.addEventListener('pointerdown', (e) => onTlPointerDown(e, task, track));
  if (!task.due_date) {
    // A faint one-day bar follows the mouse on rows without dates
    track.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || tlDrag) return;
      let ghost = track.querySelector('.tl-ghost');
      if (!ghost) {
        ghost = make('div', 'tl-ghost', '+');
        track.append(ghost);
      }
      ghost.style.left = `${tlDayAt(track, e.clientX) * tlRange.dayW}px`;
      ghost.style.width = `${tlRange.dayW}px`;
    });
    track.addEventListener('pointerleave', () => track.querySelector('.tl-ghost')?.remove());
  }
  row.append(name, track);
  return row;
}

function buildTlBar(task, start, end) {
  const overdue = isOverdue(task);
  const bar = make('div', 'tl-bar' + (overdue ? ' overdue' : '') + (task.completed ? ' done' : ''));
  placeTlBar(bar, dayDiff(tlRange.lo, start), dayDiff(tlRange.lo, end));
  bar.title = `${task.title}\n${rangeText(dateKey(start), dateKey(end))}`;
  if (task.assignee_id) bar.append(avatar({ id: task.assignee_id, name: task.assignee_name }));
  bar.append(make('span', 'tl-bar-label', task.title), make('span', 'tl-handle start'), make('span', 'tl-handle end'));
  return bar;
}

// Put a bar from day index a to day index b (inclusive)
function placeTlBar(bar, a, b) {
  const width = (b - a + 1) * tlRange.dayW;
  bar.style.left = `${a * tlRange.dayW + 2}px`;
  bar.style.width = `${Math.max(width - 4, 6)}px`;
  // Short bars show their name next to them instead of inside
  bar.classList.toggle('narrow', width < 90);
}

function tlDayAt(track, clientX) {
  return Math.floor((clientX - track.getBoundingClientRect().left) / tlRange.dayW);
}

// ---------- Drag: move, resize, draw ----------
// Pointer events work for mouse and touch. On touch you hold for a moment
// first, so a normal swipe still scrolls the timeline.

function onTlPointerDown(e, task, track) {
  if (e.button !== 0 || tlDrag) return;
  const bar = e.target.closest('.tl-bar');
  let mode = null;
  if (bar) {
    if (e.target.closest('.tl-handle.start')) mode = 'start';
    else if (e.target.closest('.tl-handle.end')) mode = 'end';
    else mode = 'move';
  } else if (!task.due_date) {
    mode = 'draw';
  }
  if (!mode) return;

  const span = taskSpan(task);
  const day = tlDayAt(track, e.clientX);
  const scroll = track.closest('.tl-scroll');
  tlDrag = {
    task, mode, track, bar, scroll,
    pointerId: e.pointerId,
    touch: e.pointerType === 'touch',
    startX: e.clientX,
    startY: e.clientY,
    startScroll: scroll.scrollLeft,
    from: span ? dayDiff(tlRange.lo, keyToDate(span.start)) : day,
    to: span ? dayDiff(tlRange.lo, keyToDate(span.end)) : day,
    anchor: day,
    active: false,
    timer: null,
  };
  tlDrag.a = tlDrag.from;
  tlDrag.b = tlDrag.to;
  if (tlDrag.touch) tlDrag.timer = setTimeout(() => { if (tlDrag && !tlDrag.active) startTlDrag(); }, 300);
  if (e.pointerType === 'mouse') e.preventDefault(); // no text selection while dragging
  window.addEventListener('pointermove', onTlPointerMove);
  window.addEventListener('pointerup', onTlPointerUp);
  window.addEventListener('pointercancel', cancelTlDrag);
}

function startTlDrag() {
  const d = tlDrag;
  d.active = true;
  d.track.querySelector('.tl-ghost')?.remove();
  if (!d.bar) {
    d.bar = make('div', 'tl-bar drawing');
    d.bar.append(make('span', 'tl-bar-label', d.task.title));
    d.track.append(d.bar);
    placeTlBar(d.bar, d.a, d.b);
  }
  d.bar.classList.add('dragging');
  d.track.parentElement.classList.add('dragging-row'); // its date tip shows above the row before it
  d.tip = make('div', 'tl-tip');
  d.track.append(d.tip);
  document.body.classList.add('is-dragging', `tl-${d.mode === 'move' ? 'moving' : 'resizing'}`);
  updateTlDrag(d.startX);
}

function onTlPointerMove(e) {
  const d = tlDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.active) {
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (moved < 4) return;
    if (d.touch) return cancelTlDrag(); // moved before the hold finished: it's a scroll
    startTlDrag();
  }

  // Scroll sideways when dragging near the edges
  const r = d.scroll.getBoundingClientRect();
  if (e.clientX < r.left + nameWidth() + 30) d.scroll.scrollLeft -= 12;
  else if (e.clientX > r.right - 30) d.scroll.scrollLeft += 12;
  updateTlDrag(e.clientX);
}

function updateTlDrag(clientX) {
  const d = tlDrag;
  const delta = Math.round((clientX - d.startX + d.scroll.scrollLeft - d.startScroll) / tlRange.dayW);
  if (d.mode === 'move') {
    d.a = d.from + delta;
    d.b = d.to + delta;
  } else if (d.mode === 'start') {
    d.a = Math.min(d.from + delta, d.to);
    d.b = d.to;
  } else if (d.mode === 'end') {
    d.a = d.from;
    d.b = Math.max(d.to + delta, d.from);
  } else {
    const day = tlDayAt(d.track, clientX);
    d.a = Math.min(d.anchor, day);
    d.b = Math.max(d.anchor, day);
  }
  placeTlBar(d.bar, d.a, d.b);
  d.tip.textContent = rangeText(dateKey(shiftDay(tlRange.lo, d.a)), dateKey(shiftDay(tlRange.lo, d.b)));
  d.tip.style.left = `${d.a * tlRange.dayW}px`;
}

function onTlPointerUp(e) {
  const d = tlDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  stopTlListening();
  tlDrag = null;
  document.body.classList.remove('is-dragging', 'tl-moving', 'tl-resizing');

  if (!d.active) {
    // A plain click: on a bar it opens the task, on an empty row (mouse) it schedules that one day
    if (d.mode === 'draw' && !d.touch) return saveTlDates(d.task, d.anchor, d.anchor);
    if (d.mode !== 'draw') openDetail(d.task.id);
    return;
  }
  if (d.a === d.from && d.b === d.to && d.mode !== 'draw') return renderTimeline();
  saveTlDates(d.task, d.a, d.b);
}

// Save day indexes a..b as the task's dates (a one-day task keeps no start date)
function saveTlDates(task, a, b) {
  const startKey = dateKey(shiftDay(tlRange.lo, a));
  const dueKey = dateKey(shiftDay(tlRange.lo, b));
  const changes = { start_date: a === b ? null : startKey, due_date: dueKey };
  const old = { start_date: task.start_date, due_date: task.due_date };
  Object.assign(task, changes); // show it right away, then save
  render();
  updateTask(task, changes).catch(() => {
    Object.assign(task, old);
    render();
  });
}

function cancelTlDrag() {
  if (!tlDrag) return;
  const wasActive = tlDrag.active;
  stopTlListening();
  tlDrag = null;
  document.body.classList.remove('is-dragging', 'tl-moving', 'tl-resizing');
  if (wasActive) renderTimeline(); // put the bar back
}

function stopTlListening() {
  clearTimeout(tlDrag.timer);
  window.removeEventListener('pointermove', onTlPointerMove);
  window.removeEventListener('pointerup', onTlPointerUp);
  window.removeEventListener('pointercancel', cancelTlDrag);
}

// While a bar is being dragged on touch, stop the page from scrolling
document.addEventListener('touchmove', (e) => {
  if (tlDrag && tlDrag.active) e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tlDrag) {
    e.stopPropagation();
    cancelTlDrag();
  }
}, true);
