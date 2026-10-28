// Light / dark / system theme.
// The small script in every page's <head> already applied the saved choice before the
// first paint (so there is no flash). This file lets Settings change it, follows the
// system setting live when "System" is chosen, and keeps open tabs in step.

const THEME_COLORS = { dark: '#050505', light: '#f4f4f1' };
const systemLight = matchMedia('(prefers-color-scheme: light)');

function themePreference() {
  try {
    return localStorage.getItem('theme') || 'dark';
  } catch {
    return 'dark';
  }
}

function resolveTheme(pref) {
  if (pref === 'system') return systemLight.matches ? 'light' : 'dark';
  return pref === 'light' ? 'light' : 'dark';
}

function applyTheme(pref = themePreference()) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  document.dispatchEvent(new CustomEvent('themechange', { detail: { pref, theme } }));
}

// Save the choice and switch, with a soft cross-fade where the browser supports it
function setThemePreference(pref) {
  try { localStorage.setItem('theme', pref); } catch {}
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(() => applyTheme(pref));
  } else {
    applyTheme(pref);
  }
}

systemLight.addEventListener('change', () => { if (themePreference() === 'system') applyTheme(); });
window.addEventListener('storage', (e) => { if (e.key === 'theme') applyTheme(); }); // changed in another tab
applyTheme();

// The sun/moon button (top bar and website nav): one click flips light and dark
for (const btn of document.querySelectorAll('.theme-toggle')) {
  btn.addEventListener('click', () => {
    setThemePreference(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
}
