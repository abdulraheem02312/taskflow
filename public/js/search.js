// Ctrl+K search palette: find tasks and projects across everything, open one with Enter.
// Loaded before app.js. Uses state, $, make, api, navigate, highlight and formatDue
// from the other files (only inside functions, so the load order is safe).

const palette = { items: [], active: 0, timer: null, seq: 0 };
const paletteEl = document.getElementById('palette');
const paletteInput = document.getElementById('palette-input');

const ICONS = {
  home: '<svg viewBox="0 0 20 20"><path d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"/></svg>',
  check: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M7 10.2l2 2 4-4.4"/></svg>',
};

function paletteIsOpen() {
  return !paletteEl.hidden;
}

function openPalette() {
  paletteEl.hidden = false;
  paletteInput.value = '';
  showPaletteResults(defaultPaletteGroups());
  paletteInput.focus();
}

function closePalette() {
  paletteEl.hidden = true;
  clearTimeout(palette.timer);
  palette.seq++; // ignore any search still on its way
}

// Before typing: quick jumps to pages and projects
function defaultPaletteGroups() {
  const items = [
    { icon: 'home', title: 'Home', sub: 'Go to page', url: '/app' },
    { icon: 'check', title: 'My Tasks', sub: 'Go to page', url: '/app/my-tasks' },
    ...state.projects.slice(0, 8).map((p) => ({
      color: p.color,
      title: p.name,
      sub: `${p.open_tasks || 0} open task${p.open_tasks === 1 ? '' : 's'}`,
      url: `/app/projects/${p.id}`,
    })),
  ];
  return [{ name: 'Jump to', items }];
}

async function runSearch(q) {
  const seq = ++palette.seq;
  let data;
  try {
    data = await api(`/api/search?q=${encodeURIComponent(q)}`);
  } catch {
    return;
  }
  if (seq !== palette.seq) return; // a newer search has started since

  const groups = [];
  if (data.projects.length) {
    groups.push({
      name: 'Projects',
      items: data.projects.map((p) => ({ color: p.color, title: p.name, sub: 'Project', url: `/app/projects/${p.id}` })),
    });
  }
  if (data.tasks.length) {
    groups.push({
      name: 'Tasks',
      items: data.tasks.map((t) => ({
        task: true,
        done: !!t.completed,
        title: t.title,
        sub: [t.project_name, t.completed ? 'Completed' : formatDue(t.due_date)].filter(Boolean).join('  ·  '),
        url: `/app/projects/${t.project_id}?task=${t.id}`,
      })),
    });
  }
  showPaletteResults(groups, q);
}

function showPaletteResults(groups, q = '') {
  const box = $('palette-results');
  box.innerHTML = '';
  palette.items = [];
  palette.active = 0;

  if (!groups.length) {
    const empty = make('div', 'palette-empty');
    empty.append(make('strong', '', `No results for "${q}"`), make('span', '', 'Try a different word, or check the spelling.'));
    box.append(empty);
    paletteInput.removeAttribute('aria-activedescendant');
    return;
  }

  for (const group of groups) {
    box.append(make('div', 'palette-group', group.name));
    for (const item of group.items) {
      const index = palette.items.length;
      const el = make('div', 'palette-item');
      el.id = `palette-item-${index}`;
      el.setAttribute('role', 'option');

      const icon = make('span', 'palette-icon');
      if (item.icon) icon.innerHTML = ICONS[item.icon];
      else if (item.task) icon.classList.add('task', ...(item.done ? ['done'] : []));
      else {
        icon.classList.add('project');
        icon.style.background = item.color;
      }

      const text = make('span', 'palette-text');
      const title = make('span', 'palette-title' + (item.done ? ' done' : ''));
      title.append(highlight(item.title, q));
      text.append(title);
      if (item.sub) text.append(make('span', 'palette-sub', item.sub));

      el.append(icon, text, make('kbd', 'palette-enter', 'Enter'));
      el.addEventListener('mousemove', () => { if (palette.active !== index) setPaletteActive(index); });
      el.addEventListener('click', () => choosePaletteItem(index));
      box.append(el);
      palette.items.push({ ...item, el });
    }
  }
  setPaletteActive(0);
}

function setPaletteActive(index) {
  if (!palette.items.length) return;
  palette.active = (index + palette.items.length) % palette.items.length; // wrap around
  palette.items.forEach((item, i) => {
    item.el.classList.toggle('active', i === palette.active);
    item.el.setAttribute('aria-selected', String(i === palette.active));
  });
  const el = palette.items[palette.active].el;
  el.scrollIntoView({ block: 'nearest' });
  paletteInput.setAttribute('aria-activedescendant', el.id);
}

function choosePaletteItem(index) {
  const item = palette.items[index];
  if (!item) return;
  closePalette();
  navigate(item.url);
}

// ---------- Events ----------

paletteInput.addEventListener('input', () => {
  clearTimeout(palette.timer);
  const q = paletteInput.value.trim();
  if (!q) {
    palette.seq++;
    showPaletteResults(defaultPaletteGroups());
    return;
  }
  palette.timer = setTimeout(() => runSearch(q), 120); // wait for a short pause in typing
});

paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteActive(palette.active + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteActive(palette.active - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePaletteItem(palette.active); }
});

// Ctrl+K (Cmd+K on Mac) toggles it from anywhere; Escape closes it.
// Capture phase, so Escape doesn't also close the task panel behind it.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (paletteIsOpen()) closePalette();
    else openPalette();
  } else if (e.key === 'Escape' && paletteIsOpen()) {
    e.preventDefault();
    e.stopPropagation();
    closePalette();
  }
}, true);

paletteEl.addEventListener('mousedown', (e) => { if (e.target === paletteEl) closePalette(); });

document.getElementById('open-search').addEventListener('click', (e) => {
  e.stopPropagation();
  openPalette();
});

// Show the Mac shortcut on Macs
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.querySelector('#open-search kbd').textContent = '⌘ K';
}
