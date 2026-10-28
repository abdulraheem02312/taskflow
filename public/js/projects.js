// Projects page (/app/projects): every project you are in, with a summary strip,
// search, filters (all, owned, shared, favorites, archived), sort, and a grid or
// list layout. Cards show status, progress, overdue tasks, members and a ⋯ menu.
// Loaded before app.js. Uses state, $, make, api, showPage, projectInitial, avatar,
// statusChip, progressBar, formatDue, timeAgo, openMenu, MENU_ICONS, setArchived,
// openDuplicateDialog, openStatusDialog, renderProjects, toast and
// openNewProjectDialog from the other files (only inside functions).

const projectsView = { q: '', filter: 'all', sort: 'recent', layout: 'grid' };
try {
  projectsView.layout = localStorage.getItem('projects-layout') === 'list' ? 'list' : 'grid';
  projectsView.sort = localStorage.getItem('projects-sort') || 'recent';
} catch {}

function showProjectsPage() {
  showPage('projects');
  state.projectId = null;
  document.title = 'Projects | Taskflow';
  renderProjectsPage();
}

function projectPercent(p) {
  const total = p.total_tasks || 0;
  return total ? Math.round(((total - (p.open_tasks || 0)) / total) * 100) : 0;
}

function renderProjectStats(active) {
  const open = active.reduce((n, p) => n + (p.open_tasks || 0), 0);
  const overdue = active.reduce((n, p) => n + (p.overdue_tasks || 0), 0);
  const risky = active.filter((p) => p.status === 'at_risk' || p.status === 'off_track').length;
  const stats = [
    ['Active projects', active.length, ''],
    ['Open tasks', open, ''],
    ['Overdue tasks', overdue, overdue ? 'bad' : ''],
    ['At risk or off track', risky, risky ? 'warn' : ''],
  ];
  $('projects-stats').replaceChildren(...stats.map(([label, value, tone]) => {
    const box = make('div', 'proj-stat' + (tone ? ` ${tone}` : ''));
    box.append(make('span', 'proj-stat-value', String(value)), make('span', 'proj-stat-label', label));
    return box;
  }));
}

function renderProjectsPage() {
  const all = state.projects;
  const active = all.filter((p) => !p.archived);
  const owned = active.filter((p) => p.role === 'owner').length;
  $('projects-sub').textContent = all.length
    ? `${active.length} active project${active.length === 1 ? '' : 's'}, ${owned} owned by you`
    : 'Projects hold your tasks. Create one to get started.';
  $('projects-stats').hidden = !active.length;
  renderProjectStats(active);

  for (const btn of document.querySelectorAll('#projects-filter .seg-btn')) {
    const on = btn.dataset.filter === projectsView.filter;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  for (const btn of document.querySelectorAll('#projects-layout .seg-btn')) {
    btn.classList.toggle('active', btn.dataset.layout === projectsView.layout);
  }
  $('projects-sort').value = projectsView.sort;

  const q = projectsView.q.toLowerCase();
  const shown = all.filter((p) => {
    if ((projectsView.filter === 'archived') !== !!p.archived) return false;
    if (projectsView.filter === 'owned' && p.role !== 'owner') return false;
    if (projectsView.filter === 'shared' && p.role === 'owner') return false;
    if (projectsView.filter === 'favorites' && !p.favorite) return false;
    return !q || p.name.toLowerCase().includes(q);
  });
  const last = (p) => p.last_task_at || p.created_at || '';
  const by = {
    recent: (a, b) => last(b).localeCompare(last(a)),
    name: (a, b) => a.name.localeCompare(b.name),
    progress: (a, b) => projectPercent(b) - projectPercent(a),
    open: (a, b) => (b.open_tasks || 0) - (a.open_tasks || 0),
    due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
  }[projectsView.sort] || (() => 0);
  shown.sort((a, b) => (b.favorite || 0) - (a.favorite || 0) || by(a, b));

  const box = $('projects-browse');
  box.className = projectsView.layout === 'list' ? 'projects-list' : 'projects-browse';
  box.replaceChildren();

  if (!shown.length && (q || projectsView.filter !== 'all')) {
    const text = q ? `No project matches "${projectsView.q}".`
      : { archived: 'No archived projects. Archive one from its ⋯ menu.',
        favorites: 'No favorites yet. Star a project with ☆ to pin it here and in the sidebar.',
        owned: 'You do not own any project yet.',
        shared: 'Nothing here yet. Projects others share with you show up here.' }[projectsView.filter];
    box.append(make('p', 'browse-empty', text));
  }
  if (projectsView.layout === 'list') {
    if (shown.length) box.append(buildProjectTable(shown));
  } else {
    for (const project of shown) box.append(buildBrowseCard(project));
  }

  // "New project" card, unless a search or filter is narrowing things down
  if (!q && (projectsView.filter === 'all' || projectsView.filter === 'owned')) {
    const add = make('button', projectsView.layout === 'list' ? 'btn btn-ghost proj-add-row' : 'browse-card add');
    add.type = 'button';
    add.innerHTML = '<span class="browse-plus" aria-hidden="true">+</span><span>New project</span>';
    add.addEventListener('click', () => openNewProjectDialog());
    box.append(add);
  }
}

function memberStack(project) {
  const stack = make('span', 'member-stack');
  for (const m of project.members || []) {
    const a = avatar(m, 'sm');
    a.title = m.name;
    stack.append(a);
  }
  const more = (project.member_count || 0) - (project.members || []).length;
  if (more > 0) stack.append(make('span', 'avatar avatar-sm more', `+${more}`));
  return stack;
}

function favButton(project) {
  const fav = make('button', 'proj-fav' + (project.favorite ? ' on' : ''), project.favorite ? '★' : '☆');
  fav.type = 'button';
  fav.title = project.favorite ? 'Remove from favorites' : 'Add to favorites';
  fav.setAttribute('aria-pressed', String(!!project.favorite));
  fav.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const updated = await api(`/api/projects/${project.id}/favorite`, { method: 'POST', body: { favorite: !project.favorite } });
    project.favorite = updated.favorite;
    renderProjects();
    renderProjectsPage();
  });
  return fav;
}

function projectMenuButton(project) {
  const more = make('button', 'icon-btn proj-more', '⋯');
  more.type = 'button';
  more.title = 'More actions';
  more.setAttribute('aria-label', `More actions for ${project.name}`);
  more.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.currentTarget, [
      { label: 'Open project', icon: MENU_ICONS.project, onClick: () => navigate(`/app/projects/${project.id}`) },
      { label: 'Post a status update', icon: MENU_ICONS.task, onClick: () => openStatusDialog(project) },
      { label: 'Duplicate', icon: MENU_ICONS.project, onClick: () => openDuplicateDialog(project) },
      { label: 'Copy link', icon: MENU_ICONS.settings, onClick: async () => {
        try {
          await navigator.clipboard.writeText(`${location.origin}/app/projects/${project.id}`);
          toast('Link copied');
        } catch { toast('Could not copy the link', 'error'); }
      } },
      ...(project.role === 'owner' ? [{ label: project.archived ? 'Unarchive project' : 'Archive project', icon: MENU_ICONS.hide,
        onClick: async () => { await setArchived(project, !project.archived); renderProjectsPage(); } }] : []),
    ], { align: 'right' });
  });
  return more;
}

function dueLabel(project) {
  if (!project.due_date) return null;
  const late = project.due_date < new Date().toLocaleDateString('en-CA') && project.status !== 'complete';
  return make('span', 'proj-due' + (late ? ' late' : ''), `Due ${formatDue(project.due_date)}`);
}

function buildBrowseCard(project) {
  const total = project.total_tasks || 0;
  const done = total - (project.open_tasks || 0);
  const percent = projectPercent(project);

  const card = make('a', 'browse-card proj-card');
  card.href = `/app/projects/${project.id}`;
  card.style.setProperty('--c', project.color);

  const top = make('div', 'browse-top');
  const icon = make('span', 'project-color', projectInitial(project));
  icon.style.background = project.color;
  const tools = make('span', 'proj-tools');
  tools.append(favButton(project), projectMenuButton(project));
  top.append(icon, tools);

  const name = make('span', 'browse-name', project.name);
  const sub = make('div', 'proj-sub');
  sub.append(statusChip(project.status));
  const due = dueLabel(project);
  if (due) sub.append(due);

  const numbers = make('div', 'proj-numbers');
  const num = (value, label, tone) => {
    const n = make('span', 'proj-num' + (tone ? ` ${tone}` : ''));
    n.append(make('strong', '', String(value)), make('span', '', label));
    return n;
  };
  numbers.append(num(project.open_tasks || 0, 'open'), num(done, 'done'),
    num(project.overdue_tasks || 0, 'overdue', project.overdue_tasks ? 'bad' : ''));

  const prog = make('div', 'proj-progress');
  prog.append(progressBar(percent, project.color), make('span', 'proj-percent', `${percent}%`));

  const foot = make('div', 'browse-foot proj-foot');
  foot.append(memberStack(project), make('span', 'proj-when',
    project.archived ? 'Archived' : project.last_task_at ? `Active ${timeAgo(project.last_task_at)}` : total ? '' : 'No tasks yet'));
  card.append(top, name, sub, numbers, prog, foot);
  return card;
}

function buildProjectTable(projects) {
  const wrap = make('div', 'widget proj-table-wrap');
  const table = make('table', 'pf-table proj-table');
  const head = make('tr');
  for (const h of ['', 'Name', 'Status', 'Owner', 'Members', 'Progress', 'Open', 'Due', '']) head.append(make('th', '', h));
  const thead = make('thead');
  thead.append(head);
  const tbody = make('tbody');
  for (const p of projects) {
    const tr = make('tr', 'proj-row');
    const name = make('a', 'proj-row-name');
    name.href = `/app/projects/${p.id}`;
    const icon = make('span', 'project-color sm', projectInitial(p));
    icon.style.background = p.color;
    name.append(icon, make('span', '', p.name));
    const prog = make('div', 'proj-progress');
    prog.append(progressBar(projectPercent(p), p.color), make('span', 'proj-percent', `${projectPercent(p)}%`));
    const open = make('span', p.overdue_tasks ? 'proj-open-bad' : '', String(p.open_tasks || 0));
    if (p.overdue_tasks) open.title = `${p.overdue_tasks} overdue`;
    const cells = [favButton(p), name, statusChip(p.status), p.role === 'owner' ? 'You' : (p.owner_name || ''),
      memberStack(p), prog, open, dueLabel(p) || '', projectMenuButton(p)];
    cells.forEach((c, i) => {
      const td = make('td', i === 6 ? 'num' : '');
      td.append(c);
      tr.append(td);
    });
    tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) navigate(`/app/projects/${p.id}`); });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

document.getElementById('projects-search').addEventListener('input', (e) => {
  projectsView.q = e.target.value.trim();
  renderProjectsPage();
});

for (const btn of document.querySelectorAll('#projects-filter .seg-btn')) {
  btn.addEventListener('click', () => {
    projectsView.filter = btn.dataset.filter;
    renderProjectsPage();
  });
}

for (const btn of document.querySelectorAll('#projects-layout .seg-btn')) {
  btn.addEventListener('click', () => {
    projectsView.layout = btn.dataset.layout;
    try { localStorage.setItem('projects-layout', projectsView.layout); } catch {}
    renderProjectsPage();
  });
}

document.getElementById('projects-sort').addEventListener('change', (e) => {
  projectsView.sort = e.target.value;
  try { localStorage.setItem('projects-sort', projectsView.sort); } catch {}
  renderProjectsPage();
});

document.getElementById('projects-new').addEventListener('click', () => openNewProjectDialog());
