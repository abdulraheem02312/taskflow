// Forgot password and reset password pages

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------- /forgot-password ----------

const forgotForm = document.getElementById('forgot-form');
if (forgotForm) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = document.getElementById('form-error');
    const button = forgotForm.querySelector('button');
    const email = forgotForm.elements.email.value.trim();
    error.textContent = '';
    button.disabled = true;
    try {
      await post('/api/password/forgot', { email });
      document.getElementById('sent-to').textContent = email;
      document.getElementById('forgot-step').hidden = true;
      document.getElementById('forgot-done').hidden = false;
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  });
}

// ---------- /reset-password?token=... ----------

const resetForm = document.getElementById('reset-form');
if (resetForm) {
  const token = new URLSearchParams(location.search).get('token') || '';
  bindStrengthMeter(resetForm.elements.password, document.getElementById('reset-meter'));

  const showInvalid = () => {
    document.getElementById('reset-step').hidden = true;
    document.getElementById('reset-invalid').hidden = false;
  };

  // Check the link first, so an expired one says so before you type anything
  fetch(`/api/password/reset?token=${encodeURIComponent(token)}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.valid) return showInvalid();
      document.getElementById('reset-intro').textContent = `For ${data.email}. Use at least 8 characters.`;
      resetForm.hidden = false;
      resetForm.elements.password.focus();
    })
    .catch(showInvalid);

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = document.getElementById('form-error');
    const { password, repeat } = resetForm.elements;
    error.textContent = '';
    if (password.value !== repeat.value) {
      error.textContent = 'The two passwords are not the same';
      repeat.focus();
      return;
    }
    const button = resetForm.querySelector('button');
    button.disabled = true;
    try {
      await post('/api/password/reset', { token, password: password.value });
      window.location.href = '/app'; // the server already logged you in
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  });
}
