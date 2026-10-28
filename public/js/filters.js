// Search and filters: narrow down the tasks shown in List, Board and Calendar.
// Loaded before app.js. Uses state, $, make, render and dateKey from app.js
// (only inside functions, so the load order is safe).

const filters = { q: '', tag: '', priority: '', due: '' };
let filterTagsKey = null; // the tags the tag dropdown was last built from

function filtersActive() {
  return Boolean(filters.q || filters.tag || filters.priority || filters.due);
}

// The tasks the current filters let through (all tasks when no filter is set)
function visibleTasks() {
  return filtersActive() ? state.tasks.filter(matchesFilters) : state.tasks;
}

function matchesFilters(task) {
  if (filters.q) {
    // Search looks in the task name and its description
    const q = filters.q.toLowerCase();
    if (!task.title.toLowerCase().includes(q) && !task.notes.toLowerCase().includes(q)) return false;
  }
  if (filters.tag && !task.tag_ids.includes(Number(filters.tag))) return false;
  if (filters.priority === 'none' && task.priority) return false;
  if (filters.priority && filters.priority !== 'none' && task.priority !== filters.priority) return false;
  if (filters.due && !matchesDue(task)) return false;
  return true;
}

function matchesDue(task) {
  const due = task.due_date;
  if (filters.due === 'none') return !due;
  if (!due) return false;

  const today = dateKey(new Date());
  if (filters.due === 'overdue') return due < today && !task.completed;
  if (filters.due === 'today') return due === today;
  if (filters.due === 'week') {
    const end = new Date();
    end.setDate(end.getDate() + 6);
    return due >= today && due <= dateKey(end);
  }
  return true;
}

// The task name with the searched text marked, built from text nodes (never innerHTML)
function highlight(text, query = filters.q) {
  const frag = document.createDocumentFragment();
  const q = query.toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i === -1) {
    frag.append(text);
  } else {
    frag.append(text.slice(0, i), make('mark', '', text.slice(i, i + q.length)), text.slice(i + q.length));
  }
  return frag;
}

// Called by render(): keeps the tag list, "Clear filters" and the result count up to date
function renderFilterBar() {
  // Rebuild the tag dropdown only when the tags change, so an open dropdown isn't reset
  const key = state.tags.map((t) => `${t.id}:${t.name}`).join(',');
  if (key !== filterTagsKey) {
    filterTagsKey = key;
    if (filters.tag && !state.tags.some((t) => String(t.id) === filters.tag)) filters.tag = '';
    const select = $('filter-tag');
    select.innerHTML = '';
    select.append(new Option('Tag', ''));
    for (const tag of state.tags) select.append(new Option(tag.name, tag.id));
    select.value = filters.tag;
  }

  for (const id of ['filter-tag', 'filter-priority', 'filter-due']) {
    $(id).classList.toggle('on', $(id).value !== '');
  }
  const active = filtersActive();
  $('filter-clear').hidden = !active;
  $('filter-count').textContent = active ? `${visibleTasks().length} of ${state.tasks.length} tasks` : '';
}

function clearFilters() {
  filters.q = '';
  filters.tag = '';
  filters.priority = '';
  filters.due = '';
  document.getElementById('filter-search').value = '';
  for (const id of ['filter-tag', 'filter-priority', 'filter-due']) document.getElementById(id).value = '';
  render();
}

// ---------- Events ----------

const searchInput = document.getElementById('filter-search');

searchInput.addEventListener('input', () => {
  filters.q = searchInput.value.trim();
  render();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation(); // don't also close the task panel
  if (searchInput.value) {
    searchInput.value = '';
    filters.q = '';
    render();
  } else {
    searchInput.blur();
  }
});

for (const [id, field] of [['filter-tag', 'tag'], ['filter-priority', 'priority'], ['filter-due', 'due']]) {
  document.getElementById(id).addEventListener('change', (e) => {
    filters[field] = e.target.value;
    render();
  });
}

document.getElementById('filter-clear').addEventListener('click', clearFilters);

// Press "/" anywhere (while not typing): in a project it searches that project,
// on Home and My Tasks it opens the search palette for everything
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  if (state.page === 'project') searchInput.focus();
  else openPalette();
});
