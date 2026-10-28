// Public website: nav menu, logged-in check, footer year, scroll animations

const nav = document.getElementById('site-nav');

// Stronger glass on the nav once the page is scrolled
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Phone menu
const toggle = document.getElementById('nav-toggle');
toggle.setAttribute('aria-expanded', 'false');
toggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = nav.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (nav.classList.contains('nav-open') && !nav.contains(e.target)) {
    nav.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }
});

// Card spotlight follows the mouse
for (const card of document.querySelectorAll('.glass-card')) {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

// Logged in? Show "Open app" instead of "Log in" / "Get started"
fetch('/api/me').then((res) => {
  if (!res.ok) return;
  for (const el of document.querySelectorAll('[data-guest]')) el.hidden = true;
  for (const el of document.querySelectorAll('[data-member]')) el.hidden = false;
}).catch(() => {});

document.getElementById('year').textContent = new Date().getFullYear();

// Fade sections in as they scroll into view
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }
}, { threshold: 0.12 });
for (const el of document.querySelectorAll('.reveal')) observer.observe(el);

// Small looping demos inside the view cards (Features page board, home page list/board/calendar)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Returns a function to await before each step: it resolves only while `el` is on screen and the tab is open
function visibilityGate(el) {
  let onScreen = false;
  let wake = null;
  const check = () => { if (onScreen && !document.hidden && wake) { wake(); wake = null; } };
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; check(); }).observe(el);
  document.addEventListener('visibilitychange', check);
  return () => (onScreen && !document.hidden ? null : new Promise((resolve) => { wake = resolve; }));
}

// Positions are measured from .mini-demo, which is also where the cursor lives
const pointAt = (cursor, el) => {
  cursor.style.transform = `translate(${el.offsetLeft + el.offsetWidth * 0.6}px, ${el.offsetTop + el.offsetHeight * 0.45}px)`;
};

// Board: a cursor drags cards to the next column, again and again.
// Uses FLIP: measure every card, move the one card in the DOM, then slide each
// card from where it was to where it is now.
for (const boardDemo of reduceMotion ? [] : document.querySelectorAll('[data-board-demo]')) {
  const mini = boardDemo.closest('.mini-demo');
  const cursor = mini.querySelector('.mini-cursor');
  const columns = [...boardDemo.children];
  const MAX_CARDS = Number(boardDemo.dataset.max) || 5;
  const whenVisible = visibilityGate(mini);

  function moveCard(card, column, index) {
    const cards = [...boardDemo.querySelectorAll('.mini-card')];
    const before = new Map(cards.map((c) => [c, [c.offsetLeft, c.offsetTop]]));
    boardDemo.classList.add('no-anim');
    column.insertBefore(card, column.children[index] || null);
    for (const c of cards) {
      const [x, y] = before.get(c);
      c.style.setProperty('--dx', `${x - c.offsetLeft}px`);
      c.style.setProperty('--dy', `${y - c.offsetTop}px`);
    }
    getComputedStyle(boardDemo).transform; // lock in the "before" positions
    boardDemo.classList.remove('no-anim');
    for (const c of cards) { c.style.setProperty('--dx', '0px'); c.style.setProperty('--dy', '0px'); }
    pointAt(cursor, card);
  }

  (async () => {
    cursor.style.transform = `translate(${mini.offsetWidth / 2}px, ${mini.offsetHeight}px)`;
    await wait(900);
    for (;;) {
      await whenVisible();
      // Work moves forward: a column with spare cards hands one to the next column (Done goes back to the start)
      const moves = columns.map((from, i) => [from, columns[(i + 1) % columns.length]])
        .filter(([from, to]) => from.children.length > 1 && to.children.length < MAX_CARDS);
      const [from, to] = pick(moves);
      const card = pick([...from.children]);

      cursor.classList.add('show');
      pointAt(cursor, card);
      await wait(700);
      cursor.classList.add('press');
      card.classList.add('lifted');
      await wait(300);
      moveCard(card, to, Math.floor(Math.random() * (to.children.length + 1)));
      await wait(700);
      card.classList.replace('lifted', 'landed');
      cursor.classList.remove('press');
      await wait(600);
      card.classList.remove('landed');
      await wait(1000);
    }
  })();
}

// List: tick the top task, it slides away, and a new task is typed in at the bottom
for (const list of reduceMotion ? [] : document.querySelectorAll('[data-list-demo]')) {
  const whenVisible = visibilityGate(list);
  const template = list.querySelector('.mini-row');

  (async () => {
    await wait(900);
    for (;;) {
      await whenVisible();
      const row = list.querySelector('.mini-row');
      row.classList.add('done');
      await wait(900);
      row.classList.add('leaving');
      await wait(450);
      row.remove();

      const fresh = template.cloneNode(true);
      fresh.className = 'mini-row typing';
      fresh.querySelector('.bar').className = `bar ${pick(['w30', 'w40', 'w55', 'w70'])}`;
      const caret = document.createElement('span');
      caret.className = 'caret';
      fresh.append(caret);
      list.append(fresh);
      await wait(1300);
      caret.remove(); // "Enter" pressed
      fresh.classList.remove('typing');
      await wait(1100);
    }
  })();
}

// Calendar: a cursor picks up a task and drops it on another day
for (const cal of reduceMotion ? [] : document.querySelectorAll('[data-cal-demo]')) {
  const mini = cal.closest('.mini-demo');
  const cursor = mini.querySelector('.mini-cursor');
  const whenVisible = visibilityGate(mini);

  (async () => {
    cursor.style.transform = `translate(${mini.offsetWidth / 2}px, ${mini.offsetHeight}px)`;
    await wait(1200);
    for (;;) {
      await whenVisible();
      const from = pick([...cal.querySelectorAll('.has')]);
      const to = pick([...cal.children].filter((day) => !day.className));
      const color = from.className;

      cursor.classList.add('show');
      pointAt(cursor, from);
      await wait(700);
      cursor.classList.add('press');
      const ghost = document.createElement('span');
      ghost.className = `${color} mini-ghost`;
      Object.assign(ghost.style, {
        left: `${from.offsetLeft}px`, top: `${from.offsetTop}px`,
        width: `${from.offsetWidth}px`, height: `${from.offsetHeight}px`,
      });
      cal.append(ghost);
      from.className = '';
      ghost.getBoundingClientRect(); // start the slide from the old day
      ghost.style.transform = `translate(${to.offsetLeft - from.offsetLeft}px, ${to.offsetTop - from.offsetTop}px) rotate(-6deg) scale(1.2)`;
      pointAt(cursor, to);
      await wait(650);
      ghost.remove();
      to.className = `${color} landed`;
      cursor.classList.remove('press');
      await wait(600);
      to.classList.remove('landed');
      await wait(1000);
    }
  })();
}
