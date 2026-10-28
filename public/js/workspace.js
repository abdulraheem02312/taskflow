// Project status updates, Portfolios, Goals, Rules, the project Form and Duplicate.
// Loaded before app.js. Uses state, $, make, api, render, navigate, toast, openModal,
// confirmDialog, openMenu, MENU_ICONS, loadMembers, currentProject, projectInitial,
// refreshCounts, formatDue, timeAgo, avatar and ACCENTS from the other files
// (only inside functions, so the load order is safe).

const STATUS_INFO = {
  on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', on_hold: 'On hold', complete: 'Complete',
};

function statusChip(status) {
  const chip = make('span', `st-chip st-${status || 'none'}`);
  chip.append(make('span', 'st-dot'), STATUS_INFO[status] || 'Set status');
  return chip;
}

function progressBar(percent, color) {
  const bar = make('span', 'progress');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', String(percent));
  const fill = make('span');
  fill.style.width = `${percent}%`;
  fill.style.setProperty('--fill', color || 'var(--viz-series)');
  bar.append(fill);
  return bar;
}

const percentDone = (p) => (p.total_tasks ? Math.round(((p.total_tasks - p.open_tasks) / p.total_tasks) * 100) : 0);

function field(label, control) {
  const el = make('label', 'field');
  el.append(label, control);
  return el;
}

function input(type, value = '', attrs = {}) {
  const el = make(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') el.type = type;
  el.value = value ?? '';
  Object.assign(el, attrs);
  return el;
}

function select(options, value) {
  const el = make('select');
  for (const [v, label] of options) el.append(new Option(label, v));
  if (value !== undefined && value !== null) el.value = String(value);
  return el;
}

function actionsRow(...buttons) {
  const row = make('div', 'modal-actions');
  row.append(...buttons);
  return row;
}

function button(text, cls = 'btn btn-ghost', type = 'button') {
  const b = make('button', cls, text);
  b.type = type;
  return b;
}

function colorPicker(initial) {
  const box = make('div', 'swatches');
  box.value = initial;
  for (const c of ACCENTS) {
    const label = make('label', 'swatch');
    const radio = input('radio', c, { name: `color-${Math.random()}`, checked: c === initial });
    radio.setAttribute('aria-label', c);
    radio.addEventListener('change', () => { box.value = c; });
    const dot = make('span');
    dot.style.background = c;
    label.append(radio, dot);
    box.append(label);
  }
  const wrap = make('div', 'field');
  wrap.append('Color', box);
  wrap.picker = box;
  return wrap;
}

// ---------- Project status ----------

function renderProjectStatus(project) {
  $('project-status').replaceChildren(statusChip(project.status));
}

document.getElementById('project-status').addEventListener('click', () => openStatusDialog(currentProject()));

function openStatusDialog(project) {
  if (!project) return;
  const { body, close } = openModal({ title: 'Project status', className: 'create-modal status-modal' });
  const form = make('form', 'settings-form');
  let chosen = project.status || 'on_track';
  const choices = make('div', 'st-choices');
  for (const key of Object.keys(STATUS_INFO)) {
    const b = button('', 'st-choice' + (key === chosen ? ' on' : ''));
    b.append(statusChip(key));
    b.setAttribute('aria-pressed', String(key === chosen));
    b.addEventListener('click', () => {
      chosen = key;
      for (const c of choices.children) {
        c.classList.toggle('on', c === b);
        c.setAttribute('aria-pressed', String(c === b));
      }
    });
    choices.append(b);
  }
  const note = input('textarea', '', { rows: 3, maxLength: 2000, placeholder: 'What is the latest? What is blocked? (optional)' });
  const post = button('Post update', 'btn btn-primary', 'submit');
  form.append(choices, field('Update', note), actionsRow(post));
  const history = make('ul', 'st-history');
  body.append(form, make('div', 'share-label', 'Earlier updates'), history);

  async function loadHistory() {
    const updates = await api(`/api/projects/${project.id}/status`);
    history.replaceChildren();
    if (!updates.length) history.append(make('li', 'home-empty', 'No updates yet. Post the first one above.'));
    for (const u of updates) {
      const li = make('li', 'st-update');
      const meta = make('div', 'st-update-meta');
      meta.append(statusChip(u.status), make('span', '', `${u.user_name || 'Someone'} · ${timeAgo(u.created_at)}`));
      li.append(meta);
      if (u.body) li.append(make('p', '', u.body));
      history.append(li);
    }
  }
  loadHistory();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    post.disabled = true;
    try {
      const updated = await api(`/api/projects/${project.id}/status`, { method: 'POST', body: { status: chosen, body: note.value } });
      project.status = updated.status;
      renderProjectStatus(project);
      note.value = '';
      toast(`Status set to ${STATUS_INFO[chosen]}`);
      await loadHistory();
    } finally {
      post.disabled = false;
    }
  });
  return close;
}

// "⋯" in the project header: actions any member can use
document.getElementById('project-more').addEventListener('click', (e) => {
  const project = currentProject();
  if (!project) return;
  openMenu(e.currentTarget, [
    { label: 'Post a status update', icon: MENU_ICONS.task, onClick: () => openStatusDialog(project) },
    { label: 'Rules (automations)', icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 2.5L4.5 11H10l-1 6.5L15.5 9H10z"/></svg>', onClick: () => openRulesDialog(project) },
    { label: 'Form', icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 7h6M7 10h6M7 13h3"/></svg>', onClick: () => openFormDialog(project) },
    { label: 'Add to portfolio', icon: MENU_ICONS.project, onClick: () => openAddToPortfolio(project) },
    ...(project.role === 'owner' ? [{ label: project.archived ? 'Unarchive project' : 'Archive project', icon: MENU_ICONS.hide, onClick: () => setArchived(project, !project.archived) }] : []),
    'separator',
    { label: 'Duplicate project', icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/></svg>', onClick: () => openDuplicateDialog(project) },
  ], { align: 'right' });
});

function openDuplicateDialog(project) {
  const { body, close } = openModal({ title: 'Duplicate project', className: 'create-modal' });
  const form = make('form', 'settings-form');
  const name = input('text', `${project.name} (copy)`, { required: true, maxLength: 80 });
  const go = button('Duplicate', 'btn btn-primary', 'submit');
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  form.append(field('New project name', name), make('p', 'field-hint', 'Sections and open tasks are copied. Completed tasks, comments, files and members are not.'), actionsRow(cancel, go));
  body.append(form);
  name.select();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const copy = await api(`/api/projects/${project.id}/duplicate`, { method: 'POST', body: { name: name.value } });
      close();
      await refreshCounts();
      navigate(`/app/projects/${copy.id}`);
      toast('Project duplicated');
    } catch {
      go.disabled = false;
    }
  });
}

// ---------- Rules ----------

const TRIGGER_TEXT = { added: 'A task is added', moved: 'A task moves into a section', completed: 'A task is completed' };
const ACTION_TEXT = { complete: 'Mark it complete', move: 'Move it to a section', assign: 'Assign it to someone', priority: 'Set its priority', due: 'Set its due date' };

async function openRulesDialog(project) {
  const { body } = openModal({ title: 'Rules', className: 'create-modal rules-modal' });
  body.append(make('p', 'field-hint', 'Rules do routine work for you: when something happens to a task in this project, they act right away.'));
  const list = make('ul', 'rule-list');
  body.append(list);
  const sections = state.projectId === project.id ? state.sections : await api(`/api/projects/${project.id}/sections`);
  const { members } = await loadMembers(project.id);
  const sectionName = (id) => sections.find((s) => s.id === Number(id))?.name || 'a deleted section';

  function describe(r) {
    const when = r.trigger === 'moved' ? `A task moves into "${sectionName(r.trigger_value)}"` : TRIGGER_TEXT[r.trigger];
    const then = {
      complete: 'mark it complete',
      move: `move it to "${sectionName(r.action_value)}"`,
      assign: `assign it to ${members.find((m) => m.id === Number(r.action_value))?.name || 'a former member'}`,
      priority: `set priority to ${r.action_value}`,
      due: Number(r.action_value) ? `make it due in ${r.action_value} day${r.action_value === '1' ? '' : 's'}` : 'make it due today',
    }[r.action];
    return [when, then];
  }

  async function draw() {
    const rules = await api(`/api/projects/${project.id}/rules`);
    list.replaceChildren();
    if (!rules.length) list.append(make('li', 'home-empty', 'No rules yet. Add one below.'));
    for (const r of rules) {
      const li = make('li', 'rule-row' + (r.enabled ? '' : ' off'));
      const [when, then] = describe(r);
      const text = make('div', 'rule-text');
      text.append(make('span', 'rule-when', `When: ${when}`), make('span', 'rule-then', `Then: ${then}`));
      const toggle = make('label', 'switch');
      const box = input('checkbox', '', { checked: !!r.enabled });
      box.setAttribute('aria-label', 'Rule on');
      box.addEventListener('change', async () => { await api(`/api/rules/${r.id}`, { method: 'PATCH', body: { enabled: box.checked } }); draw(); });
      toggle.append(box, make('span', 'switch-track'));
      const del = button('×', 'icon-btn');
      del.title = 'Delete rule';
      del.addEventListener('click', async () => { await api(`/api/rules/${r.id}`, { method: 'DELETE' }); draw(); });
      li.append(toggle, text, del);
      list.append(li);
    }
  }
  draw();

  // New rule: When ... Then ...
  const sectionOpts = sections.map((s) => [s.id, s.name]);
  const trigger = select(Object.entries(TRIGGER_TEXT));
  const triggerSection = select(sectionOpts);
  const action = select(Object.entries(ACTION_TEXT));
  const valueBox = make('div', 'rule-value');
  let valueInput = null;
  function drawValue() {
    triggerSection.hidden = trigger.value !== 'moved';
    valueInput = {
      move: () => select(sectionOpts),
      assign: () => select(members.map((m) => [m.id, m.name])),
      priority: () => select([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]),
      due: () => input('number', '3', { min: 0, max: 365, title: 'Days from the moment the rule runs' }),
    }[action.value]?.() || null;
    valueBox.replaceChildren(...(valueInput ? [valueInput] : []));
    if (action.value === 'due') valueBox.append(make('span', 'field-hint', 'days from then'));
  }
  trigger.addEventListener('change', drawValue);
  action.addEventListener('change', drawValue);
  drawValue();

  const form = make('form', 'settings-form rule-form');
  const whenRow = make('div', 'rule-line');
  whenRow.append(make('strong', '', 'When'), trigger, triggerSection);
  const thenRow = make('div', 'rule-line');
  thenRow.append(make('strong', '', 'Then'), action, valueBox);
  form.append(make('div', 'share-label', 'Add a rule'), whenRow, thenRow, actionsRow(button('Add rule', 'btn btn-primary', 'submit')));
  body.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/api/projects/${project.id}/rules`, { method: 'POST', body: {
      trigger: trigger.value, trigger_value: triggerSection.value, action: action.value, action_value: valueInput?.value ?? null,
    } });
    toast('Rule added');
    draw();
  });
}

// ---------- Form ----------

async function openFormDialog(project) {
  const { body } = openModal({ title: 'Form', className: 'create-modal' });
  const form = await api(`/api/projects/${project.id}/form`);
  const sections = state.projectId === project.id ? state.sections : await api(`/api/projects/${project.id}/sections`);
  const el = make('form', 'settings-form');
  const toggle = make('label', 'switch-row');
  const sw = make('span', 'switch');
  const on = input('checkbox', '', { checked: !!form.enabled });
  sw.append(on, make('span', 'switch-track'));
  toggle.append(sw, make('span', '', 'Accept answers (anyone with the link can send a request)'));
  const title = input('text', form.title || '', { maxLength: 120, placeholder: project.name });
  const desc = input('textarea', form.description || '', { rows: 3, maxLength: 1000, placeholder: 'Tell people what to send, for example bug reports or design requests.' });
  const section = select(sections.map((s) => [s.id, s.name]), form.section_id || sections[0]?.id);
  const linkRow = make('div', 'form-link');
  const save = button('Save form', 'btn btn-primary', 'submit');
  el.append(toggle, field('Form title', title), field('Description', desc), field('New requests go to section', section), linkRow, actionsRow(save));
  body.append(make('p', 'field-hint', 'Each answer becomes a task in this project, with the sender\'s name and email in its description.'), el);

  function drawLink(token) {
    linkRow.replaceChildren();
    if (!token) return;
    const url = `${location.origin}/form/${token}`;
    const box = input('text', url, { readOnly: true });
    box.setAttribute('aria-label', 'Form link');
    const copy = button('Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { box.select(); }
    });
    const open = make('a', 'btn btn-ghost', 'Open');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    linkRow.append(box, copy, open);
  }
  drawLink(form.token);

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saved = await api(`/api/projects/${project.id}/form`, { method: 'PUT', body: {
      enabled: on.checked, title: title.value, description: desc.value, section_id: Number(section.value),
    } });
    drawLink(saved.token);
    toast(saved.enabled ? 'Form saved. Share the link!' : 'Form saved (not accepting answers)');
  });
}

// ---------- Portfolios ----------

let portfoliosCache = [];
let portfolioData = null;

async function showPortfolios() {
  showPage('portfolios');
  state.projectId = null;
  document.title = 'Portfolios | Taskflow';
  renderPortfolios();
  const list = await api('/api/portfolios');
  portfoliosCache = list;
  if (state.page === 'portfolios') renderPortfolios();
}

function renderPortfolios() {
  const grid = $('portfolios-body');
  grid.replaceChildren();
  for (const f of portfoliosCache) {
    const card = make('a', 'browse-card');
    card.href = `/app/portfolios/${f.id}`;
    card.style.setProperty('--c', f.color);
    const top = make('div', 'browse-top');
    const icon = make('span', 'project-color', (f.name.trim()[0] || '').toUpperCase());
    icon.style.background = f.color;
    top.append(icon);
    card.append(top, make('span', 'browse-name', f.name), make('span', 'browse-meta', `${f.project_count} project${f.project_count === 1 ? '' : 's'}`));
    grid.append(card);
  }
  const add = make('button', 'browse-card add');
  add.type = 'button';
  add.innerHTML = '<span class="browse-plus" aria-hidden="true">+</span><span>New portfolio</span>';
  add.addEventListener('click', openNewPortfolioDialog);
  grid.append(add);
}

function openNewPortfolioDialog() {
  const { body, close } = openModal({ title: 'New portfolio', className: 'create-modal' });
  const form = make('form', 'settings-form');
  const name = input('text', '', { required: true, maxLength: 80, placeholder: 'For example: Q4 marketing' });
  const color = colorPicker(ACCENTS[portfoliosCache.length % ACCENTS.length]);
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  form.append(field('Portfolio name', name), color, actionsRow(cancel, button('Create portfolio', 'btn btn-primary', 'submit')));
  body.append(form);
  name.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = await api('/api/portfolios', { method: 'POST', body: { name: name.value, color: color.picker.value } });
    close();
    navigate(`/app/portfolios/${f.id}`);
  });
}

async function showPortfolio(id) {
  showPage('portfolio');
  state.projectId = null;
  portfolioData = null;
  renderPortfolio();
  try {
    portfolioData = await api(`/api/portfolios/${id}`);
  } catch {
    navigate('/app/portfolios');
    return;
  }
  if (state.page === 'portfolio') renderPortfolio();
}

function renderPortfolio() {
  const f = portfolioData;
  const body = $('portfolio-body');
  if (!f) {
    $('portfolio-title').textContent = '';
    $('portfolio-sub').textContent = 'Loading...';
    body.replaceChildren();
    return;
  }
  document.title = `${f.name} | Taskflow`;
  $('portfolio-title').textContent = f.name;
  $('portfolio-color').style.background = f.color;
  $('portfolio-color').textContent = (f.name.trim()[0] || '').toUpperCase();
  const risky = f.projects.filter((p) => p.status === 'at_risk' || p.status === 'off_track').length;
  $('portfolio-sub').textContent = `${f.projects.length} project${f.projects.length === 1 ? '' : 's'}`
    + (risky ? `, ${risky} need${risky === 1 ? 's' : ''} attention` : '');

  if (!f.projects.length) {
    const empty = make('div', 'page-empty');
    const add = button('Add a project', 'btn btn-primary');
    add.addEventListener('click', openAddProjectToPortfolio);
    empty.append(make('div', 'page-empty-icon', '▦'), make('h2', '', 'No projects here yet'),
      make('p', '', 'Add projects to see their status, progress and due dates side by side.'), add);
    body.replaceChildren(empty);
    return;
  }

  const wrap = make('div', 'pf-wrap widget');
  const table = make('table', 'pf-table');
  const head = make('tr');
  for (const h of ['Project', 'Status', 'Progress', 'Due date', 'Open', 'Overdue', 'Owner', '']) head.append(make('th', '', h));
  const thead = make('thead');
  thead.append(head);
  const tbody = make('tbody');
  for (const p of f.projects) {
    const tr = make('tr');
    const name = make('a', 'pf-name');
    name.href = `/app/projects/${p.id}`;
    const dot = make('span', 'project-dot');
    dot.style.background = p.color;
    name.append(dot, make('span', '', p.name));
    const prog = make('div', 'pf-progress');
    prog.append(progressBar(percentDone(p), p.color), make('span', '', `${percentDone(p)}%`));
    const owner = make('div', 'pf-owner');
    owner.append(avatar({ id: p.user_id, name: p.owner_name }), make('span', '', p.owner_name));
    const remove = button('×', 'icon-btn');
    remove.title = 'Remove from portfolio';
    remove.addEventListener('click', async () => {
      await api(`/api/portfolios/${f.id}/projects/${p.id}`, { method: 'DELETE' });
      showPortfolio(f.id);
    });
    const cells = [name, statusChip(p.status), prog, formatDue(p.due_date) || 'No date', String(p.open_tasks), String(p.overdue_tasks), owner, remove];
    cells.forEach((c, i) => {
      const td = make('td', ['', '', '', '', 'num', 'num' + (p.overdue_tasks ? ' late' : ''), '', ''][i]);
      td.append(c);
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  body.replaceChildren(wrap);
}

function openAddProjectToPortfolio() {
  const f = portfolioData;
  const choices = state.projects.filter((p) => !f.projects.some((x) => x.id === p.id));
  const { body, close } = openModal({ title: 'Add a project', className: 'create-modal' });
  if (!choices.length) {
    body.append(make('p', '', 'All your projects are already in this portfolio.'));
    return;
  }
  const form = make('form', 'settings-form');
  const pick = select(choices.map((p) => [p.id, p.name]));
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  form.append(field('Project', pick), actionsRow(cancel, button('Add', 'btn btn-primary', 'submit')));
  body.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/api/portfolios/${f.id}/projects`, { method: 'POST', body: { project_id: Number(pick.value) } });
    close();
    showPortfolio(f.id);
  });
}

async function openAddToPortfolio(project) {
  const list = await api('/api/portfolios');
  const { body, close } = openModal({ title: 'Add to portfolio', className: 'create-modal' });
  if (!list.length) {
    body.append(make('p', '', 'You have no portfolios yet. Create one first.'));
    const create = button('Create a portfolio', 'btn btn-primary');
    create.addEventListener('click', () => { close(); openNewPortfolioDialog(); });
    body.append(actionsRow(create));
    return;
  }
  const form = make('form', 'settings-form');
  const pick = select(list.map((f) => [f.id, f.name]));
  const cancel = button('Cancel');
  cancel.addEventListener('click', close);
  form.append(field('Portfolio', pick), actionsRow(cancel, button('Add', 'btn btn-primary', 'submit')));
  body.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/api/portfolios/${pick.value}/projects`, { method: 'POST', body: { project_id: project.id } });
    close();
    toast(`Added to "${list.find((f) => f.id === Number(pick.value)).name}"`);
  });
}

document.getElementById('portfolios-new').addEventListener('click', openNewPortfolioDialog);
document.getElementById('portfolio-add').addEventListener('click', () => portfolioData && openAddProjectToPortfolio());
document.getElementById('portfolio-more').addEventListener('click', (e) => {
  const f = portfolioData;
  if (!f) return;
  openMenu(e.currentTarget, [
    { label: 'Rename', icon: MENU_ICONS.settings, onClick: () => {
      const { body, close } = openModal({ title: 'Rename portfolio', className: 'create-modal' });
      const form = make('form', 'settings-form');
      const name = input('text', f.name, { required: true, maxLength: 80 });
      const color = colorPicker(f.color);
      form.append(field('Name', name), color, actionsRow(button('Save', 'btn btn-primary', 'submit')));
      body.append(form);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await api(`/api/portfolios/${f.id}`, { method: 'PATCH', body: { name: name.value, color: color.picker.value } });
        close();
        showPortfolio(f.id);
      });
    } },
    'separator',
    { label: 'Delete portfolio', icon: MENU_ICONS.hide, danger: true, onClick: async () => {
      if (!await confirmDialog({ title: `Delete "${f.name}"?`, message: 'Only the portfolio is deleted. Its projects stay as they are.', confirmText: 'Delete portfolio' })) return;
      await api(`/api/portfolios/${f.id}`, { method: 'DELETE' });
      toast('Portfolio deleted');
      navigate('/app/portfolios');
    } },
  ], { align: 'right' });
});

// ---------- Goals ----------

let goalsCache = null;

async function showGoals() {
  showPage('goals');
  state.projectId = null;
  document.title = 'Goals | Taskflow';
  renderGoals();
  const goals = await api('/api/goals');
  goalsCache = goals;
  if (state.page === 'goals') renderGoals();
}

function renderGoals() {
  const box = $('goals-body');
  if (!goalsCache) { box.replaceChildren(); return; }
  const done = goalsCache.filter((g) => g.progress >= 100).length;
  $('goals-sub').textContent = goalsCache.length ? `${goalsCache.length} goal${goalsCache.length === 1 ? '' : 's'}, ${done} reached` : 'Set targets and track how close you are';
  if (!goalsCache.length) {
    const empty = make('div', 'page-empty');
    const add = button('Set your first goal', 'btn btn-primary');
    add.addEventListener('click', () => openGoalDialog());
    empty.append(make('div', 'page-empty-icon', '◎'), make('h2', '', 'No goals yet'),
      make('p', '', 'A goal can measure itself from projects (their finished tasks), or you can update its progress by hand.'), add);
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(...goalsCache.map((g) => {
    const card = make('button', 'goal-card widget');
    card.type = 'button';
    const top = make('div', 'goal-top');
    top.append(make('span', 'goal-title', g.title), statusChip(g.status));
    const prog = make('div', 'goal-progress');
    prog.append(progressBar(g.progress), make('strong', '', `${g.progress}%`));
    const meta = make('div', 'goal-meta');
    meta.append(make('span', '', g.due_date ? `Due ${formatDue(g.due_date)}` : 'No due date'),
      make('span', '', g.measured ? `Measured from ${g.projects.length} project${g.projects.length === 1 ? '' : 's'}` : 'Updated by hand'));
    card.append(top, prog, meta);
    if (g.projects.length) {
      const chips = make('div', 'goal-projects');
      for (const p of g.projects) {
        const chip = make('span', 'project-chip');
        const dot = make('span', 'project-dot');
        dot.style.background = p.color;
        chip.append(dot, make('span', 'project-chip-name', `${p.name} · ${percentDone(p)}%`));
        chips.append(chip);
      }
      card.append(chips);
    }
    card.addEventListener('click', () => openGoalDialog(g));
    return card;
  }));
}

function openGoalDialog(goal = null) {
  const { body, close } = openModal({ title: goal ? 'Edit goal' : 'New goal', className: 'create-modal goal-modal' });
  const form = make('form', 'settings-form');
  const title = input('text', goal?.title, { required: true, maxLength: 200, placeholder: 'For example: Launch the new website' });
  const notes = input('textarea', goal?.notes, { rows: 2, maxLength: 4000, placeholder: 'Why it matters (optional)' });
  const due = input('date', goal?.due_date);
  const status = select([['', 'No status'], ...Object.entries(STATUS_INFO)], goal?.status || '');
  const progress = input('range', goal && !goal.measured ? goal.progress : 0, { min: 0, max: 100, step: 5 });
  const progressLabel = make('span', 'goal-range-value', `${progress.value}%`);
  progress.addEventListener('input', () => { progressLabel.textContent = `${progress.value}%`; });
  const linked = new Set(goal?.project_ids || []);
  const projectList = make('div', 'goal-pick');
  for (const p of state.projects) {
    const row = make('label', 'goal-pick-row');
    const box = input('checkbox', '', { checked: linked.has(p.id) });
    box.addEventListener('change', () => { if (box.checked) linked.add(p.id); else linked.delete(p.id); syncRange(); });
    const dot = make('span', 'project-dot');
    dot.style.background = p.color;
    row.append(box, dot, make('span', '', p.name));
    projectList.append(row);
  }
  const rangeField = make('div', 'field');
  const rangeRow = make('div', 'goal-range');
  rangeRow.append(progress, progressLabel);
  const rangeHint = make('span', 'field-hint');
  rangeField.append('Progress', rangeRow, rangeHint);
  function syncRange() {
    progress.disabled = linked.size > 0;
    rangeHint.textContent = linked.size ? 'Measured from the linked projects (their finished tasks)' : 'Drag to update by hand';
  }
  syncRange();

  const row = make('div', 'field-row');
  row.append(field('Due date', due), field('Status', status));
  const linkField = make('div', 'field');
  linkField.append('Measure from projects', projectList);
  const buttons = [button('Cancel'), button(goal ? 'Save' : 'Create goal', 'btn btn-primary', 'submit')];
  buttons[0].addEventListener('click', close);
  if (goal) {
    const del = button('Delete', 'btn btn-ghost danger');
    del.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Delete this goal?', message: `"${goal.title}" will be deleted.`, confirmText: 'Delete goal' })) return;
      await api(`/api/goals/${goal.id}`, { method: 'DELETE' });
      close();
      showGoals();
    });
    buttons.unshift(del);
  }
  form.append(field('Goal', title), field('Description', notes), row, linkField, rangeField, actionsRow(...buttons));
  body.append(form);
  title.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { title: title.value, notes: notes.value, due_date: due.value, status: status.value, progress: Number(progress.value), project_ids: [...linked] };
    await api(goal ? `/api/goals/${goal.id}` : '/api/goals', { method: goal ? 'PATCH' : 'POST', body: data });
    close();
    toast(goal ? 'Goal saved' : 'Goal created');
    if (state.page === 'goals') showGoals();
    else navigate('/app/goals');
  });
}

document.getElementById('goals-new').addEventListener('click', () => openGoalDialog());
