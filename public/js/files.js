// Files tab: every file attached to any task of the project, as a grid or a list,
// with search, sort and "Add file" (pick the task it belongs to).
// Loaded before app.js. Uses state, $, make, api, openModal, openDetail, toast,
// formatSize, fileExt, fileColor, sendFile, openLightbox, timeAgo, refreshCounts
// and changeAttachmentCount from the other files (only inside functions).

const filesView = { layout: 'grid', q: '', sort: 'new', items: [], projectId: null, loading: false };
try { if (localStorage.getItem('files-layout') === 'list') filesView.layout = 'list'; } catch {}

async function loadProjectFiles() {
  const id = state.projectId;
  filesView.loading = true;
  const items = await api(`/api/projects/${id}/attachments`);
  if (id !== state.projectId) return;
  filesView.items = items;
  filesView.projectId = id;
  filesView.loading = false;
  drawFiles();
}

function renderFiles() {
  if (filesView.projectId !== state.projectId) {
    filesView.items = [];
    filesView.projectId = state.projectId;
  }
  // render() runs often; fetch again only every few seconds
  if (!filesView.loading && Date.now() - (filesView.fetchedAt || 0) > 5000) {
    filesView.fetchedAt = Date.now();
    loadProjectFiles();
  }
  drawFiles();
}

function drawFiles() {
  const view = $('files-view');
  const bar = make('div', 'files-bar');
  const add = make('button', 'btn btn-ghost', '+ Add file');
  add.type = 'button';
  add.addEventListener('click', openAddFileDialog);

  const search = make('div', 'search-box');
  search.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';
  const input = make('input');
  input.type = 'search';
  input.placeholder = 'Find a file';
  input.value = filesView.q;
  input.setAttribute('aria-label', 'Find a file');
  input.addEventListener('input', () => {
    filesView.q = input.value.trim();
    drawGrid();
  });
  search.append(input);

  const sort = make('select');
  sort.setAttribute('aria-label', 'Sort');
  for (const [v, l] of [['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name (A to Z)'], ['size', 'Biggest first']]) sort.append(new Option(l, v));
  sort.value = filesView.sort;
  sort.addEventListener('change', () => { filesView.sort = sort.value; drawGrid(); });

  const layout = make('div', 'seg');
  for (const [v, l] of [['grid', 'Grid'], ['list', 'List']]) {
    const b = make('button', 'seg-btn' + (filesView.layout === v ? ' active' : ''), l);
    b.type = 'button';
    b.addEventListener('click', () => {
      filesView.layout = v;
      try { localStorage.setItem('files-layout', v); } catch {}
      drawFiles();
    });
    layout.append(b);
  }
  bar.append(add, search, sort, layout);

  const box = make('div', 'files-box');
  view.replaceChildren(bar, box);

  function drawGrid() {
    const q = filesView.q.toLowerCase();
    const items = filesView.items.filter((a) => !q || a.name.toLowerCase().includes(q) || a.task_title.toLowerCase().includes(q));
    const by = {
      new: (a, b) => b.id - a.id,
      old: (a, b) => a.id - b.id,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
    }[filesView.sort];
    items.sort(by);
    if (!filesView.items.length) {
      const empty = make('div', 'page-empty');
      const btn = make('button', 'btn btn-primary', '+ Add the first file');
      btn.type = 'button';
      btn.addEventListener('click', openAddFileDialog);
      empty.append(make('div', 'page-empty-icon', '📎'), make('h2', '', filesView.loading ? 'Loading files...' : 'No files yet'),
        make('p', '', 'Every file attached to a task in this project shows up here.'), btn);
      box.replaceChildren(empty);
      return;
    }
    if (!items.length) {
      box.replaceChildren(make('p', 'browse-empty', `No file matches "${filesView.q}".`));
      return;
    }
    box.replaceChildren(filesView.layout === 'grid' ? fileGrid(items) : fileList(items));
  }
  drawGrid();
}

function fileThumb(a, big) {
  const url = `/api/attachments/${a.id}`;
  if (a.is_image) {
    const img = make('img', big ? 'file-img' : '');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }
  const badge = make('span', 'file-badge' + (big ? ' big' : ''), (fileExt(a.name) || 'file').slice(0, 4).toUpperCase());
  badge.style.setProperty('--c', fileColor(a.name));
  return badge;
}

function openFile(a) {
  if (a.is_image) openLightbox(a);
  else window.location.href = `/api/attachments/${a.id}?download=1`;
}

function taskLink(a) {
  const link = make('button', 'file-task', `On: ${a.task_title}`);
  link.type = 'button';
  link.title = 'Open the task';
  link.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetail(a.task_id);
  });
  return link;
}

function fileGrid(items) {
  const grid = make('div', 'file-grid');
  for (const a of items) {
    const card = make('div', 'file-card');
    card.tabIndex = 0;
    const preview = make('div', 'file-preview');
    preview.append(fileThumb(a, true));
    const info = make('div', 'file-info');
    const name = make('span', 'file-name', a.name);
    name.title = a.name;
    info.append(name, make('span', 'file-meta', `${formatSize(a.size)} · ${a.user_name || 'Former member'} · ${timeAgo(a.created_at)}`), taskLink(a));
    card.append(preview, info);
    card.addEventListener('click', () => openFile(a));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile(a); });
    grid.append(card);
  }
  return grid;
}

function fileList(items) {
  const wrap = make('div', 'widget files-list');
  const table = make('table', 'pf-table');
  const head = make('tr');
  for (const h of ['Name', 'Task', 'Added by', 'Added', 'Size', '']) head.append(make('th', '', h));
  const thead = make('thead');
  thead.append(head);
  const tbody = make('tbody');
  for (const a of items) {
    const tr = make('tr');
    const name = make('button', 'file-row-name');
    name.type = 'button';
    const thumb = make('span', 'file-row-thumb');
    thumb.append(fileThumb(a, false));
    name.append(thumb, make('span', '', a.name));
    name.addEventListener('click', () => openFile(a));
    const dl = make('a', 'btn-link', 'Download');
    dl.href = `/api/attachments/${a.id}?download=1`;
    const cells = [name, taskLink(a), a.user_name || 'Former member', timeAgo(a.created_at), formatSize(a.size), dl];
    cells.forEach((c, i) => {
      const td = make('td', i === 4 ? 'num' : '');
      td.append(c);
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

// Add file: pick the task, then the files (up to 50 MB each)
function openAddFileDialog() {
  const tasks = state.tasks.filter((t) => t.project_id === state.projectId);
  const { body, close } = openModal({ title: 'Add a file', className: 'create-modal' });
  if (!tasks.length) {
    body.append(make('p', '', 'Files belong to tasks. Add a task to this project first.'));
    return;
  }
  const form = make('form', 'settings-form');
  const task = make('select');
  for (const t of tasks) task.append(new Option(t.title, t.id));
  const fileInput = make('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.required = true;
  const taskField = make('label', 'field');
  taskField.append('Attach to task', task);
  const fileField = make('label', 'field');
  fileField.append('Files (up to 50 MB each)', fileInput);
  const actions = make('div', 'modal-actions');
  const go = make('button', 'btn btn-primary', 'Upload');
  go.type = 'submit';
  actions.append(go);
  form.append(taskField, fileField, actions);
  body.append(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = Number(task.value);
    go.disabled = true;
    let added = 0;
    for (const file of fileInput.files) {
      if (file.size > 50 * 1024 * 1024) { toast(`"${file.name}" is bigger than 50 MB`, 'error'); continue; }
      try {
        go.textContent = `Uploading ${file.name}...`;
        await sendFile(taskId, file, () => {});
        added++;
        const t = state.tasks.find((x) => x.id === taskId);
        if (t) t.attachment_count = (t.attachment_count || 0) + 1;
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    close();
    if (added) toast(`${added} file${added === 1 ? '' : 's'} added`);
    loadProjectFiles();
  });
}
