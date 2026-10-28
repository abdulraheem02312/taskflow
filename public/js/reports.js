// Dashboard tab (one project) and the Reporting page (every project you are in):
// numbers and charts made from the tasks already loaded. Nothing new is stored.
// Loaded before app.js. Uses state, $, make, dateKey, parseServerDate, columnColor,
// showPage, loadAllTasks, keyToDate, shiftDay, dayDiff, shortDate and the chart
// kit from charts.js (only inside functions, so the load order is safe).

// Status colors are reserved for meaning (done is good, overdue is bad) and always
// come with an icon and a label
const STATUS = {
  done: { label: 'Completed', color: 'var(--viz-good)', icon: '✓' },
  open: { label: 'Open, on time', color: 'var(--viz-series)', icon: '○' },
  late: { label: 'Overdue', color: 'var(--viz-critical)', icon: '!' },
};

const PRIORITY_ROWS = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], [null, 'No priority']];

// A server timestamp as a local 'YYYY-MM-DD'
function localDay(value) {
  return value ? dateKey(parseServerDate(value)) : null;
}

// When a task was completed (tasks finished before Taskflow recorded it count from their creation)
function doneDay(task) {
  return localDay(task.completed_at) || localDay(task.created_at);
}

function statTiles(stats) {
  const box = make('div', 'stats');
  for (const s of stats) {
    const tile = make('div', `stat ${s.kind}` + (s.value ? '' : ' zero'));
    tile.append(make('span', 'stat-value', s.value.toLocaleString()), make('span', 'stat-label', s.label));
    box.append(tile);
  }
  return box;
}

function statusSegments(tasks) {
  const today = dateKey(new Date());
  const done = tasks.filter((t) => t.completed).length;
  const late = tasks.filter((t) => !t.completed && t.due_date && t.due_date < today).length;
  return [
    { ...STATUS.done, value: done },
    { ...STATUS.open, value: tasks.length - done - late },
    { ...STATUS.late, value: late },
  ];
}

// Open work per person, people first (most work first), "Unassigned" last
function assigneeRows(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const key = t.assignee_id || 0;
    if (!map.has(key)) {
      map.set(key, {
        label: t.assignee_id ? t.assignee_name : 'Unassigned',
        value: 0,
        person: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null,
      });
    }
    map.get(key).value++;
  }
  return [...map.values()].sort((a, b) => Number(!a.person) - Number(!b.person) || b.value - a.value);
}

function priorityRows(tasks) {
  return PRIORITY_ROWS.map(([key, label]) => ({ label, value: tasks.filter((t) => (t.priority || null) === key).length }));
}

const tableOf = (columns, rows) => ({ columns, rows: rows.map((r) => [r.label, r.value]) });

// Keep the scroll position through a redraw
function redrawKeepingScroll(box, children) {
  const top = box.scrollTop;
  box.replaceChildren(...children);
  box.scrollTop = top;
}

// ---------- Dashboard tab ----------

// Burn-up: all tasks and completed tasks per day, over the last 14 to 30 days
function burnup(tasks) {
  const today = keyToDate(dateKey(new Date()));
  const firstKey = tasks.map((t) => localDay(t.created_at)).filter(Boolean).sort()[0];
  const first = firstKey ? keyToDate(firstKey) : today;
  const span = Math.min(30, Math.max(14, dayDiff(first, today) + 1));
  const days = Array.from({ length: span }, (_, i) => shiftDay(today, i - span + 1));
  const keys = days.map(dateKey);
  return {
    labels: days.map(shortDate),
    titles: days.map((d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })),
    total: keys.map((k) => tasks.filter((t) => localDay(t.created_at) <= k).length),
    done: keys.map((k) => tasks.filter((t) => t.completed && doneDay(t) <= k).length),
  };
}

function renderDashboard() {
  hideVizTip();
  const view = $('dashboard-view');
  const tasks = state.tasks;
  if (!tasks.length) {
    const empty = make('div', 'page-empty');
    empty.append(make('div', 'page-empty-icon', '▤'), make('h2', '', 'No tasks to report on yet'),
      make('p', '', 'Add tasks to this project, and its numbers and charts show up here.'));
    view.replaceChildren(empty);
    return;
  }

  const today = dateKey(new Date());
  const open = tasks.filter((t) => !t.completed);
  const kpis = statTiles([
    { label: 'Completed tasks', value: tasks.length - open.length, kind: 'done' },
    { label: 'Incomplete tasks', value: open.length, kind: 'open' },
    { label: 'Overdue tasks', value: open.filter((t) => t.due_date && t.due_date < today).length, kind: 'alert' },
    { label: 'Total tasks', value: tasks.length, kind: 'total' },
  ]);

  const grid = make('div', 'viz-cards');
  const b = burnup(tasks);
  grid.append(chartCard('Task completion over time', `Last ${b.labels.length} days: every task in the project, and how many are done`,
    lineChart(b.labels, [{ name: 'Total', values: b.total }, { name: 'Completed', values: b.done, emphasis: true }], { titles: b.titles }),
    { columns: ['Day', 'Total', 'Completed'], rows: b.titles.map((t, i) => [t, b.total[i], b.done[i]]) }, { wide: true }));

  const segments = statusSegments(tasks);
  grid.append(chartCard('Tasks by status', `All ${plural(tasks.length, 'task')} in this project`, stackedBar(segments),
    tableOf(['Status', 'Tasks'], segments)));

  const sections = state.sections.map((s) => ({ label: s.name, value: open.filter((t) => t.section_id === s.id).length, dot: columnColor(s) }));
  grid.append(chartCard('Incomplete tasks by section', 'Where the open work sits',
    barList(sections, { empty: 'No open tasks. Everything is done.' }), tableOf(['Section', 'Incomplete tasks'], sections)));

  const people = assigneeRows(open);
  grid.append(chartCard('Incomplete tasks by assignee', 'Who has open work',
    barList(people, { empty: 'No open tasks. Everything is done.' }), tableOf(['Assignee', 'Incomplete tasks'], people)));

  const priorities = priorityRows(open);
  grid.append(chartCard('Incomplete tasks by priority', 'How urgent the open work is',
    barList(priorities, { empty: 'No open tasks. Everything is done.' }), tableOf(['Priority', 'Incomplete tasks'], priorities)));

  redrawKeepingScroll(view, [kpis, grid]);
}

// ---------- Reporting page (every project) ----------

const REPORT_RANGES = [[4, 'Last 4 weeks'], [12, 'Last 12 weeks'], [26, 'Last 6 months']];
let reportWeeks = 12;

async function showReportingPage() {
  showPage('reporting');
  state.projectId = null;
  document.title = 'Reporting | Taskflow';
  await loadAllTasks();
}

function renderReporting() {
  hideVizTip();
  for (const btn of document.querySelectorAll('#report-range .seg-btn')) {
    const on = Number(btn.dataset.weeks) === reportWeeks;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const body = $('reporting-body');
  const tasks = state.tasks;
  $('reporting-sub').textContent = `Across ${plural(state.projects.length, 'project')} you are in`;
  if (!tasks.length) {
    const empty = make('div', 'page-empty');
    empty.append(make('div', 'page-empty-icon', '▤'), make('h2', '', 'Nothing to report yet'),
      make('p', '', 'Once your projects have tasks, you will see how the work is going here.'));
    body.replaceChildren(empty);
    return;
  }

  const today = keyToDate(dateKey(new Date()));
  const todayKey = dateKey(today);
  const monday = shiftDay(today, -((today.getDay() + 6) % 7));
  const weeks = Array.from({ length: reportWeeks }, (_, i) => shiftDay(monday, (i - reportWeeks + 1) * 7));
  const rangeStart = dateKey(weeks[0]);
  const range = REPORT_RANGES.find(([w]) => w === reportWeeks)[1].toLowerCase();
  const doneInRange = tasks.filter((t) => t.completed && doneDay(t) >= rangeStart);
  const open = tasks.filter((t) => !t.completed);
  const overdue = open.filter((t) => t.due_date && t.due_date < todayKey);

  const kpis = statTiles([
    { label: `Completed, ${range}`, value: doneInRange.length, kind: 'done' },
    { label: 'Incomplete tasks', value: open.length, kind: 'open' },
    { label: 'Overdue tasks', value: overdue.length, kind: 'alert' },
    { label: 'Projects with open work', value: state.projects.filter((p) => p.open_tasks).length, kind: 'total' },
  ]);

  const grid = make('div', 'viz-cards');
  const perWeek = weeks.map((start) => {
    const a = dateKey(start);
    const b = dateKey(shiftDay(start, 7));
    return {
      label: shortDate(start),
      title: `Week of ${shortDate(start)}`,
      value: doneInRange.filter((t) => doneDay(t) >= a && doneDay(t) < b).length,
    };
  });
  grid.append(chartCard('Completed tasks per week', `Every project, ${range}`, columnChart(perWeek),
    { columns: ['Week', 'Completed'], rows: perWeek.map((p) => [p.title, p.value]) }, { wide: true }));

  const segments = statusSegments(tasks);
  grid.append(chartCard('Tasks by status', `All ${plural(tasks.length, 'task')} in your projects`, stackedBar(segments),
    tableOf(['Status', 'Tasks'], segments)));

  const byProject = state.projects
    .map((p) => ({ label: p.name, value: open.filter((t) => t.project_id === p.id).length, dot: p.color }))
    .sort((a, b) => b.value - a.value);
  grid.append(chartCard('Incomplete tasks by project', 'Where the open work is',
    barList(byProject, { empty: 'No open tasks anywhere. Everything is done.' }), tableOf(['Project', 'Incomplete tasks'], byProject)));

  const late = assigneeRows(overdue);
  grid.append(chartCard('Overdue tasks by assignee', 'Who might need a hand',
    barList(late, { empty: 'Nothing is overdue. Nice work.' }), tableOf(['Assignee', 'Overdue tasks'], late)));

  const priorities = priorityRows(open);
  grid.append(chartCard('Incomplete tasks by priority', 'How urgent the open work is',
    barList(priorities, { empty: 'No open tasks anywhere.' }), tableOf(['Priority', 'Incomplete tasks'], priorities)));

  // Project health: a table is the right form for several numbers per project
  const health = state.projects.map((p) => {
    const mine = tasks.filter((t) => t.project_id === p.id);
    const done = mine.filter((t) => t.completed).length;
    return [p.name, mine.length - done, mine.filter((t) => !t.completed && t.due_date && t.due_date < todayKey).length,
      doneInRange.filter((t) => t.project_id === p.id).length, mine.length ? `${Math.round((done / mine.length) * 100)}%` : 'n/a'];
  });
  grid.append(chartCard('Project health', `Done counts are for the ${range}`,
    buildVizTable({ columns: ['Project', 'Open', 'Overdue', 'Done', 'Complete'], rows: health }), null, { wide: true }));

  // The page body scrolls; keep its position through the redraw
  const scroller = body.closest('.page-body');
  const top = scroller.scrollTop;
  body.replaceChildren(kpis, grid);
  scroller.scrollTop = top;
}

for (const btn of document.querySelectorAll('#report-range .seg-btn')) {
  btn.addEventListener('click', () => {
    reportWeeks = Number(btn.dataset.weeks);
    renderReporting();
  });
}
