// Small chart kit for the Dashboard tab and the Reporting page: horizontal bars,
// columns, a line chart, a stacked bar and a chart card with a table view.
// Plain HTML/SVG. Colors come from the --viz-* CSS variables, so light and dark
// themes each get their own validated steps. Every value has a hover/focus
// tooltip and is also in the card's table view (tooltips never gate a value).
// Loaded before app.js. Uses make from app.js (only inside functions).

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Clean axis steps (1, 2, 5, 10...) for whole-number counts, about `count` of them
function niceScale(max, count = 4) {
  if (max <= 0) return { max: count, step: 1 };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw));
  return { max: Math.ceil(max / step) * step, step };
}

function compact(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
}

// ---------- Tooltip (one for the whole page) ----------

let vizTip = null;

// rows: [{ value, label, color, kind: 'line' | 'rect' }]; the value leads, the label follows
function showVizTip(x, y, title, rows) {
  if (!vizTip) {
    vizTip = make('div', 'viz-tip');
    vizTip.setAttribute('role', 'tooltip');
    document.body.append(vizTip);
  }
  vizTip.replaceChildren();
  if (title) vizTip.append(make('div', 'viz-tip-title', title));
  for (const r of rows) {
    const row = make('div', 'viz-tip-row');
    const key = make('span', `viz-key ${r.kind || 'rect'}`);
    key.style.background = r.color;
    row.append(key, make('strong', 'viz-tip-value', String(r.value)), make('span', 'viz-tip-label', r.label));
    vizTip.append(row);
  }
  vizTip.hidden = false;
  const w = vizTip.offsetWidth;
  const h = vizTip.offsetHeight;
  let left = x + 14;
  let top = y - h - 12;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top < 8) top = y + 16;
  vizTip.style.left = `${Math.max(8, left)}px`;
  vizTip.style.top = `${top}px`;
}

function hideVizTip() {
  if (vizTip) vizTip.hidden = true;
}

// Tooltip on hover and on keyboard focus for one element
function tipOn(el, getTip) {
  el.addEventListener('pointermove', (e) => { const t = getTip(); showVizTip(e.clientX, e.clientY, t.title, t.rows); });
  el.addEventListener('pointerleave', hideVizTip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    const t = getTip();
    showVizTip(r.left + r.width / 2, r.top, t.title, t.rows);
  });
  el.addEventListener('blur', hideVizTip);
}

window.addEventListener('scroll', hideVizTip, true);

// ---------- Card with a table view ----------

// table: { columns: ['Section', 'Tasks'], rows: [['To do', 3], ...] }
function chartCard(title, sub, chart, table, { wide = false } = {}) {
  const card = make('section', 'widget viz-card' + (wide ? ' wide' : ''));
  const head = make('div', 'viz-head');
  const text = make('div', 'viz-titles');
  text.append(make('h3', '', title));
  if (sub) text.append(make('p', 'viz-sub', sub));
  head.append(text);

  const body = make('div', 'viz-body');
  body.append(chart);
  if (table) {
    const toggle = make('button', 'btn-link viz-toggle', 'Table');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'false');
    let tableEl = null;
    toggle.addEventListener('click', () => {
      const showTable = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(showTable));
      toggle.textContent = showTable ? 'Chart' : 'Table';
      if (showTable && !tableEl) tableEl = buildVizTable(table);
      body.replaceChildren(showTable ? tableEl : chart);
      hideVizTip();
    });
    head.append(toggle);
  }
  card.append(head, body);
  return card;
}

function buildVizTable({ columns, rows }) {
  const wrap = make('div', 'viz-table-wrap');
  const t = make('table', 'viz-table');
  const tr = make('tr');
  columns.forEach((c, i) => tr.append(make('th', i ? 'num' : '', c)));
  const thead = make('thead');
  thead.append(tr);
  const tbody = make('tbody');
  for (const row of rows) {
    const r = make('tr');
    row.forEach((cell, i) => r.append(make('td', i ? 'num' : '', String(cell))));
    tbody.append(r);
  }
  if (!rows.length) {
    const r = make('tr');
    const td = make('td', 'empty-cell', 'Nothing to show yet');
    td.colSpan = columns.length;
    r.append(td);
    tbody.append(r);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

function vizEmpty(text) {
  return make('p', 'viz-empty', text);
}

// ---------- Horizontal bars (one series, one color) ----------
// rows: [{ label, value, dot?, person? }]; value at the bar tip

function barList(rows, { unit = 'task', empty = 'Nothing to show yet.' } = {}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max === 0) return vizEmpty(empty);
  const list = make('div', 'viz-bars');
  for (const r of rows) {
    const row = make('div', 'viz-bar-row');
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${r.label}: ${plural(r.value, unit)}`);
    const label = make('div', 'viz-bar-label');
    if (r.dot) {
      const dot = make('span', 'viz-dot');
      dot.style.background = r.dot;
      label.append(dot);
    }
    if (r.person) label.append(avatar(r.person));
    label.append(make('span', 'viz-bar-name', r.label));
    label.title = r.label;

    const track = make('div', 'viz-bar-track');
    const bar = make('div', 'viz-bar');
    bar.style.setProperty('--p', String(r.value / max));
    if (!r.value) bar.classList.add('zero');
    track.append(bar, make('span', 'viz-bar-value', String(r.value)));
    row.append(label, track);
    tipOn(row, () => ({ title: r.label, rows: [{ value: r.value, label: plural(r.value, unit).replace(/^\d+ /, ''), color: 'var(--viz-series)' }] }));
    list.append(row);
  }
  return list;
}

// ---------- Stacked bar (part to whole, up to a few segments) ----------
// segments: [{ label, value, color, icon }]; a legend with counts and shares below

function stackedBar(segments, { unit = 'task', empty = 'No tasks yet.' } = {}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) return vizEmpty(empty);
  const wrap = make('div', 'viz-stack');
  const bar = make('div', 'viz-stack-bar');
  for (const s of segments.filter((x) => x.value)) {
    const seg = make('div', 'viz-seg');
    seg.style.flexGrow = String(s.value);
    seg.style.background = s.color;
    seg.tabIndex = 0;
    seg.setAttribute('aria-label', `${s.label}: ${plural(s.value, unit)}`);
    tipOn(seg, () => ({ title: s.label, rows: [{ value: s.value, label: `${Math.round((s.value / total) * 100)}% of ${plural(total, unit)}`, color: s.color }] }));
    bar.append(seg);
  }
  const legend = make('ul', 'viz-legend');
  for (const s of segments) {
    const li = make('li');
    const key = make('span', 'viz-key rect');
    key.style.background = s.color;
    li.append(key);
    if (s.icon) li.append(make('span', 'viz-icon', s.icon));
    li.append(make('span', 'viz-legend-label', s.label), make('strong', 'viz-legend-value', String(s.value)),
      make('span', 'viz-legend-share', `${Math.round((s.value / total) * 100)}%`));
    legend.append(li);
  }
  wrap.append(bar, legend);
  return wrap;
}

// ---------- SVG charts that redraw when their width changes ----------

function responsiveSvg(height, draw) {
  const box = make('div', 'viz-svg');
  box.style.height = `${height}px`;
  let lastWidth = 0;
  const redraw = () => {
    const width = Math.floor(box.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    box.replaceChildren(draw(width, height));
  };
  new ResizeObserver(redraw).observe(box);
  return box;
}

function yAxis(svg, scale, { left, right, top, bottom, width, height }) {
  for (let v = 0; v <= scale.max; v += scale.step) {
    const y = top + (height - top - bottom) * (1 - v / scale.max);
    svg.append(svgEl('line', { class: v ? 'viz-gridline' : 'viz-baseline', x1: left, x2: width - right, y1: y, y2: y }));
    const label = svgEl('text', { class: 'viz-tick', x: left - 8, y: y + 4, 'text-anchor': 'end' });
    label.textContent = compact(v);
    svg.append(label);
  }
}

// Columns over time or categories. points: [{ label, title, value }]
function columnChart(points, { height = 210, unit = 'task' } = {}) {
  return responsiveSvg(height, (width) => {
    const pad = { left: 34, right: 8, top: 22, bottom: 26 };
    const svg = svgEl('svg', { width, height, class: 'viz-chart', role: 'img' });
    svg.setAttribute('aria-label', points.map((p) => `${p.title}: ${p.value}`).join(', '));
    const scale = niceScale(Math.max(0, ...points.map((p) => p.value)));
    yAxis(svg, scale, { ...pad, width, height });

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const slot = plotW / points.length;
    const colW = Math.min(24, slot * 0.62);
    const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 56))));
    const maxValue = Math.max(...points.map((p) => p.value));
    const maxIndex = points.findIndex((p) => p.value === maxValue);

    points.forEach((p, i) => {
      const cx = pad.left + slot * i + slot / 2;
      const h = (p.value / scale.max) * plotH;
      const x = cx - colW / 2;
      const y = pad.top + plotH - h;
      if (h > 0) {
        // 4px rounded data end, square on the baseline
        const r = Math.min(4, h, colW / 2);
        svg.append(svgEl('path', {
          class: 'viz-col',
          'data-i': i,
          d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + colW - r}Q${x + colW},${y} ${x + colW},${y + r}V${y + h}Z`,
        }));
      }
      // Label only the latest and the highest column; the axis and tooltip carry the rest
      if (p.value && (i === points.length - 1 || i === maxIndex)) {
        const cap = svgEl('text', { class: 'viz-cap', x: cx, y: y - 6, 'text-anchor': 'middle' });
        cap.textContent = String(p.value);
        svg.append(cap);
      }
      // X labels spaced so they never collide; the last one always shows
      const last = i === points.length - 1;
      if (last || (i % every === 0 && points.length - 1 - i >= every)) {
        const tick = svgEl('text', { class: 'viz-tick', x: cx, y: height - 8, 'text-anchor': 'middle' });
        tick.textContent = p.label;
        svg.append(tick);
      }
      // The whole slot is the hit target, not just the painted column
      const hit = svgEl('rect', { class: 'viz-hit', x: pad.left + slot * i, y: pad.top, width: slot, height: plotH, tabindex: 0 });
      hit.setAttribute('aria-label', `${p.title}: ${plural(p.value, unit)}`);
      tipOn(hit, () => ({ title: p.title, rows: [{ value: p.value, label: plural(p.value, unit).replace(/^\d+ /, ''), color: 'var(--viz-series)' }] }));
      // The hovered column lifts a little
      const col = () => svg.querySelector(`.viz-col[data-i="${i}"]`);
      for (const on of ['pointerenter', 'focus']) hit.addEventListener(on, () => col()?.classList.add('hover'));
      for (const off of ['pointerleave', 'blur']) hit.addEventListener(off, () => col()?.classList.remove('hover'));
      svg.append(hit);
    });
    return svg;
  });
}

// Lines over time. labels: ['Oct 1', ...]; series: [{ name, values, emphasis }]
// The emphasized series is the accent with a 10% wash; the others are gray context.
function lineChart(labels, series, { height = 230, titles = labels } = {}) {
  const wrap = make('div', 'viz-line-wrap');
  const legend = make('ul', 'viz-legend inline');
  for (const s of series) {
    const li = make('li');
    const key = make('span', 'viz-key line');
    key.style.background = s.emphasis ? 'var(--viz-series)' : 'var(--viz-context)';
    li.append(key, make('span', 'viz-legend-label', s.name));
    legend.append(li);
  }

  const chart = responsiveSvg(height, (width) => {
    const pad = { left: 34, right: 96, top: 14, bottom: 26 };
    const svg = svgEl('svg', { width, height, class: 'viz-chart', role: 'img', tabindex: 0 });
    svg.setAttribute('aria-label', series.map((s) => `${s.name}: ${s.values[s.values.length - 1]} at the end`).join(', '));
    const scale = niceScale(Math.max(1, ...series.flatMap((s) => s.values)));
    yAxis(svg, scale, { ...pad, width, height });

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const n = labels.length;
    const xAt = (i) => pad.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const yAt = (v) => pad.top + plotH * (1 - v / scale.max);

    // X labels: spaced so they never collide, always the first and the last
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
    labels.forEach((label, i) => {
      const last = i === n - 1;
      if (!(i % every === 0 && n - 1 - i >= every) && !last) return;
      const tick = svgEl('text', { class: 'viz-tick', x: xAt(i), y: height - 8, 'text-anchor': i === 0 ? 'start' : last ? 'end' : 'middle' });
      tick.textContent = label;
      svg.append(tick);
    });

    // Context first, the emphasized series on top
    const ordered = [...series].sort((a, b) => Number(a.emphasis) - Number(b.emphasis));
    for (const s of ordered) {
      const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`);
      if (s.emphasis) {
        svg.append(svgEl('path', { class: 'viz-area', d: `M${xAt(0)},${yAt(0)}L${pts.join('L')}L${xAt(n - 1)},${yAt(0)}Z` }));
      }
      svg.append(svgEl('polyline', { class: s.emphasis ? 'viz-line' : 'viz-line context', points: pts.join(' ') }));
    }

    // End dots and direct end labels (dropped for context when the two would collide)
    const ends = series.map((s) => ({ s, y: yAt(s.values[n - 1]) }));
    const collide = ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 16;
    for (const { s, y } of ends) {
      svg.append(svgEl('circle', { class: s.emphasis ? 'viz-dot-end' : 'viz-dot-end context', cx: xAt(n - 1), cy: y, r: 4 }));
      if (collide && !s.emphasis) continue;
      const label = svgEl('text', { class: 'viz-end-label', x: xAt(n - 1) + 10, y: y + 4 });
      label.textContent = `${s.values[n - 1]} ${s.name.toLowerCase()}`;
      svg.append(label);
    }

    // Crosshair: a hairline that snaps to the nearest day, one tooltip for every series
    const cross = svgEl('line', { class: 'viz-cross', y1: pad.top, y2: pad.top + plotH, x1: 0, x2: 0, visibility: 'hidden' });
    const marks = series.map((s) => svgEl('circle', { class: s.emphasis ? 'viz-dot-end' : 'viz-dot-end context', r: 4, visibility: 'hidden' }));
    svg.append(cross, ...marks);
    let current = n - 1;
    const show = (i, clientX, clientY) => {
      current = Math.max(0, Math.min(n - 1, i));
      const x = xAt(current);
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
      marks.forEach((m, k) => {
        m.setAttribute('cx', x);
        m.setAttribute('cy', yAt(series[k].values[current]));
        m.setAttribute('visibility', 'visible');
      });
      const rect = svg.getBoundingClientRect();
      showVizTip(clientX ?? rect.left + x, clientY ?? rect.top + pad.top, titles[current], series.map((s) => ({
        value: s.values[current], label: s.name, kind: 'line', color: s.emphasis ? 'var(--viz-series)' : 'var(--viz-context)',
      })));
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      marks.forEach((m) => m.setAttribute('visibility', 'hidden'));
      hideVizTip();
    };
    const hit = svgEl('rect', { class: 'viz-hit', x: pad.left, y: pad.top, width: plotW, height: plotH });
    hit.addEventListener('pointermove', (e) => {
      const x = e.clientX - svg.getBoundingClientRect().left;
      show(Math.round(((x - pad.left) / plotW) * (n - 1)), e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', hide);
    svg.append(hit);
    // Keyboard: arrow keys walk the days, same readout as hover
    svg.addEventListener('focus', () => show(current));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(current + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });
    return svg;
  });
  wrap.append(legend, chart);
  return wrap;
}
