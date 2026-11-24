// One floating list used for files, commands, lines, symbols, languages.
// source(query) returns [{ label, detail, hits, run, preview }], or a Promise of that list.
const el = document.getElementById('palette');
const input = el.querySelector('input');
const list = el.querySelector('ul');

let source = null, items = [], sel = 0, onCancel = null, done = false;

export function openPalette({ placeholder = '', value = '', source: src, cancel }) {
  source = src;
  onCancel = cancel || null;
  done = false;
  input.placeholder = placeholder;
  input.value = value;
  el.hidden = false;
  input.focus();
  input.setSelectionRange(value.length, value.length);
  refresh();
}

export function paletteOpen() {
  return !el.hidden;
}

export function closePalette(cancelled = true) {
  if (el.hidden) return;
  el.hidden = true;
  list.textContent = '';
  if (cancelled && !done) onCancel?.();
  done = true;
  document.dispatchEvent(new Event('palette-closed'));
}

let token = 0;
function refresh() {
  const t = ++token;
  const r = source(input.value);
  // Slow sources (find in files) answer later; drop answers to older queries.
  if (r && typeof r.then === 'function') r.then(list => { if (t === token && !el.hidden && list) show(list); });
  else show(r);
}

function show(list) {
  items = list.slice(0, 200);
  sel = 0;
  render();
  items[0]?.preview?.();
}

function highlighted(text, hits) {
  const frag = document.createDocumentFragment();
  if (!hits?.length) { frag.append(text); return frag; }
  const set = new Set(hits);
  let run = '', inHit = false;
  const flush = () => {
    if (!run) return;
    if (inHit) { const b = document.createElement('b'); b.textContent = run; frag.append(b); } else frag.append(run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== inHit) { flush(); inHit = h; }
    run += text[i];
  }
  flush();
  return frag;
}

function render() {
  list.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing matches';
    list.append(li);
    return;
  }
  items.forEach((it, i) => {
    const li = document.createElement('li');
    if (i === sel) li.className = 'sel';
    const label = document.createElement('span');
    label.className = 'label';
    if (it.font) label.style.fontFamily = it.font;
    label.append(highlighted(it.label, it.hits));
    li.append(label);
    if (it.detail) {
      const d = document.createElement('span');
      d.className = 'detail';
      d.textContent = it.detail;
      li.append(d);
    }
    if (it.key) {
      const k = document.createElement('kbd');
      k.textContent = it.key;
      li.append(k);
    }
    li.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
    li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
    list.append(li);
  });
}

function mark() {
  [...list.children].forEach((li, i) => li.classList.toggle('sel', i === sel));
  list.children[sel]?.scrollIntoView({ block: 'nearest' });
  items[sel]?.preview?.();
}

function choose(i) {
  const it = items[i];
  if (!it) return;
  done = true;
  closePalette(false);
  it.run();
}

input.addEventListener('input', refresh);
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { sel = Math.min(sel + 1, items.length - 1); mark(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p' && !e.shiftKey && items.length)) { sel = Math.max(sel - 1, 0); mark(); e.preventDefault(); }
  else if (e.key === 'PageDown') { sel = Math.min(sel + 10, items.length - 1); mark(); e.preventDefault(); }
  else if (e.key === 'PageUp') { sel = Math.max(sel - 10, 0); mark(); e.preventDefault(); }
  else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
  else if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
  e.stopPropagation();
});
input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) closePalette(); }, 0));
