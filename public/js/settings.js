// Settings page (profile, password, security, delete account) and the Project settings dialog.
// Loaded before app.js. Uses state, $, make, api, render, navigate, toast, openModal,
// bindStrengthMeter, avatar, initialsOf and showPage from the other files
// (only inside functions, so the load order is safe).

// ---------- Settings page ----------

async function showSettings() {
  showPage('settings');
  state.projectId = null;
  document.title = 'Settings | Taskflow';
  renderSettings();
  const me = await api('/api/me');
  if (state.page !== 'settings') return;
  Object.assign(state.user, me);
  renderSettings();
}

function renderSettings() {
  const user = state.user;
  if (!user) return;

  // Profile
  $('settings-avatar').replaceChildren(avatar(user, 'lg'));
  $('settings-name-preview').textContent = user.name;
  $('settings-since').textContent = user.created_at
    ? `Member since ${new Date(user.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`
    : '';
  const form = $('profile-form');
  if (document.activeElement !== form.elements.name) form.elements.name.value = user.name;
  $('settings-email').value = user.email;

  // Appearance
  const pref = themePreference();
  for (const radio of document.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === pref;

  // Password: Google-only accounts set one instead of changing it
  const hasPassword = user.has_password !== false;
  $('password-title').textContent = hasPassword ? 'Change password' : 'Set a password';
  $('password-intro').textContent = hasPassword
    ? 'Other devices are logged out when you change it. This one stays logged in.'
    : 'You sign in with Google. Add a password to also log in with your email.';
  $('current-password-field').hidden = !hasPassword;
  $('password-form').elements.current.required = hasPassword;
  $('password-submit').textContent = hasPassword ? 'Update password' : 'Set password';

  // Security
  $('google-status').textContent = user.google ? 'Connected' : 'Not connected';
  $('google-status').classList.toggle('on', !!user.google);
  $('google-desc').textContent = user.google
    ? 'You can log in with "Continue with Google".'
    : 'Use "Continue with Google" on the login page with this email to connect it.';
}

// Theme picker: switches right away (and is remembered on this device)
for (const radio of document.querySelectorAll('input[name="theme"]')) {
  radio.addEventListener('change', () => { if (radio.checked) setThemePreference(radio.value); });
}

// Keep the top bar avatar in step after a rename (the account menu reads state.user when it opens)
function updateUserChip() {
  $('user-avatar').textContent = initialsOf(state.user.name);
  $('user-btn').title = `${state.user.name} (account)`;
}

const profileForm = document.getElementById('profile-form');
profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = profileForm.elements.name.value.trim();
  if (!name || name === state.user.name) return;
  const updated = await api('/api/me', { method: 'PATCH', body: { name } });
  state.user.name = updated.name;
  updateUserChip();
  renderSettings();
  toast('Profile saved');
});
// Live preview of the name and initials while typing
profileForm.elements.name.addEventListener('input', () => {
  const name = profileForm.elements.name.value.trim() || state.user.name;
  document.getElementById('settings-name-preview').textContent = name;
  document.getElementById('settings-avatar').replaceChildren(avatar({ id: state.user.id, name }, 'lg'));
});

const passwordForm = document.getElementById('password-form');
bindStrengthMeter(passwordForm.elements.password, document.getElementById('settings-meter'));

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { current, password, repeat } = passwordForm.elements;
  const error = document.getElementById('password-error');
  error.textContent = '';
  if (password.value !== repeat.value) {
    error.textContent = 'The two new passwords are not the same';
    repeat.focus();
    return;
  }
  const result = await api('/api/me/password', { method: 'POST', body: { current: current.value, password: password.value } });
  const wasSet = state.user.has_password === false;
  state.user.has_password = true;
  passwordForm.reset();
  password.dispatchEvent(new Event('input')); // reset the strength meter
  renderSettings();
  const others = result.signedOut ? ` and logged out of ${result.signedOut} other device${result.signedOut === 1 ? '' : 's'}` : '';
  toast(wasSet ? `Password set${others}` : `Password updated${others}`);
});

document.getElementById('logout-others').addEventListener('click', async () => {
  const { signedOut } = await api('/api/me/logout-others', { method: 'POST', body: {} });
  toast(signedOut ? `Logged out of ${signedOut} other device${signedOut === 1 ? '' : 's'}` : 'No other devices were logged in');
});

// Deleting the account: you type your email to make sure it's on purpose
document.getElementById('delete-account').addEventListener('click', () => {
  const { body, close } = openModal({ title: 'Delete your account?', className: 'danger-modal' });
  const text = make('p', '', 'Your account and every project you own will be deleted for everyone in them. This cannot be undone.');
  const label = make('label', 'field');
  label.append(`Type ${state.user.email} to confirm`);
  const input = make('input');
  input.type = 'email';
  input.autocomplete = 'off';
  label.append(input);
  const actions = make('div', 'modal-actions');
  const cancel = make('button', 'btn btn-ghost', 'Cancel');
  cancel.type = 'button';
  const confirm = make('button', 'btn btn-danger', 'Delete forever');
  confirm.type = 'button';
  confirm.disabled = true;
  actions.append(cancel, confirm);
  body.append(text, label, actions);
  input.focus();

  input.addEventListener('input', () => {
    confirm.disabled = input.value.trim().toLowerCase() !== state.user.email;
  });
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await api('/api/me', { method: 'DELETE', body: { confirm: input.value } });
      window.location.href = '/';
    } catch {
      confirm.disabled = false;
    }
  });
});

// ---------- Project settings (owner only) ----------

document.getElementById('project-settings-btn').addEventListener('click', () => {
  const project = currentProject();
  if (!project) return;
  const { body, close } = openModal({ title: 'Project settings', className: 'project-settings' });

  const form = make('form', 'settings-form');
  const nameField = make('label', 'field');
  nameField.append('Name');
  const name = make('input');
  name.maxLength = 80;
  name.required = true;
  name.value = project.name;
  nameField.append(name);

  // Color swatches (radio buttons, so keyboard and screen readers work)
  const colorField = make('fieldset', 'field swatches');
  colorField.append(make('legend', '', 'Color'));
  for (const color of ACCENTS) {
    const option = make('label', 'swatch');
    option.style.setProperty('--c', color);
    option.title = color;
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'color';
    radio.value = color;
    radio.checked = color.toLowerCase() === project.color.toLowerCase();
    radio.setAttribute('aria-label', `Color ${color}`);
    option.append(radio);
    colorField.append(option);
  }

  const actions = make('div', 'modal-actions');
  const save = make('button', 'btn btn-primary', 'Save');
  save.type = 'submit';
  actions.append(save);
  form.append(nameField, colorField, actions);

  const danger = make('div', 'modal-danger');
  const dangerText = make('div');
  dangerText.append(make('strong', '', 'Delete this project'), make('span', '', 'All of its tasks are deleted for everyone.'));
  const del = make('button', 'btn btn-ghost danger', 'Delete project');
  del.type = 'button';
  danger.append(dangerText, del);

  body.append(form, danger);
  name.focus();
  name.select();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const color = form.elements.color.value || project.color;
    const updated = await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: name.value.trim(), color } });
    Object.assign(project, { name: updated.name, color: updated.color });
    $('project-title').textContent = project.name;
    $('project-color').style.background = project.color;
    $('project-color').textContent = projectInitial(project);
    document.title = `${project.name} | Taskflow`;
    renderProjects();
    state.boardDirty = true;
    render();
    close();
    toast('Project saved');
  });

  del.addEventListener('click', () => {
    close();
    deleteCurrentProject();
  });
});
