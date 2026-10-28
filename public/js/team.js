// Teams: avatars, the Share dialog (members and invites), task assignee, comments and the Inbox.
// Loaded before app.js. Uses state, $, make, api, render, navigate, toast, confirmDialog,
// openTask, updateTask, refreshCounts and showPage from the other files
// (only inside functions, so the load order is safe).

// ---------- Avatars and small helpers ----------

const AVATAR_COLORS = ['#a78bfa', '#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#2dd4bf', '#fb923c', '#f87171'];

function initialsOf(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

// Round avatar with initials; each person always gets the same color
function avatar(user, size = 'sm') {
  const el = make('span', `avatar avatar-${size}`, initialsOf(user.name));
  el.style.background = AVATAR_COLORS[(user.id || 0) % AVATAR_COLORS.length];
  el.title = user.name || '';
  return el;
}

// SQLite gives "2026-10-18 14:05:00" in UTC; turn it into "5m ago", "yesterday", "Oct 12"
function parseServerDate(value) {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function timeAgo(value) {
  const date = parseServerDate(value);
  const seconds = (Date.now() - date) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Speech-bubble count shown on rows and cards when a task has comments
function commentCount(task) {
  if (!task.comment_count) return null;
  const el = make('span', 'comment-count');
  el.title = `${task.comment_count} comment${task.comment_count === 1 ? '' : 's'}`;
  el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 13.5V11A1.5 1.5 0 0 1 3 9.5z"/></svg>';
  el.append(String(task.comment_count));
  return el;
}

function assigneeAvatar(task) {
  return task.assignee_id ? avatar({ id: task.assignee_id, name: task.assignee_name }) : null;
}

// ---------- Members ----------

const membersCache = new Map(); // projectId -> { members, invites, role }

async function loadMembers(projectId, { fresh = false } = {}) {
  if (!fresh && membersCache.has(projectId)) return membersCache.get(projectId);
  const data = await api(`/api/projects/${projectId}/members`);
  membersCache.set(projectId, data);
  return data;
}

// Project header: member avatars, and controls only the owner may use
async function renderProjectTeam(project) {
  const owner = project.role === 'owner';
  $('project-settings-btn').hidden = !owner;
  $('project-title').contentEditable = owner ? 'true' : 'false';
  $('project-title').title = owner ? 'Click to rename' : '';

  const stack = $('member-stack');
  const data = await loadMembers(project.id, { fresh: true });
  if (state.projectId !== project.id) return;
  stack.replaceChildren();
  for (const member of data.members.slice(0, 4)) stack.append(avatar(member));
  if (data.members.length > 4) stack.append(make('span', 'avatar avatar-sm more', `+${data.members.length - 4}`));
  stack.title = data.members.map((m) => m.name).join(', ');
  stack.hidden = data.members.length < 2; // only worth showing once the project is shared
}

document.getElementById('share-btn').addEventListener('click', () => openShareDialog());
document.getElementById('member-stack').addEventListener('click', () => openShareDialog());

// ---------- Share dialog ----------

function openShareDialog() {
  const project = currentProject();
  if (!project) return;
  const opener = document.activeElement;

  const backdrop = make('div', 'modal-backdrop');
  const modal = make('div', 'modal share-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'share-title');

  const head = make('div', 'share-head');
  const title = make('h3', '', `Share "${project.name}"`);
  title.id = 'share-title';
  const closeBtn = make('button', 'icon-btn', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  head.append(title, closeBtn);

  const form = make('form', 'invite-form');
  const input = make('input');
  input.type = 'email';
  input.required = true;
  input.autocomplete = 'off';
  input.placeholder = "Teammate's email";
  input.setAttribute('aria-label', "Teammate's email");
  const submit = make('button', 'btn btn-primary', 'Invite');
  submit.type = 'submit';
  form.append(input, submit);

  const note = make('p', 'share-note',
    'People who already use Taskflow join right away. Anyone else joins as soon as they sign up with that email. '
    + 'No email is sent, so send them the link yourself.');
  const body = make('div', 'share-body');

  modal.append(head, form, note, body);
  backdrop.append(modal);
  document.body.append(backdrop);
  input.focus();

  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  }
  // Escape closes this dialog, unless a confirm dialog is open on top of it
  function onKey(e) {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-backdrop');
    if (open[open.length - 1] !== backdrop) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  modal.addEventListener('click', (e) => e.stopPropagation());

  async function refreshAll() {
    await draw();
    renderProjectTeam(project);
    refreshCounts();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    submit.disabled = true;
    try {
      const result = await api(`/api/projects/${project.id}/members`, { method: 'POST', body: { email } });
      toast(result.added ? `${result.added.name} joined the project` : `Invite saved for ${email}`);
      input.value = '';
      await refreshAll();
    } catch {
      // api() already showed the error
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });

  async function draw() {
    const data = await loadMembers(project.id, { fresh: true });
    body.replaceChildren();

    body.append(make('div', 'share-label', `Members · ${data.members.length}`));
    const list = make('ul', 'member-list');
    for (const member of data.members) {
      const li = make('li', 'member-row');
      const info = make('div', 'member-info');
      const isMe = member.id === state.user.id;
      info.append(make('span', 'member-name', isMe ? `${member.name} (you)` : member.name), make('span', 'member-email', member.email));
      li.append(avatar(member, 'md'), info);

      if (member.role === 'owner') {
        li.append(make('span', 'role-badge', 'Owner'));
      } else if (isMe) {
        const leave = make('button', 'btn btn-ghost danger', 'Leave');
        leave.type = 'button';
        leave.addEventListener('click', () => { close(); leaveProject(project); });
        li.append(leave);
      } else if (data.role === 'owner') {
        const remove = make('button', 'btn btn-ghost danger', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          const sure = await confirmDialog({
            title: `Remove ${member.name}?`,
            message: 'They lose access to this project, and their tasks here become unassigned.',
            confirmText: 'Remove',
          });
          if (!sure) return;
          await api(`/api/projects/${project.id}/members/${member.id}`, { method: 'DELETE' });
          toast(`${member.name} was removed`);
          await refreshAll();
        });
        li.append(remove);
      } else {
        li.append(make('span', 'role-badge muted', 'Member'));
      }
      list.append(li);
    }
    body.append(list);

    if (data.invites.length) {
      body.append(make('div', 'share-label', `Waiting to sign up · ${data.invites.length}`));
      const invites = make('ul', 'member-list');
      for (const invite of data.invites) {
        const li = make('li', 'member-row');
        const info = make('div', 'member-info');
        info.append(make('span', 'member-name', invite.email), make('span', 'member-email', `Invited ${timeAgo(invite.created_at)}`));
        const cancel = make('button', 'icon-btn', '×');
        cancel.type = 'button';
        cancel.title = 'Cancel invite';
        cancel.addEventListener('click', async () => {
          await api(`/api/projects/${project.id}/invites/${invite.id}`, { method: 'DELETE' });
          toast('Invite cancelled');
          await draw();
        });
        li.append(make('span', 'avatar avatar-md invite', '@'), info, cancel);
        invites.append(li);
      }
      body.append(invites);
    }
  }
  draw();
}

async function leaveProject(project) {
  const sure = await confirmDialog({
    title: `Leave "${project.name}"?`,
    message: 'You lose access to its tasks. Someone in the project has to invite you again to come back.',
    confirmText: 'Leave project',
  });
  if (!sure) return;
  await api(`/api/projects/${project.id}/members/${state.user.id}`, { method: 'DELETE' });
  toast(`You left "${project.name}"`);
  state.projects = state.projects.filter((p) => p.id !== project.id);
  membersCache.delete(project.id);
  navigate('/app');
}

// ---------- Assignee (task panel) ----------

async function fillAssignee(task) {
  const select = $('detail-assignee');
  const show = (data) => {
    if (state.openTaskId !== task.id) return; // another task was opened meanwhile
    select.replaceChildren(new Option('Unassigned', ''));
    for (const m of data.members) select.append(new Option(m.id === state.user.id ? `${m.name} (you)` : m.name, m.id));
    select.value = task.assignee_id ? String(task.assignee_id) : '';
    $('assignee-avatar').replaceChildren(assigneeAvatar(task) || make('span', 'avatar avatar-sm empty', '?'));
  };
  const cached = membersCache.get(task.project_id);
  if (cached) return show(cached);
  select.replaceChildren(new Option(task.assignee_name || 'Unassigned', task.assignee_id || ''));
  show(await loadMembers(task.project_id));
}

document.getElementById('detail-assignee').addEventListener('change', async (e) => {
  const task = openTask();
  if (!task) return;
  const assigneeId = e.target.value ? Number(e.target.value) : null;
  await updateTask(task, { assignee_id: assigneeId });
  if (assigneeId && assigneeId !== state.user.id) toast(`Assigned to ${task.assignee_name}`);
  refreshCounts();
});

// ---------- Comments (task panel) ----------

async function loadComments(taskId) {
  $('comment-list').replaceChildren();
  $('comment-total').textContent = '';
  const comments = await api(`/api/tasks/${taskId}/comments`);
  if (state.openTaskId !== taskId) return;
  for (const comment of comments) $('comment-list').append(buildComment(comment));
  $('comment-total').textContent = comments.length || '';
  // Which comments I already liked
  if (comments.length) {
    const likes = await api(`/api/likes?kind=comment&ids=${comments.map((c) => c.id).join(',')}`);
    for (const btn of $('comment-list').querySelectorAll('.comment-like')) {
      const l = likes[btn.dataset.commentId];
      if (l) showLike(btn, btn.lastChild, l);
    }
  }
}

function buildComment(comment) {
  const li = make('li', 'comment');
  const main = make('div', 'comment-main');
  const meta = make('div', 'comment-meta');
  const time = make('span', 'comment-time', timeAgo(comment.created_at));
  time.title = parseServerDate(comment.created_at).toLocaleString();
  meta.append(make('span', 'comment-author', comment.user_name), time);

  if (comment.user_id === state.user.id) {
    const del = make('button', 'icon-btn comment-delete', '×');
    del.type = 'button';
    del.title = 'Delete comment';
    del.addEventListener('click', async () => {
      await api(`/api/comments/${comment.id}`, { method: 'DELETE' });
      li.remove();
      changeCommentCount(comment.task_id, -1);
    });
    meta.append(del);
  }
  // @mentions stand out; a like button sits under the comment
  const text = make('p', 'comment-body');
  for (const part of comment.body.split(/(@[\p{L}\p{N}_]+(?: [\p{Lu}][\p{L}]+)?)/u)) {
    text.append(part.startsWith('@') ? make('span', 'mention', part) : part);
  }
  const like = make('button', 'comment-like', '♥ ');
  like.type = 'button';
  like.title = 'Like';
  const likeCount = make('span', '', comment.like_count || '');
  like.append(likeCount);
  like.dataset.commentId = comment.id;
  like.addEventListener('click', async () => {
    const data = await api('/api/likes', { method: 'POST', body: { kind: 'comment', id: comment.id } });
    showLike(like, likeCount, data);
  });
  main.append(meta, text, like);
  li.append(avatar({ id: comment.user_id, name: comment.user_name }, 'md'), main);
  return li;
}

// Keep the count in the panel and the speech bubble on rows and cards in step
function changeCommentCount(taskId, delta) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (task) task.comment_count = Math.max(0, (task.comment_count || 0) + delta);
  $('comment-total').textContent = $('comment-list').children.length || '';
  render();
}

const commentForm = document.getElementById('comment-form');

commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = commentForm.elements.body;
  const body = box.value.trim();
  const taskId = state.openTaskId;
  if (!body || !taskId) return;
  box.value = ''; // clear right away so the next comment can be typed
  let comment;
  try {
    comment = await api(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { body } });
  } catch {
    if (!box.value) box.value = body;
    return;
  }
  if (state.openTaskId !== taskId) return;
  const list = $('comment-list');
  list.append(buildComment(comment));
  list.lastElementChild.scrollIntoView({ block: 'nearest' });
  changeCommentCount(taskId, +1);
});

// Ctrl+Enter (Cmd+Enter on Mac) sends
commentForm.elements.body.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    commentForm.requestSubmit();
  }
});

// Unread badge in the sidebar: checked on start, every 30 seconds, and when you come back to the tab
async function refreshUnread() {
  try {
    const { count } = await api('/api/inbox/unread');
    const badge = $('inbox-count');
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
  } catch {
    // offline for a moment; try again next time
  }
}
setInterval(refreshUnread, 30000);
window.addEventListener('focus', refreshUnread);
