// Small UI helpers used instead of the browser's alert() and confirm():
// toast() shows a short message at the bottom, confirmDialog() asks a yes/no question.

function toast(message, type = 'info') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  const text = document.createElement('span');
  text.textContent = message;
  el.append(dot, text);
  stack.append(el);

  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3200);
}

// A glass dialog with a title and close button. Escape (only when it is on top),
// a click outside, or close() shut it, and focus goes back where it was.
// Returns { modal, body, close } so the caller can fill in the body.
function openModal({ title, className = '' }) {
  const opener = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = `modal ${className}`;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const head = document.createElement('div');
  head.className = 'modal-head';
  const heading = document.createElement('h3');
  heading.id = `modal-${Date.now()}`;
  heading.textContent = title;
  modal.setAttribute('aria-labelledby', heading.id);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Close';
  closeBtn.textContent = '×';
  head.append(heading, closeBtn);

  const body = document.createElement('div');
  modal.append(head, body);
  backdrop.append(modal);
  document.body.append(backdrop);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-backdrop');
    if (open[open.length - 1] !== backdrop) return; // a dialog on top of this one handles it
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  modal.addEventListener('click', (e) => e.stopPropagation());
  return { modal, body, close };
}

// Rough password strength: 0 (empty) to 4 (strong)
function passwordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return password.length < 8 ? 1 : Math.max(1, score);
}

// Colored bar + label under a new-password box
function bindStrengthMeter(input, meter) {
  const labels = ['', 'Too short or weak', 'Okay', 'Good', 'Strong'];
  const update = () => {
    const score = passwordStrength(input.value);
    meter.dataset.score = String(score);
    meter.querySelector('.meter-label').textContent = labels[score];
  };
  input.addEventListener('input', update);
  update();
}

// Resolves to true (confirmed) or false (cancelled, Escape, or click outside)
function confirmDialog({ title, message, confirmText = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');

    const heading = document.createElement('h3');
    heading.id = 'modal-title';
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    ok.textContent = confirmText;
    actions.append(cancel, ok);

    modal.append(heading, text, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    ok.focus();

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previousFocus?.focus?.();
      resolve(result);
    }
    // Capture phase, so Escape here doesn't also close the task panel behind it
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Tab') {
        // Keep keyboard focus inside the dialog
        e.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false); });
    modal.addEventListener('click', (e) => e.stopPropagation()); // don't trigger "click outside" closers
  });
}
