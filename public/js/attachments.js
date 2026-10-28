// File attachments in the task panel: upload (browse, drag and drop, paste),
// list, image preview and delete, plus the paperclip count on rows and cards.
// Loaded before app.js. Uses state, $, make, api, render, toast, confirmDialog,
// timeAgo and parseServerDate from the other files (only inside functions,
// so the load order is safe).

const MAX_FILE_MB = 50; // Supabase free plan limit

// Paperclip count shown on rows and cards when a task has files
function attachmentCount(task) {
  if (!task.attachment_count) return null;
  const el = make('span', 'comment-count attachment-count');
  el.title = `${task.attachment_count} file${task.attachment_count === 1 ? '' : 's'}`;
  el.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 6.5l-6 6a1.75 1.75 0 0 0 2.5 2.5l6.25-6.25a3.5 3.5 0 0 0-5-5L4.75 10.25a5.25 5.25 0 0 0 7.5 7.5L17 13"/></svg>';
  el.append(String(task.attachment_count));
  return el;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fileExt(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

// Colored file badge: PDFs red, documents blue, sheets green, and so on
const FILE_COLORS = [
  [/^pdf$/, '#f87171'],
  [/^(docx?|odt|rtf|pages)$/, '#60a5fa'],
  [/^(xlsx?|csv|ods|numbers)$/, '#4ade80'],
  [/^(pptx?|odp|key)$/, '#fb923c'],
  [/^(zip|rar|7z|gz|tar)$/, '#fbbf24'],
  [/^(mp3|wav|ogg|m4a|mp4|mov|webm|avi|mkv)$/, '#f472b6'],
  [/^(js|ts|html|css|json|py|java|c|cpp|php|sql|sh|svg)$/, '#a78bfa'],
];

function fileColor(name) {
  const ext = fileExt(name);
  return (FILE_COLORS.find(([pattern]) => pattern.test(ext)) || [null, '#9ca3af'])[1];
}

function canDeleteAttachment(attachment) {
  if (attachment.user_id === state.user.id) return true;
  const task = state.tasks.find((t) => t.id === attachment.task_id);
  const project = task && state.projects.find((p) => p.id === task.project_id);
  return project?.role === 'owner';
}

// ---------- List ----------

async function loadAttachments(taskId) {
  $('attachment-list').replaceChildren();
  $('attachment-total').textContent = '';
  const attachments = await api(`/api/tasks/${taskId}/attachments`);
  if (state.openTaskId !== taskId) return;
  for (const attachment of attachments) $('attachment-list').append(buildAttachment(attachment));
  updateAttachmentTotal();
}

function buildAttachment(attachment) {
  const li = make('li', 'attachment');
  const url = `/api/attachments/${attachment.id}`;

  // Images get a small preview that opens big; other files a colored badge that downloads
  let thumb;
  let name;
  if (attachment.is_image) {
    thumb = make('button', 'attachment-thumb');
    thumb.type = 'button';
    thumb.title = 'Preview';
    const img = make('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
    name = make('button', 'attachment-name', attachment.name);
    name.type = 'button';
    for (const el of [thumb, name]) el.addEventListener('click', () => openLightbox(attachment));
  } else {
    thumb = make('a', 'attachment-thumb file-badge', (fileExt(attachment.name) || 'file').slice(0, 4).toUpperCase());
    thumb.href = `${url}?download=1`;
    thumb.tabIndex = -1; // the name link next to it does the same
    thumb.style.setProperty('--c', fileColor(attachment.name));
    name = make('a', 'attachment-name', attachment.name);
    name.href = `${url}?download=1`;
  }
  name.title = attachment.name;

  const meta = make('span', 'attachment-meta',
    `${formatSize(attachment.size)} · ${attachment.user_name || 'Former member'} · ${timeAgo(attachment.created_at)}`);
  meta.title = parseServerDate(attachment.created_at).toLocaleString();
  const info = make('div', 'attachment-info');
  info.append(name, meta);

  const actions = make('div', 'attachment-actions');
  const download = make('a', 'icon-btn');
  download.href = `${url}?download=1`;
  download.title = 'Download';
  download.setAttribute('aria-label', `Download ${attachment.name}`);
  download.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/></svg>';
  actions.append(download);

  if (canDeleteAttachment(attachment)) {
    const del = make('button', 'icon-btn attachment-delete', '×');
    del.type = 'button';
    del.title = 'Delete file';
    del.setAttribute('aria-label', `Delete ${attachment.name}`);
    del.addEventListener('click', () => deleteAttachment(attachment, li));
    actions.append(del);
  }

  li.append(thumb, info, actions);
  return li;
}

async function deleteAttachment(attachment, li) {
  const sure = await confirmDialog({
    title: 'Delete this file?',
    message: `"${attachment.name}" will be removed from this task for everyone. This can't be undone.`,
    confirmText: 'Delete file',
  });
  if (!sure) return;
  await api(`/api/attachments/${attachment.id}`, { method: 'DELETE' });
  li.remove();
  changeAttachmentCount(attachment.task_id, -1);
  toast('File deleted');
}

function updateAttachmentTotal() {
  $('attachment-total').textContent = $('attachment-list').querySelectorAll('.attachment:not(.uploading)').length || '';
}

// Keep the count in the panel and the paperclip on rows and cards in step
function changeAttachmentCount(taskId, delta) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (task) task.attachment_count = Math.max(0, (task.attachment_count || 0) + delta);
  if (state.openTaskId === taskId) updateAttachmentTotal();
  render();
}

// ---------- Upload ----------

// The file goes as the raw request body. XMLHttpRequest (not fetch) because it reports upload progress.
function sendFile(taskId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${taskId}/attachments`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) {
        window.location.href = '/login';
        return reject(new Error('Not logged in'));
      }
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'The upload failed. Try again.'));
    });
    xhr.addEventListener('error', () => reject(new Error('The upload failed. Check your connection and try again.')));
    xhr.send(file);
  });
}

// A placeholder row with a progress bar while a file uploads
function buildUploadRow(file) {
  const li = make('li', 'attachment uploading');
  const thumb = make('span', 'attachment-thumb file-badge', '...');
  thumb.style.setProperty('--c', fileColor(file.name));
  const info = make('div', 'attachment-info');
  const bar = make('span', 'upload-bar');
  const fill = make('i');
  bar.append(fill);
  info.append(make('span', 'attachment-name', file.name), bar);
  li.append(thumb, info);
  return { li, progress: (part) => { fill.style.width = `${Math.round(part * 100)}%`; } };
}

async function uploadFiles(files) {
  const taskId = state.openTaskId;
  if (!taskId) return;
  for (const file of files) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast(`"${file.name}" is bigger than ${MAX_FILE_MB} MB`, 'error');
      continue;
    }
    if (!file.size) {
      toast(`"${file.name}" is empty`, 'error');
      continue;
    }
    const row = buildUploadRow(file);
    $('attachment-list').append(row.li);
    try {
      const attachment = await sendFile(taskId, file, row.progress);
      if (state.openTaskId === taskId && row.li.isConnected) row.li.replaceWith(buildAttachment(attachment));
      changeAttachmentCount(taskId, +1);
    } catch (err) {
      row.li.remove();
      toast(err.message, 'error');
    }
  }
}

document.getElementById('attachment-input').addEventListener('change', (e) => {
  uploadFiles([...e.target.files]);
  e.target.value = ''; // so picking the same file again still works
});

// ---------- Drag and drop onto the task panel ----------

const detailPanel = document.getElementById('detail');
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

detailPanel.addEventListener('dragover', (e) => {
  if (!hasFiles(e) || !state.openTaskId) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  detailPanel.classList.add('drag-over');
});

detailPanel.addEventListener('dragleave', (e) => {
  if (!detailPanel.contains(e.relatedTarget)) detailPanel.classList.remove('drag-over');
});

detailPanel.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  detailPanel.classList.remove('drag-over');
  // Folders can't be uploaded; skip them with a hint
  const items = [...e.dataTransfer.items];
  const folders = items.filter((item) => item.webkitGetAsEntry?.()?.isDirectory).length;
  if (folders) toast('Folders can\'t be attached. Zip the folder first.', 'error');
  const files = items
    .filter((item) => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory)
    .map((item) => item.getAsFile())
    .filter(Boolean);
  uploadFiles(files);
});

// A file dropped anywhere else would make the browser leave the app to open it
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
  });
}

// ---------- Paste a screenshot ----------

document.addEventListener('paste', (e) => {
  if (!state.openTaskId) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  // Screenshots all arrive as "image.png"; give them a name that says when
  const stamp = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/[/:]/g, '.');
  uploadFiles(files.map((file) => (file.name === 'image.png'
    ? new File([file], `Screenshot ${stamp}.png`, { type: file.type })
    : file)));
});

// ---------- Image preview ----------

function openLightbox(attachment) {
  const opener = document.activeElement;
  const url = `/api/attachments/${attachment.id}`;
  const backdrop = make('div', 'modal-backdrop lightbox');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', attachment.name);

  const img = make('img', 'lightbox-img');
  img.src = url;
  img.alt = attachment.name;

  const bar = make('div', 'lightbox-bar');
  const download = make('a', 'btn btn-ghost', 'Download');
  download.href = `${url}?download=1`;
  const closeBtn = make('button', 'icon-btn', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  bar.append(make('span', 'lightbox-name', attachment.name), make('span', 'lightbox-size', formatSize(attachment.size)), download, closeBtn);

  const inner = make('div', 'lightbox-inner');
  inner.append(img, bar);
  backdrop.append(inner);
  document.body.append(backdrop);
  closeBtn.focus();

  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  }
  // Escape closes the preview only, not the task panel behind it
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target === inner) close(); });
}
