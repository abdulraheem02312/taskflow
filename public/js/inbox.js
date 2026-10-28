// Inbox: notifications in tabs (Activity, @Mentioned, Bookmarks, Archive), grouped by
// day, with "Unread only" and per-item read / bookmark / archive buttons.
// Loaded before app.js. Uses state, $, make, api, navigate, showPage, avatar, timeAgo,
// parseServerDate, toast and refreshUnread from the other files (only inside functions).

const INBOX_VERBS = {
  added: ' added you to ', assigned: ' assigned you ', comment: ' commented on ', completed: ' completed ',
  attached: ' attached a file to ', status: ' posted a status update on ', form: ' sent a form request: ', mention: ' mentioned you on ',
};
const INBOX_ICONS = { added: '＋', assigned: '◉', comment: '💬', completed: '✓', attached: '📎', status: '◐', form: '✉', mention: '@' };
const INBOX_EMPTY = {
  activity: ['You are all caught up', 'When teammates add you to a project, assign you a task or comment on your work, it shows up here.'],
  mentions: ['No mentions yet', 'When someone writes @your name in a comment, you will find it here.'],
  bookmarks: ['No bookmarks', 'Bookmark a notification with ☆ to keep it handy here.'],
  archive: ['Archive is empty', 'Archived notifications move here. Archive one with the box button, or everything with "Archive all".'],
};

const inbox = { tab: 'activity', unreadOnly: false, items: [] };

async function showInbox() {
  showPage('inbox');
  state.projectId = null;
  document.title = 'Inbox | Taskflow';
  renderInbox();
  await loadInbox();
}

async function loadInbox() {
  const tab = inbox.tab;
  const items = await api(`/api/inbox?tab=${tab}`);
  if (state.page !== 'inbox' || tab !== inbox.tab) return;
  inbox.items = items;
  renderInbox();
}

// Today / Yesterday / This week / Earlier
function dayGroup(value) {
  const d = parseServerDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

function renderInbox() {
  for (const btn of document.querySelectorAll('#inbox-tabs .inbox-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === inbox.tab);
    btn.setAttribute('aria-current', btn.dataset.tab === inbox.tab ? 'page' : 'false');
  }
  const unread = inbox.items.filter((n) => !n.read_at).length;
  $('inbox-sub').textContent = inbox.tab === 'archive' ? `${inbox.items.length} archived`
    : unread ? `${unread} unread` : 'You are all caught up';
  $('mark-all-read').hidden = !unread || inbox.tab === 'archive';
  $('archive-all').hidden = inbox.tab !== 'activity' || !inbox.items.length;

  const list = $('inbox-list');
  const shown = inbox.unreadOnly ? inbox.items.filter((n) => !n.read_at) : inbox.items;
  if (!shown.length) {
    const [title, text] = inbox.unreadOnly && inbox.items.length ? ['No unread notifications', 'Turn off "Unread only" to see everything.'] : INBOX_EMPTY[inbox.tab];
    const empty = make('div', 'page-empty');
    empty.append(make('div', 'page-empty-icon', inbox.tab === 'archive' ? '▤' : '✓'), make('h2', '', title), make('p', '', text));
    list.replaceChildren(empty);
    return;
  }
  const groups = new Map();
  for (const n of shown) {
    const g = dayGroup(n.created_at);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }
  list.replaceChildren(...[...groups].map(([name, items]) => {
    const card = make('section', 'widget inbox-group');
    card.append(make('h2', 'inbox-day', name));
    const ul = make('ul', 'inbox-items');
    for (const n of items) ul.append(buildNotification(n));
    card.append(ul);
    return card;
  }));
}

function buildNotification(n) {
  const li = make('li', 'inbox-item' + (n.read_at ? '' : ' unread'));
  li.tabIndex = 0;
  li.setAttribute('role', 'link');

  const face = make('div', 'inbox-face');
  face.append(avatar({ id: n.actor_id || 0, name: n.actor_name || '?' }, 'md'), make('span', `inbox-kind kind-${n.type}`, INBOX_ICONS[n.type] || '•'));

  const text = make('div', 'inbox-text');
  const line = make('div', 'inbox-line');
  const target = n.type === 'added' || n.type === 'status' ? n.project_name : (n.task_title || 'a task');
  const targetEl = make('strong', n.task_completed ? 'inbox-done' : '', target || 'a project');
  line.append(make('strong', '', n.actor_name || 'Someone'), INBOX_VERBS[n.type] || ' updated ', targetEl);
  text.append(line);
  if (n.body) text.append(make('p', 'inbox-quote', n.body));
  const meta = make('div', 'inbox-meta');
  if (n.project_name && n.type !== 'added') {
    const chip = make('span', 'project-chip');
    const dot = make('span', 'project-dot');
    dot.style.background = n.project_color;
    chip.append(dot, make('span', 'project-chip-name', n.project_name));
    meta.append(chip);
  }
  const when = make('span', '', timeAgo(n.created_at));
  when.title = parseServerDate(n.created_at).toLocaleString();
  meta.append(when);
  text.append(meta);

  // Hover actions: read / unread, bookmark, archive / back to inbox
  const actions = make('div', 'inbox-actions');
  const act = (label, icon, on, change) => {
    const b = make('button', 'icon-btn inbox-act' + (on ? ' on' : ''), icon);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const saved = await api(`/api/inbox/${n.id}`, { method: 'PATCH', body: change });
      Object.assign(n, saved);
      // Leaves the current tab? Take it out of the list
      if ((inbox.tab === 'archive' && !n.archived_at) || (inbox.tab !== 'archive' && inbox.tab !== 'bookmarks' && n.archived_at)
        || (inbox.tab === 'bookmarks' && !n.bookmarked)) {
        inbox.items = inbox.items.filter((x) => x !== n);
        if (change.archived) toast('Archived');
      }
      renderInbox();
      refreshUnread();
    });
    return b;
  };
  actions.append(
    act(n.read_at ? 'Mark as unread' : 'Mark as read', n.read_at ? '○' : '●', !n.read_at, { read: !n.read_at }),
    act(n.bookmarked ? 'Remove bookmark' : 'Bookmark', n.bookmarked ? '★' : '☆', !!n.bookmarked, { bookmarked: !n.bookmarked }),
    act(n.archived_at ? 'Move back to inbox' : 'Archive', n.archived_at ? '↩' : '▤', false, { archived: !n.archived_at }),
  );

  li.append(face, text, actions);
  if (!n.read_at) li.append(make('span', 'unread-dot'));

  const open = () => {
    if (!n.read_at) {
      n.read_at = 'now';
      api(`/api/inbox/${n.id}`, { method: 'PATCH', body: { read: true } }).then(refreshUnread).catch(() => {});
    }
    if (!n.project_id) return;
    navigate(n.task_id && n.type !== 'added' && n.type !== 'status'
      ? `/app/projects/${n.project_id}?task=${n.task_id}`
      : `/app/projects/${n.project_id}`);
  };
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  return li;
}

for (const btn of document.querySelectorAll('#inbox-tabs .inbox-tab')) {
  btn.addEventListener('click', () => {
    inbox.tab = btn.dataset.tab;
    inbox.items = [];
    renderInbox();
    loadInbox();
  });
}

document.getElementById('inbox-unread-only').addEventListener('change', (e) => {
  inbox.unreadOnly = e.target.checked;
  renderInbox();
});

document.getElementById('mark-all-read').addEventListener('click', async () => {
  await api('/api/inbox/read', { method: 'POST', body: {} });
  for (const n of inbox.items) n.read_at = n.read_at || 'now';
  renderInbox();
  refreshUnread();
});

document.getElementById('archive-all').addEventListener('click', async () => {
  const { archived } = await api('/api/inbox/archive-all', { method: 'POST', body: {} });
  inbox.items = [];
  renderInbox();
  refreshUnread();
  toast(`${archived} notification${archived === 1 ? '' : 's'} archived`);
});
