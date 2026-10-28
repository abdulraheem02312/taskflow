// Shared by login and signup pages
const form = document.getElementById('auth-form');
const errorBox = document.getElementById('form-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;

  try {
    const res = await fetch(form.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    window.location.href = '/app';
  } catch (err) {
    errorBox.textContent = err.message;
    button.disabled = false;
  }
});

// ---------- Continue with Google ----------
// Only shown when a Google Client ID is set in the .env file.

async function setupGoogleButton() {
  let clientId = '';
  try {
    clientId = (await fetch('/api/config').then((r) => r.json())).googleClientId;
  } catch {
    return;
  }
  if (!clientId) return;

  const box = document.getElementById('google-signin');
  box.hidden = false;

  // Google's own script draws the button and handles the Google popup
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    const holder = document.getElementById('google-button');
    google.accounts.id.initialize({ client_id: clientId, callback: onGoogleSignIn });
    // Google draws its own button; pick its dark or light style to match our theme
    const draw = () => {
      holder.replaceChildren();
      google.accounts.id.renderButton(holder, {
        theme: document.documentElement.dataset.theme === 'light' ? 'outline' : 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'center',
        width: Math.min(holder.offsetWidth, 400),
      });
    };
    draw();
    document.addEventListener('themechange', draw);
  };
  script.onerror = () => { box.hidden = true; }; // offline or blocked: just hide it
  document.head.append(script);
}

// Google calls this with a signed token proving who the user is; the server checks it
async function onGoogleSignIn(response) {
  errorBox.textContent = '';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
    window.location.href = '/app';
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

setupGoogleButton();
