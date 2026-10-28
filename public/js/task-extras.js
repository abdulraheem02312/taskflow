// Priority, tags and subtasks: the small labels shown in the views,
// and their sections in the task detail panel.
// Loaded before app.js. Uses state, $, make, api, render, openTask and updateTask
// from app.js (only inside functions, so the load order is safe).

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';

// ---------- Labels for list rows and board cards ----------

function priorityBadge(task) {
  if (!task.priority) return null;
  return make('span', `badge prio-${task.priority}`, PRIORITY_LABELS[task.priority]);
}

function taskTags(task) {
  return (task.tag_ids || [])
    .map((id) => state.tags.find((t) => t.id === id))
    .filter(Boolean);
}

function tagPill(tag, onRemove) {
  const pill = make('span', 'tag-pill', tag.name);
  pill.style.background = `${tag.color}24`;   // tag color at 14% opacity
  pill.style.borderColor = `${tag.color}55`;  // and a tinted edge
  pill.style.setProperty('--dot', tag.color);
  if (onRemove) {
    const x = make('button', 'tag-remove', '×');
    x.type = 'button';
    x.title = `Remove "${tag.name}"`;
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    pill.append(x);
  }
  return pill;
}

function subtaskCount(task) {
  if (!task.subtasks_total) return null;
  const allDone = task.subtasks_done === task.subtasks_total;
  const el = make('span', 'subtask-count' + (allDone ? ' all-done' : ''));
  el.title = `${task.subtasks_done} of ${task.subtasks_total} subtasks done`;
  el.innerHTML = '<svg viewBox="0 0 16 16"><path d="M5 4h8M5 8h8M5 12h8M2 4h.01M2 8h.01M2 12h.01"/></svg>';
  el.append(`${task.subtasks_done}/${task.subtasks_total}`);
  return el;
}

// ---------- Detail panel: priority ----------

function fillDetailExtras(task) {
  document.getElementById('detail-priority').value = task.priority || '';
  renderDetailTags(task);
}

document.getElementById('detail-priority').addEventListener('change', (e) => {
  const task = openTask();
  if (task) updateTask(task, { priority: e.target.value });
});

// ---------- Detail panel: tags ----------

function renderDetailTags(task) {
  const box = $('detail-tags');
  box.innerHTML = '';
  for (const tag of taskTags(task)) {
    box.append(tagPill(tag, () => setTaskTags(task.tag_ids.filter((id) => id !== tag.id))));
  }
  const add = make('button', 'add-tag-btn', '+ Add tag');
  add.type = 'button';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    openTagPicker();
  });
  box.append(add);
}

function setTaskTags(tagIds) {
  const task = openTask();
  if (!task) return;
  const old = task.tag_ids;
  task.tag_ids = tagIds; // show it right away, then save
  render();
  renderDetailTags(task);
  updateTask(task, { tag_ids: tagIds }).catch(() => {
    task.tag_ids = old;
    render();
    renderDetailTags(task);
  });
}

function closeTagPicker() {
  document.querySelector('.tag-picker')?.remove();
}

// Search box + list of tags. Picking one adds it; typing a new name creates it.
function openTagPicker() {
  closeTagPicker();
  const task = openTask();
  if (!task) return;

  const picker = make('div', 'tag-picker');
  const input = make('input');
  input.placeholder = 'Find or create a tag';
  input.maxLength = 40;
  const list = make('ul', 'tag-options');
  picker.append(input, list);
  picker.addEventListener('click', (e) => e.stopPropagation());
  $('detail-tags').append(picker);
  input.focus();

  const query = () => input.value.trim();
  const exact = () => state.tags.find((t) => t.name.toLowerCase() === query().toLowerCase());

  function draw() {
    list.innerHTML = '';
    const q = query().toLowerCase();
    for (const tag of state.tags.filter((t) => t.name.toLowerCase().includes(q))) {
      const on = task.tag_ids.includes(tag.id);
      const li = make('li', 'tag-option' + (on ? ' on' : ''));
      const tick = make('span', 'tag-tick', on ? '✓' : '');
      li.append(tick, tagPill(tag));
      // Only the person who made a tag can delete it (teammates' tags can only be used)
      if (tag.user_id === state.user.id) {
        const del = make('button', 'icon-btn tag-delete', '×');
        del.type = 'button';
        del.title = 'Delete this tag from every task';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteTag(tag);
        });
        li.append(del);
      }
      li.addEventListener('click', () => toggleTag(tag));
      list.append(li);
    }
    if (q && !exact()) {
      const create = make('li', 'tag-option create', `Create tag "${query()}"`);
      create.addEventListener('click', createTag);
      list.append(create);
    }
    if (!list.children.length) list.append(make('li', 'tag-empty', 'Type a name to create your first tag'));
  }

  function toggleTag(tag) {
    const ids = task.tag_ids.includes(tag.id)
      ? task.tag_ids.filter((id) => id !== tag.id)
      : [...task.tag_ids, tag.id];
    setTaskTags(ids); // redraws the tag box, which closes the picker
  }

  async function createTag() {
    const name = query();
    if (!name) return;
    const tag = await api('/api/tags', { method: 'POST', body: { name } });
    if (!state.tags.some((t) => t.id === tag.id)) {
      state.tags.push(tag);
      state.tags.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (!task.tag_ids.includes(tag.id)) setTaskTags([...task.tag_ids, tag.id]);
    else closeTagPicker();
  }

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // close only the picker, not the whole panel
      closeTagPicker();
    } else if (e.key === 'Enter') {
      // Enter picks the exact match, else the first match, else creates a new tag
      e.preventDefault();
      const q = query().toLowerCase();
      if (!q) return;
      const match = exact() || state.tags.find((t) => t.name.toLowerCase().includes(q));
      if (match) toggleTag(match);
      else createTag();
    }
  });
  draw();
}

async function deleteTag(tag) {
  const sure = await confirmDialog({
    title: 'Delete this tag?',
    message: `"${tag.name}" will be removed from every task that has it.`,
    confirmText: 'Delete tag',
  });
  if (!sure) return;
  await api(`/api/tags/${tag.id}`, { method: 'DELETE' });
  toast(`Deleted tag "${tag.name}"`);
  state.tags = state.tags.filter((t) => t.id !== tag.id);
  for (const t of state.tasks) t.tag_ids = t.tag_ids.filter((id) => id !== tag.id);
  render();
  const task = openTask();
  if (task) renderDetailTags(task);
}

// Clicking anywhere else closes the tag picker
document.addEventListener('click', closeTagPicker);

// ---------- Detail panel: subtasks ----------

async function loadSubtasks(taskId) {
  // Clear the old list without touching the task's counts while loading
  state.subtasks = [];
  $('subtask-list').innerHTML = '';
  $('subtask-progress').textContent = '';
  const subtasks = await api(`/api/tasks/${taskId}/subtasks`);
  if (state.openTaskId !== taskId) return; // another task was opened meanwhile
  state.subtasks = subtasks;
  renderSubtasks();
}

function renderSubtasks() {
  const list = $('subtask-list');
  list.innerHTML = '';
  for (const sub of state.subtasks) list.append(buildSubtask(sub));
  updateSubtaskProgress();
}

function buildSubtask(sub) {
  const li = make('li', 'subtask' + (sub.completed ? ' done' : ''));

  const check = make('button', 'check small');
  check.type = 'button';
  check.title = 'Mark complete';
  check.innerHTML = CHECK_SVG;
  check.addEventListener('click', async () => {
    sub.completed = sub.completed ? 0 : 1;
    li.classList.toggle('done', !!sub.completed);
    check.classList.toggle('pop', !!sub.completed);
    updateSubtaskProgress();
    try {
      await api(`/api/subtasks/${sub.id}`, { method: 'PATCH', body: { completed: !!sub.completed } });
    } catch {
      sub.completed = sub.completed ? 0 : 1; // undo
      li.classList.toggle('done', !!sub.completed);
      updateSubtaskProgress();
    }
  });

  const title = make('input', 'subtask-title');
  title.value = sub.title;
  title.maxLength = 200;
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
  });
  title.addEventListener('blur', async () => {
    const value = title.value.trim();
    if (!value) { title.value = sub.title; return; }
    if (value === sub.title) return;
    try {
      const updated = await api(`/api/subtasks/${sub.id}`, { method: 'PATCH', body: { title: value } });
      sub.title = updated.title;
    } catch {
      title.value = sub.title;
    }
  });

  const del = make('button', 'icon-btn subtask-delete', '×');
  del.type = 'button';
  del.title = 'Delete subtask';
  del.addEventListener('click', async () => {
    await api(`/api/subtasks/${sub.id}`, { method: 'DELETE' });
    state.subtasks = state.subtasks.filter((s) => s.id !== sub.id);
    li.remove();
    updateSubtaskProgress();
  });

  li.append(check, title, del);
  return li;
}

// Update the "2/5" next to the heading, and the counts shown on the task in the views
function updateSubtaskProgress() {
  const total = state.subtasks.length;
  const done = state.subtasks.filter((s) => s.completed).length;
  $('subtask-progress').textContent = total ? `${done}/${total}` : '';

  const task = openTask();
  if (task && (task.subtasks_total !== total || task.subtasks_done !== done)) {
    task.subtasks_total = total;
    task.subtasks_done = done;
    render();
  }
}

document.getElementById('new-subtask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.title;
  const title = input.value.trim();
  if (!title) return;
  const taskId = state.openTaskId;
  input.value = ''; // clear right away so the next one can be typed
  let sub;
  try {
    sub = await api(`/api/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } });
  } catch {
    if (!input.value) input.value = title;
    return;
  }
  if (state.openTaskId !== taskId) return;
  state.subtasks.push(sub);
  $('subtask-list').append(buildSubtask(sub));
  updateSubtaskProgress();
});
