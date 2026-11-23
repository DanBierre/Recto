import { Text } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { marked } from 'marked';
import {
  EditorState, EditorView, EditorSelection, extensions, language, wrapping, gutters, indentation, indentExtension,
  spelling, whitespace, spellExt, whitespaceExt,
} from './editor.js';
import { lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { foldGutter } from '@codemirror/language';
import { LANGUAGES, languageLabel, languageExtension } from './languages.js';
import { openPalette, closePalette, paletteOpen } from './palette.js';
import { detectEol, detectIndent, basename, dirname, relativeTo, fuzzy, languageFor, countWords, countChars, mixedEol } from './util.js';
import { docHtml, docxParts, markdownText, parseCsv, csvToJson, jsonToCsv } from './export.js';

const api = window.recto;
const $ = s => document.querySelector(s);
const tabsEl = $('#tabs');
const statusEl = $('#status');
const sidebarEl = $('#sidebar');
const previewEl = $('#preview');
const emptyEl = $('#empty');

// ---------- state ----------
let settings = {
  theme: 'system', fontSize: 14, wrap: false, lineNums: true, sidebar: false, preview: false,
  folder: null, recent: [], recentFolders: [], trimOnSave: true, spellcheck: true, showWhitespace: false, saveOnBlur: false, tone: 'warm',
  layout: 'classic', prevLayout: 'classic', font: 'serif', proseLineNums: false, startBlank: false,
};
let systemDark = false;
let docs = [];
let active = null;
let nextId = 1;
let closedStack = [];
let folderFiles = null;
let zen = false;
const expanded = new Set();

const view = new EditorView({ parent: $('#editor') });

const stateOf = d => (d === active ? view.state : d.state);
const textOf = d => stateOf(d).doc;
const isDirty = d => (d.path ? !textOf(d).eq(d.saved) : textOf(d).length > 0);
const docName = d => (d.path ? basename(d.path) : d.title || 'untitled');

function makeState(d, text, selection) {
  return EditorState.create({
    doc: text,
    selection,
    extensions: extensions({ lang: d.lang, wrap: d.wrap, lineNums: lineNumsFor(d), indent: d.indent, spell: spells(d), ws: settings.showWhitespace, onUpdate }),
  });
}

function onUpdate(u) {
  if (u.docChanged) {
    renderTabs();
    scheduleSession();
    if (settings.preview) schedulePreview();
  }
  if (u.docChanged || u.selectionSet) renderStatus();
}

// ---------- tabs ----------
const PROSE = new Set(['markdown', 'text']);
// Spellcheck only prose; squiggles under every variable name would drive you mad.
const spells = d => settings.spellcheck && PROSE.has(d.lang);
// Notes and letters don't need line numbers; code does. Each kind keeps its own setting.
const lineNumsFor = d => (PROSE.has(d.lang) ? settings.proseLineNums : settings.lineNums);

// Everything a tab's look depends on that can change while it sits in the background.
function docEffects(d) {
  return [
    wrapping.reconfigure(d.wrap || zen || settings.layout === 'page' ? EditorView.lineWrapping : []),
    gutters.reconfigure(zen ? [] : gutterExt(d)),
    spelling.reconfigure(spellExt(spells(d))),
    whitespace.reconfigure(whitespaceExt(settings.showWhitespace)),
  ];
}

function toggleWrap() {
  if (!active) return;
  active.wrap = !active.wrap;
  applySettings();
  flash(active.wrap ? 'Wrap on' : 'Wrap off');
  renderStatus();
  scheduleSession();
}

function newDoc({ path = null, text = '', lang, saved, eol = '\r\n', encoding = 'utf8', bom = false, mtime = 0, title = null, selection, wrap } = {}) {
  const d = { id: nextId++, path, title, eol, encoding, bom, mtime, scroll: 0 };
  d.lang = lang || languageFor(path || title, text);
  // Prose wraps by default; code follows the setting. Alt+Z flips it per tab.
  d.wrap = wrap ?? (PROSE.has(d.lang) || settings.wrap);
  d.indent = detectIndent(text, { tabs: false, size: d.lang === 'python' ? 4 : 2 });
  d.state = makeState(d, text, selection);
  d.saved = saved ? Text.of(saved.split('\n')) : d.state.doc;
  return d;
}

function activate(d, { focus = true } = {}) {
  if (active && active !== d) {
    active.state = view.state;
    active.scroll = view.scrollDOM.scrollTop;
  }
  active = d;
  if (d) {
    view.setState(d.state);
    // Settings may have changed while this tab was in the background.
    view.dispatch({ effects: docEffects(d) });
    requestAnimationFrame(() => { view.scrollDOM.scrollTop = d.scroll; });
  }
  emptyEl.hidden = !!d;
  renderViewer();
  // Focus only once the editor is visible, or the first file from the welcome screen gets no cursor.
  if (d && focus && !$('#editor').hidden) view.focus();
  if (!d) renderRecent();
  document.title = d ? `${docName(d)} · Recto` : 'Recto';
  renderTabs();
  renderStatus();
  renderSidebar();
  if (settings.preview) renderPreview();
  scheduleSession();
}

function gutterExt(d) {
  return lineNumsFor(d) ? [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '⌄', closedText: '›' })] : [];
}

function renderTabs() {
  tabsEl.textContent = '';
  const names = docs.map(docName);
  for (const d of docs) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (d === active ? ' active' : '') + (isDirty(d) ? ' dirty' : '') + (d.pinned ? ' pinned' : '');
    tab.draggable = true;
    tab.title = d.path || docName(d);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = docName(d);
    tab.append(name);
    // Two tabs with the same name: show the parent folder to tell them apart.
    if (d.path && names.filter(n => n === docName(d)).length > 1) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = basename(dirname(d.path));
      tab.append(hint);
    }
    if (d.changedOnDisk || d.missing) tab.classList.add('stale');
    const close = document.createElement('button');
    close.className = 'close';
    close.tabIndex = -1;
    close.setAttribute('aria-label', 'Close tab');
    close.addEventListener('click', e => { e.stopPropagation(); if (!d.pinned) closeDoc(d); });
    tab.append(close);
    tab.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); if (!d.pinned) closeDoc(d); }
      else if (e.button === 0) activate(d);
    });
    tab.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(d, e.clientX, e.clientY); });
    tab.addEventListener('dragstart', e => { e.dataTransfer.setData('recto/tab', String(d.id)); e.dataTransfer.effectAllowed = 'move'; });
    tab.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('recto/tab')) { e.preventDefault(); e.stopPropagation(); } });
    tab.addEventListener('drop', e => {
      const id = Number(e.dataTransfer.getData('recto/tab'));
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const from = docs.findIndex(x => x.id === id);
      const [moved] = docs.splice(from, 1);
      docs.splice(docs.indexOf(d) + (from <= docs.indexOf(d) ? 1 : 0), 0, moved);
      keepPinnedFirst();
      renderTabs();
      scheduleSession();
    });
    tabsEl.append(tab);
  }
  tabsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Pinned tabs sit at the left. The sort is stable, so the order inside each group stays as it was.
function keepPinnedFirst() {
  docs.sort((a, b) => Boolean(b.pinned) - Boolean(a.pinned));
}

function togglePin(d = active) {
  if (!d) return;
  d.pinned = !d.pinned;
  keepPinnedFirst();
  renderTabs();
  scheduleSession();
}

// Close these tabs one by one (asking about unsaved ones), skipping pinned tabs.
async function closeEach(list) {
  for (const t of list.filter(x => !x.pinned)) if (!(await closeDoc(t))) break;
}

tabsEl.addEventListener('dblclick', e => { if (e.target === tabsEl) newFile(); });
tabsEl.addEventListener('wheel', e => { tabsEl.scrollLeft += e.deltaY; }, { passive: true });

async function closeDoc(d, { ask = true } = {}) {
  if (ask && isDirty(d)) {
    activate(d);
    const r = await api.askUnsaved(docName(d));
    if (r === 2) return false;
    if (r === 0 && !(await save(d))) return false;
  }
  if (d.path) closedStack.push(d.path);
  const i = docs.indexOf(d);
  docs.splice(i, 1);
  if (d === active) {
    active = null;
    activate(docs[Math.min(i, docs.length - 1)] || null);
  } else renderTabs();
  watchOpenFiles();
  scheduleSession();
  return true;
}

function cycle(step) {
  if (docs.length < 2) return;
  const i = docs.indexOf(active);
  activate(docs[(i + step + docs.length) % docs.length]);
}

// ---------- files ----------
function newFile() {
  const d = newDoc({ eol: '\r\n' });
  docs.push(d);
  activate(d);
}

function isBlankUntitled(d) {
  return d && !d.path && !isDirty(d);
}

async function openPath(p, { focus = true, line } = {}) {
  const same = x => x && x.toLowerCase() === p.toLowerCase();
  const open = docs.find(d => same(d.path) || same(d.source));
  if (open) { activate(open, { focus }); if (line) goToLine(line); return open; }
  // A slow disk or network drive gets a note, so it doesn't look like nothing happened.
  const slow = setTimeout(() => flash('Opening…'), 300);
  const r = await api.readFile(p);
  clearTimeout(slow);
  if (r.dir) { setFolder(p); return null; }
  if (r.error) {
    toast(`${basename(p)}: ${r.error}`);
    if (r.missing) pruneRecent(p);
    return null;
  }
  // Building the editor for a big file freezes the window for a moment. Show the note first.
  if (r.content && r.content.length > 2e6) {
    flash('Opening a big file…');
    await new Promise(done => setTimeout(done, 60));
  }
  let d;
  if (r.view) {
    // Images and PDFs are shown, not edited.
    d = newDoc({ path: p, lang: 'text', mtime: r.mtime });
    d.view = r.view;
  } else if (r.extracted !== undefined) {
    // A Word file opens as its words in a new untitled tab. The .docx itself is never touched.
    d = newDoc({ text: r.extracted.replace(/\r\n?/g, '\n'), title: basename(p).replace(/\.[^.]+$/, '') + '.txt' });
    d.source = p;
    d.near = dirname(p);
    flash('Text from the Word file. Save it wherever you like');
  } else {
    d = newDoc({ path: p, text: r.content.replace(/\r\n?/g, '\n'), eol: detectEol(r.content), encoding: r.encoding, bom: r.bom, mtime: r.mtime });
    if (mixedEol(r.content)) toast(`${basename(p)} mixes Windows and Unix line endings. Recto will save it as ${d.eol === '\r\n' ? 'Windows (CRLF)' : 'Unix (LF)'} throughout.`);
  }
  // Like Sublime: an empty untitled tab gets replaced by the file you open.
  const blank = isBlankUntitled(active) && docs.length ? active : null;
  if (blank) docs.splice(docs.indexOf(blank), 1, d); else docs.push(d);
  if (blank) active = null;
  addRecent(p);
  activate(d, { focus });
  if (line) goToLine(line);
  watchOpenFiles();
  return d;
}

async function openDialog() {
  for (const p of await api.openDialog()) await openPath(p);
}

function addRecent(p) {
  settings.recent = [p, ...settings.recent.filter(x => x.toLowerCase() !== p.toLowerCase())].slice(0, 40);
  api.saveSettings({ recent: settings.recent });
}

// A recent file that's gone would fail every time, so drop it from the list.
function pruneRecent(p) {
  settings.recent = settings.recent.filter(x => x.toLowerCase() !== p.toLowerCase());
  api.saveSettings({ recent: settings.recent });
  renderRecent();
}

function trimmed(text) {
  return text.replace(/[ \t]+$/gm, '');
}

async function save(d = active, { as = false } = {}) {
  if (!d) return false;
  if (d.view) { flash('Recto shows this one but doesn\'t edit it'); return false; }
  let p = d.path;
  if (!p || as) {
    const firstLine = textOf(d).line(1).text.trim().replace(/[\\/:*?"<>|#]/g, '').slice(0, 40);
    const dir = d.near || settings.folder;
    const suggested = d.path || ((dir ? dir + '\\' : '') + (d.title || (firstLine || 'untitled') + '.txt'));
    p = await api.saveDialog(suggested);
    if (!p) return false;
  }
  if (settings.trimOnSave && d === active) {
    // Trim trailing spaces, but leave the line the cursor sits on alone so typing isn't disturbed.
    const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
    const changes = [];
    for (let n = 1; n <= view.state.doc.lines; n++) {
      if (n === cur) continue;
      const line = view.state.doc.line(n);
      const m = /[ \t]+$/.exec(line.text);
      if (m && d.lang !== 'markdown') changes.push({ from: line.from + m.index, to: line.to });
    }
    if (changes.length) view.dispatch({ changes });
  }
  const text = textOf(d).sliceString(0, undefined, d.eol);
  const r = await api.writeFile(p, text, d.encoding, d.bom);
  if (!r.ok) { toast(`Couldn't save ${basename(p)}: ${r.error}`); return false; }
  if (r.encoding !== d.encoding) toast(`Some characters don't fit ${ENCODINGS[d.encoding]}, so ${docName(d)} was saved as UTF-8.`);
  d.encoding = r.encoding;
  d.bom = r.bom;
  const renamed = p !== d.path;
  d.path = p;
  d.mtime = r.mtime;
  d.saved = textOf(d);
  d.changedOnDisk = false;
  d.missing = false;
  if (renamed) {
    const lang = languageFor(p, stateOf(d).doc.sliceString(0, 200));
    if (lang !== d.lang) setLanguage(lang, d);
    addRecent(p);
    watchOpenFiles();
  }
  renderTabs();
  renderStatus();
  scheduleSession();
  flash('Saved');
  return true;
}

async function saveAll() {
  for (const d of docs) if (isDirty(d) && d.path) await save(d);
}

async function reloadFromDisk(d, { force = false } = {}) {
  if (!d.path) return;
  const r = await api.readFile(d.path);
  if (r.missing) {
    if (!d.missing) {
      d.missing = true;
      renderTabs();
      renderStatus();
      toast(`${docName(d)} was deleted outside Recto. Saving will put it back.`);
    }
    return;
  }
  if (r.error) return;
  if (r.mtime === d.mtime && !force) return;
  if (d.view) { d.mtime = r.mtime; if (d === active) renderViewer(); return; }
  if (isDirty(d) && !force) {
    d.changedOnDisk = true;
    renderTabs();
    toast(`${docName(d)} changed outside Recto. Your edits are kept. Use "Reload from disk" to take theirs.`);
    return;
  }
  const text = r.content.replace(/\r\n?/g, '\n');
  const cur = textOf(d);
  // Replace as one change so Ctrl+Z can bring your version back.
  const tr = stateOf(d).update({ changes: { from: 0, to: cur.length, insert: text } });
  if (d === active) view.dispatch(tr); else d.state = tr.state;
  d.saved = textOf(d);
  d.mtime = r.mtime;
  d.eol = detectEol(r.content);
  d.encoding = r.encoding;
  d.bom = r.bom;
  d.changedOnDisk = false;
  d.missing = false;
  renderTabs();
  renderStatus();
  if (d === active) renderViewer();
}

function watchOpenFiles() {
  api.watch(docs.filter(d => d.path).map(d => d.path));
}

api.onFileChanged(p => {
  const d = docs.find(x => x.path === p);
  if (d) reloadFromDisk(d);
});
api.onOpenFiles(paths => paths.forEach(p => openPath(p)));

// Drag files or a folder onto the window.
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  for (const f of e.dataTransfer.files) await openPath(api.pathForFile(f));
});

// ---------- session (hot exit) ----------
let sessionTimer = 0;
function scheduleSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 600);
}

function sessionData() {
  if (active) { active.state = view.state; active.scroll = view.scrollDOM.scrollTop; }
  return {
    active: docs.indexOf(active),
    closed: closedStack.slice(-20),
    docs: docs.map(d => {
      const st = stateOf(d);
      const dirty = isDirty(d);
      return {
        path: d.path, title: d.title, lang: d.lang, wrap: d.wrap, eol: d.eol, encoding: d.encoding, bom: d.bom, mtime: d.mtime,
        view: d.view, table: d.table, source: d.source, near: d.near, pinned: d.pinned,
        text: dirty || !d.path ? st.doc.toString() : undefined,
        saved: dirty && d.path ? d.saved.toString() : undefined,
        anchor: st.selection.main.anchor, head: st.selection.main.head, scroll: d.scroll,
      };
    }),
  };
}

function saveSession() {
  clearTimeout(sessionTimer);
  api.saveSessionSync(sessionData());
}

window.addEventListener('beforeunload', saveSession);

async function restoreSession(session) {
  if (!session?.docs) return;
  for (const s of session.docs) {
    let text = s.text, saved = s.saved, mtime = s.mtime;
    // A blank start keeps only work that isn't saved anywhere else.
    if (settings.startBlank && (text === undefined || (!s.path && !text))) continue;
    if (s.path) {
      const r = await api.readFile(s.path);
      if (r.error && text === undefined) continue; // file gone and nothing unsaved: drop it
      if (r.view || s.view) {
        if (!r.view) continue;
        const d = newDoc({ path: s.path, lang: 'text', mtime: r.mtime });
        d.view = r.view;
        docs.push(d);
        continue;
      }
      if (!r.error && r.content === undefined) continue;
      if (!r.error) {
        const disk = r.content.replace(/\r\n?/g, '\n');
        if (text === undefined) text = disk;
        // Only keep the stored "saved" copy if the file hasn't changed since.
        saved = r.mtime === s.mtime && saved !== undefined ? saved : disk;
        mtime = r.mtime;
      }
    }
    const len = (text || '').length;
    const sel = EditorSelection.single(Math.min(s.anchor || 0, len), Math.min(s.head || 0, len));
    const d = newDoc({ path: s.path, title: s.title, text: text || '', saved, lang: s.lang, wrap: s.wrap, eol: s.eol, encoding: s.encoding, bom: s.bom, mtime, selection: sel });
    d.scroll = s.scroll || 0;
    Object.assign(d, { table: s.table, source: s.source, near: s.near, pinned: s.pinned });
    docs.push(d);
  }
  closedStack = session.closed || [];
  activate(docs[session.active] || docs[0] || null);
  watchOpenFiles();
}

// ---------- status bar ----------
function renderStatus() {
  statusEl.textContent = '';
  if (!active) return;
  const st = view.state;
  const add = (text, { title, onClick, cls } = {}) => {
    const b = document.createElement(onClick ? 'button' : 'span');
    b.textContent = text;
    if (cls) b.className = cls;
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    statusEl.append(b);
    return b;
  };
  // Just the folder and file name, so deep paths don't fill the bar. The full path is on hover.
  const left = add(active.path ? active.path.split(/[\\/]/).slice(-2).join('\\') : 'Not saved yet', {
    cls: 'path', title: active.path ? `${active.path}\nClick to show in File Explorer` : '', onClick: active.path ? () => api.reveal(active.path) : undefined,
  });
  left.classList.add('grow');
  if (active.view) { add(active.view === 'pdf' ? 'PDF' : 'Image'); return; }
  if (isCsv(active)) add(showsViewer(active) ? 'View as text' : 'View as table', { onClick: toggleTable, title: 'Switch between the table and the raw text' });
  if (active.missing) add('Deleted on disk', { cls: 'warn', title: 'Saving will put the file back' });
  if (active.changedOnDisk) add('Changed on disk', { cls: 'warn', onClick: () => reloadFromDisk(active, { force: true }), title: 'Reload from disk' });
  const sel = st.selection;
  const head = sel.main.head;
  const line = st.doc.lineAt(head);
  if (sel.ranges.length > 1) add(`${sel.ranges.length} cursors`);
  else if (!sel.main.empty) {
    const n = sel.main.to - sel.main.from;
    const lines = st.doc.lineAt(sel.main.to).number - st.doc.lineAt(sel.main.from).number + 1;
    add(lines > 1 ? `${lines} lines, ${n} characters selected` : `${n} selected`);
  }
  add(`Ln ${line.number}, Col ${head - line.from + 1}`, { onClick: () => openGoTo(':'), title: 'Go to line' });
  // Counting words means reading the whole file on every keystroke, so skip it for big ones.
  if (PROSE.has(active.lang) && st.doc.length < 1e6) {
    const body = st.doc.toString();
    add(`${countWords(body).toLocaleString()} words`);
    add(`${countChars(body).toLocaleString()} chars`);
  }
  // The page layout always wraps, so the button only means something in the others.
  if (settings.layout !== 'page') add(active.wrap ? 'Wrap' : 'No wrap', { onClick: toggleWrap, title: 'Word wrap (Alt+Z)' });
  add(active.indent.tabs ? `Tabs: ${active.indent.size}` : `Spaces: ${active.indent.size}`, { onClick: pickIndent, title: 'Change indent' });
  const enc = encodingLabel(active);
  if (enc !== 'UTF-8') add(enc, { onClick: pickEncoding, title: 'Change encoding' });
  add(active.eol === '\r\n' ? 'CRLF' : 'LF', { onClick: () => setEol(active.eol === '\r\n' ? '\n' : '\r\n'), title: 'Switch line endings' });
  add(languageLabel(active.lang), { onClick: pickLanguage, title: 'Change language' });
}

let flashTimer = 0;
function flash(text) {
  const f = $('#flash');
  f.textContent = text;
  f.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('show'), 1100);
}

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}
$('#toast').addEventListener('click', e => { e.currentTarget.hidden = true; });

// ---------- language, indent, line endings ----------
function setLanguage(key, d = active) {
  d.lang = key;
  const effects = [language.reconfigure(languageExtension(key)), spelling.reconfigure(spellExt(spells(d)))];
  effects.push(gutters.reconfigure(zen ? [] : gutterExt(d)));
  if (d === active) view.dispatch({ effects }); else d.state = d.state.update({ effects }).state;
  if (d === active) $('#editor').classList.toggle('prose', PROSE.has(key));
  renderStatus();
  if (settings.preview) renderPreview();
  scheduleSession();
}

function setIndent(indent) {
  active.indent = indent;
  view.dispatch({ effects: indentation.reconfigure(indentExtension(indent)) });
  renderStatus();
}

// Changing endings or encoding means the file on disk differs, so mark it unsaved.
function markChanged() {
  active.saved = Text.of(['\u0000']);
  renderTabs();
  renderStatus();
  scheduleSession();
}

function setEol(eol) {
  active.eol = eol;
  markChanged();
}

const ENCODINGS = { utf8: 'UTF-8', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', cp1252: 'Windows-1252' };
const encodingLabel = d => (d.encoding === 'utf8' && d.bom ? 'UTF-8 with BOM' : ENCODINGS[d.encoding || 'utf8']);

function pickEncoding() {
  const opts = [['UTF-8', 'utf8', false], ['UTF-8 with BOM', 'utf8', true], ['UTF-16 LE', 'utf16le', true], ['Windows-1252', 'cp1252', false]];
  openPalette({
    placeholder: 'Save with encoding',
    source: q => rank(opts.map(([label, encoding, bom]) => ({
      label, detail: label === encodingLabel(active) ? 'current' : '',
      run: () => { active.encoding = encoding; active.bom = bom; markChanged(); },
    })), q),
  });
}

function pickLanguage() {
  const entries = Object.entries(LANGUAGES);
  openPalette({
    placeholder: 'Set language',
    source: q => rank(entries.map(([key, [label]]) => ({ label, detail: key === active.lang ? 'current' : '', run: () => setLanguage(key) })), q),
  });
}

function pickIndent() {
  const opts = [
    ['Spaces: 2', { tabs: false, size: 2 }], ['Spaces: 4', { tabs: false, size: 4 }],
    ['Tabs (width 4)', { tabs: true, size: 4 }], ['Tabs (width 2)', { tabs: true, size: 2 }],
  ];
  openPalette({
    placeholder: 'Indent with',
    source: q => rank(opts.map(([label, v]) => ({ label, run: () => setIndent(v) })), q),
  });
}

// ---------- palette: files, lines, symbols, commands ----------
function rank(list, q) {
  if (!q.trim()) return list;
  return list
    .map(it => { const m = fuzzy(q, it.label); return m && { ...it, hits: m.hits, score: m.score }; })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function goToLine(n, col = 1) {
  if (!active) return;
  const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
  const pos = Math.min(line.from + col - 1, line.to);
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}

function symbols() {
  if (!active) return [];
  const out = [];
  const md = active.lang === 'markdown';
  const doc = view.state.doc;
  const code = [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|def|fn|func|interface|type|enum|struct|trait|impl|module|namespace)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /^\s*(?:public|private|protected|static|async|\s)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/,
    /^\s*([.#]?[A-Za-z][\w-]*(?:[ .#:>][\w-]*)*)\s*\{\s*$/, // CSS rules
  ];
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (md) {
      const m = /^(#{1,6})\s+(.*)/.exec(text);
      if (m) out.push({ name: '  '.repeat(m[1].length - 1) + m[2], line: n });
      continue;
    }
    for (const re of code) {
      const m = re.exec(text);
      if (m && !/^(if|for|while|switch|catch|return|else)$/.test(m[1])) { out.push({ name: m[1], line: n }); break; }
    }
  }
  return out;
}

function openGoTo(prefix = '') {
  const startSel = active && view.state.selection;
  const startScroll = active && view.scrollDOM.scrollTop;
  const startDoc = active;
  const restore = () => {
    if (active && active === startDoc) {
      view.dispatch({ selection: startSel });
      view.scrollDOM.scrollTop = startScroll;
      view.focus();
    }
  };
  const peek = (n) => () => {
    if (!active) return;
    const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  };
  openPalette({
    placeholder: 'Go to file   ( : line   @ symbol   > command )',
    value: prefix,
    cancel: restore,
    source: q => {
      if (q.startsWith('>')) return commandItems(q.slice(1));
      if (q.startsWith(':')) {
        const [n, c] = q.slice(1).split(/[:,]/).map(Number);
        if (!active) return [];
        if (!n) return [{ label: `Type a line number (1–${view.state.doc.lines})`, run: restore }];
        return [{ label: `Go to line ${n}${c ? `, column ${c}` : ''}`, run: () => goToLine(n, c || 1), preview: peek(n) }];
      }
      if (q.startsWith('@')) {
        const list = symbols().map(s => ({ label: s.name, detail: `:${s.line}`, run: () => goToLine(s.line), preview: peek(s.line) }));
        const sq = q.slice(1);
        if (!list.length) return [{ label: 'No symbols in this file', run: restore }];
        return sq ? rank(list, sq) : list;
      }
      return fileItems(q);
    },
  });
}

function fileItems(q) {
  // "name:42" opens the file at line 42, like Sublime.
  const [query, lineStr] = q.split(':');
  const line = Number(lineStr) || undefined;
  const seen = new Set();
  const list = [];
  const push = (p, detail) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ label: settings.folder ? relativeTo(settings.folder, p) : p, path: p, detail, run: () => openPath(p, { line }) });
  };
  for (const d of docs) if (d.path) push(d.path, d === active ? 'current' : 'open');
  for (const d of docs) if (!d.path) list.push({ label: docName(d), detail: 'open', run: () => activate(d) });
  for (const p of folderFiles || []) push(p, '');
  for (const p of settings.recent) push(p, 'recent');
  if (!list.length && !settings.folder) return [{ label: 'Open a folder to search its files', run: async () => { const f = await api.folderDialog(); if (f) setFolder(f); } }];
  if (!query.trim()) return list.slice(0, 60);
  return rank(list, query);
}

// ---------- commands ----------
const COMMANDS = [
  ['New file', 'Ctrl+N', newFile],
  ['Open file…', 'Ctrl+O', openDialog],
  ['Open folder…', '', async () => { const p = await api.folderDialog(); if (p) setFolder(p); }],
  ['Open recent folder…', '', openRecentFolder],
  ['Close folder', '', () => setFolder(null)],
  ['Save', 'Ctrl+S', () => save()],
  ['Save as…', 'Ctrl+Shift+S', () => save(active, { as: true })],
  ['Save all', '', saveAll],
  ['Close tab', 'Ctrl+W', () => active && closeDoc(active)],
  ['Pin or unpin tab', '', () => togglePin()],
  ['Close other tabs', '', () => closeEach(docs.filter(x => x !== active))],
  ['Close all tabs', '', () => closeEach([...docs])],
  ['Reopen closed tab', 'Ctrl+Shift+T', reopenClosed],
  ['Reload from disk', '', () => active && reloadFromDisk(active, { force: true })],
  ['Show in File Explorer', '', () => active?.path && api.reveal(active.path)],
  ['Copy file path', '', () => active?.path && copyPath(active.path)],
  ['Find in files…', 'Ctrl+Shift+F', openFindInFiles],
  ['Go to line…', 'Ctrl+G', () => openGoTo(':')],
  ['Go to symbol…', 'Ctrl+R', () => openGoTo('@')],
  ['Find', 'Ctrl+F', () => active && openSearchPanel(view)],
  ['Find and replace', 'Ctrl+H', () => active && openSearchPanel(view)],
  ['Toggle sidebar', 'Ctrl+B', () => setSetting('sidebar', !settings.sidebar)],
  ['Toggle Markdown preview', 'Ctrl+Shift+M', () => setSetting('preview', !settings.preview)],
  ['Print…', '', () => printDoc()],
  ['Export…', 'Ctrl+Shift+E', openExport],
  ['Export as PDF', '', () => exportAs('pdf')],
  ['Export as web page (HTML)', '', () => exportAs('html')],
  ['Export as Word document', '', () => exportAs('docx')],
  ['Export as plain text', '', () => exportAs('txt')],
  ['Convert CSV to JSON', '', () => convert(csvToJson, 'json')],
  ['Convert JSON to CSV', '', () => convert(jsonToCsv, 'csv')],
  ['Choose theme…', '', openThemes],
  ['Run setup again…', '', openSetup],
  ['Layout: page', '', () => setLayout('page')],
  ['Layout: classic', '', () => setLayout('classic')],
  ['Layout: focus', 'Ctrl+K Z', () => setLayout('focus')],
  ['Toggle focus mode', 'F11', toggleZen],
  ['Reading font: serif', '', () => setSetting('font', 'serif')],
  ['Reading font: sans', '', () => setSetting('font', 'sans')],
  ['Reading font: mono', '', () => setSetting('font', 'mono')],
  ['Toggle start with a blank page', '', () => { setSetting('startBlank', !settings.startBlank); flash(settings.startBlank ? 'Starts with a blank page' : 'Starts where you left off'); }],
  ['Check for updates', '', checkForUpdates],
  ['Toggle word wrap', 'Alt+Z', toggleWrap],
  ['Toggle line numbers', '', toggleLineNums],
  ['Toggle spellcheck', '', () => { setSetting('spellcheck', !settings.spellcheck); flash(settings.spellcheck ? 'Spellcheck on for prose' : 'Spellcheck off'); }],
  ['Toggle show whitespace', '', () => setSetting('showWhitespace', !settings.showWhitespace)],
  ['Toggle save when Recto loses focus', '', () => { setSetting('saveOnBlur', !settings.saveOnBlur); flash(settings.saveOnBlur ? 'Saves when you switch away' : "Won't save when you switch away"); }],
  ['Toggle trim spaces on save', '', () => { setSetting('trimOnSave', !settings.trimOnSave); flash(settings.trimOnSave ? 'Trims on save' : "Won't trim on save"); }],
  ['Theme: light', '', () => setSetting('theme', 'light')],
  ['Theme: dark', '', () => setSetting('theme', 'dark')],
  ['Theme: match Windows', '', () => setSetting('theme', 'system')],
  ['Zoom in', 'Ctrl+=', () => zoom(1)],
  ['Zoom out', 'Ctrl+-', () => zoom(-1)],
  ['Reset zoom', 'Ctrl+0', () => zoom(0)],
  ['Set language…', '', () => active && pickLanguage()],
  ['Set indent…', '', () => active && pickIndent()],
  ['Line endings: CRLF (Windows)', '', () => active && setEol('\r\n')],
  ['Line endings: LF (Unix)', '', () => active && setEol('\n')],
  ['Set encoding…', '', () => active && pickEncoding()],
  ['Sort lines', 'F9', () => lines(ls => [...ls].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))],
  ['Sort lines (case sensitive)', '', () => lines(ls => [...ls].sort())],
  ['Reverse lines', '', () => lines(ls => [...ls].reverse())],
  ['Remove duplicate lines', '', () => lines(ls => [...new Set(ls)])],
  ['Remove blank lines', '', () => lines(ls => ls.filter(l => l.trim()))],
  ['Shuffle lines', '', () => lines(ls => ls.map(l => [Math.random(), l]).sort((a, b) => a[0] - b[0]).map(x => x[1]))],
  ['Join lines', 'Ctrl+J', joinLines],
  ['Split selection into lines', 'Ctrl+Shift+L', () => {}],
  ['UPPERCASE', 'Ctrl+K Ctrl+U', () => text(s => s.toUpperCase())],
  ['lowercase', 'Ctrl+K Ctrl+L', () => text(s => s.toLowerCase())],
  ['Title Case', '', () => text(s => s.toLowerCase().replace(/(^|[\s\-_])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()))],
  ['Tools: camelCase', '', () => text(s => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''))],
  ['Tools: snake_case', '', () => text(s => words(s).join('_'))],
  ['Tools: kebab-case', '', () => text(s => words(s).join('-'))],
  ['Tools: Trim trailing spaces', '', () => wholeOrSelection(trimmed)],
  ['Tools: Format JSON', '', () => json(2)],
  ['Tools: Minify JSON', '', () => json(0)],
  ['Tools: Base64 encode', '', () => text(s => btoa(String.fromCharCode(...new TextEncoder().encode(s))))],
  ['Tools: Base64 decode', '', () => text(s => new TextDecoder().decode(Uint8Array.from(atob(s.trim()), c => c.charCodeAt(0))))],
  ['Tools: URL encode', '', () => text(encodeURIComponent)],
  ['Tools: URL decode', '', () => text(decodeURIComponent)],
  ['Insert date', '', () => insert(new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }))],
  ['Insert date and time', '', () => insert(new Date().toLocaleString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }))],
  ['Tools: Insert UUID', '', () => insert(crypto.randomUUID())],
  ['Keyboard shortcuts', 'F1', showShortcuts],
];

function commandItems(q) {
  const list = COMMANDS.filter(([label]) => label !== 'Split selection into lines').map(([label, key, run]) => ({ label, key, run }));
  return rank(list, q.trim());
}

function openCommands() {
  openPalette({ placeholder: 'Run a command', source: commandItems });
}

function reopenClosed() {
  const p = closedStack.pop();
  if (p) openPath(p);
}

// ---------- text transforms ----------
function words(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Apply fn to each selection, or to the word under each cursor.
function text(fn) {
  if (!active) return;
  const st = view.state;
  try {
    view.dispatch(st.changeByRange(r => {
      const range = r.empty ? st.wordAt(r.head) || r : r;
      const out = fn(st.sliceDoc(range.from, range.to));
      return { changes: { from: range.from, to: range.to, insert: out }, range: EditorSelection.range(range.from, range.from + out.length) };
    }));
  } catch (err) {
    toast(`That didn't work: ${err.message}`);
  }
}

function wholeOrSelection(fn) {
  if (!active) return;
  const st = view.state;
  const r = st.selection.main;
  const [from, to] = r.empty ? [0, st.doc.length] : [st.doc.lineAt(r.from).from, st.doc.lineAt(r.to).to];
  try {
    const out = fn(st.sliceDoc(from, to));
    view.dispatch({ changes: { from, to, insert: out } });
  } catch (err) {
    toast(`That didn't work: ${err.message}`);
  }
}

function lines(fn) {
  wholeOrSelection(s => fn(s.split('\n')).join('\n'));
}

function json(indent) {
  wholeOrSelection(s => JSON.stringify(JSON.parse(s), null, indent));
  if (indent && active.lang === 'text') setLanguage('json');
}

function insert(s) {
  if (!active) return;
  view.dispatch(view.state.replaceSelection(s));
  view.focus();
}

function joinLines(v = view) {
  const st = v.state;
  v.dispatch(st.changeByRange(r => {
    const first = st.doc.lineAt(r.from);
    const last = st.doc.lineAt(r.to);
    const end = last.number === first.number ? Math.min(first.number + 1, st.doc.lines) : last.number;
    if (end === first.number) return { range: r };
    const changes = [];
    for (let n = first.number; n < end; n++) {
      const a = st.doc.line(n), b = st.doc.line(n + 1);
      const lead = /^\s*/.exec(b.text)[0].length;
      changes.push({ from: a.to - (/\s*$/.exec(a.text)[0].length), to: b.from + lead, insert: ' ' });
    }
    return { changes, range: r };
  }));
  return true;
}

// ---------- settings, theme, zoom ----------
function setSetting(key, value) {
  settings[key] = value;
  api.saveSettings({ [key]: value });
  applySettings();
}

function isDark() {
  return settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
}

const FONTS = {
  serif: "'Sitka Text', Georgia, Cambria, serif",
  sans: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  mono: 'var(--font-mono)',
};

function applySettings() {
  const dark = isDark();
  const root = document.documentElement;
  zen = settings.layout === 'focus';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.tone = settings.tone;
  root.style.setProperty('--font-read', FONTS[settings.font] || FONTS.serif);
  document.body.classList.toggle('layout-page', settings.layout === 'page');
  const css = getComputedStyle(root);
  api.setTheme({ dark, bg: css.getPropertyValue('--page').trim(), fg: css.getPropertyValue('--text-3').trim() });
  document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
  document.body.classList.toggle('with-sidebar', settings.sidebar && !zen);
  document.body.classList.toggle('with-preview', settings.preview && !zen);
  document.body.classList.toggle('zen', zen);
  if (active) view.dispatch({ effects: docEffects(active) });
  renderSidebar();
  if (settings.preview) renderPreview();
  view.requestMeasure();
}

function zoom(dir) {
  const size = dir === 0 ? 14 : Math.max(9, Math.min(32, settings.fontSize + dir));
  setSetting('fontSize', size);
  flash(`${size} px`);
}

function setLayout(layout) {
  if (layout === 'focus' && settings.layout !== 'focus') settings.prevLayout = settings.layout;
  api.saveSettings({ prevLayout: settings.prevLayout });
  setSetting('layout', layout);
  flash(layout === 'focus' ? 'Focus mode. Esc to leave' : `${layout[0].toUpperCase() + layout.slice(1)} layout`);
}

function toggleZen() {
  setLayout(zen ? settings.prevLayout || 'classic' : 'focus');
}

function toggleLineNums() {
  const key = active && PROSE.has(active.lang) ? 'proseLineNums' : 'lineNums';
  setSetting(key, !settings[key]);
  flash(settings[key] ? 'Line numbers on' : 'Line numbers off');
}

// ---------- viewer: images, PDFs, CSV tables ----------
const viewerEl = $('#viewer');
// file:///C:/My%20Notes/a.png, each folder name encoded, the drive letter left alone.
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i ? encodeURIComponent(s) : s)).join('/');
const isCsv = d => !!d && /\.(csv|tsv)$/i.test(d.path || d.title || '');
const sepFor = d => (/\.tsv$/i.test(d.path || d.title || '') ? '\t' : ',');
const showsViewer = d => !!d && (!!d.view || (isCsv(d) && d.table !== false));

function renderViewer() {
  const d = active;
  const on = showsViewer(d);
  viewerEl.hidden = !on;
  $('#editor').hidden = !d || on;
  $('#editor').classList.toggle('prose', !!d && PROSE.has(d.lang));
  viewerEl.textContent = '';
  viewerEl.className = on ? 'viewer-' + (d.view || 'table') : '';
  if (!on) return;
  if (d.view === 'image') {
    const img = new Image();
    img.src = fileUrl(d.path) + '?v=' + d.mtime;
    img.alt = docName(d);
    viewerEl.append(img);
  } else if (d.view === 'pdf') {
    const f = document.createElement('iframe');
    f.src = fileUrl(d.path);
    f.title = docName(d);
    viewerEl.append(f);
  } else {
    viewerEl.append(csvTable(textOf(d).toString(), sepFor(d)));
  }
}

// ponytail: shows the first 2000 rows; a virtual list if people open huge spreadsheets.
const TABLE_ROWS = 2000;
function csvTable(text, sep) {
  const rows = parseCsv(text, sep);
  const table = document.createElement('table');
  rows.slice(0, TABLE_ROWS).forEach((r, i) => {
    const tr = table.insertRow();
    for (const c of r) {
      const cell = document.createElement(i ? 'td' : 'th');
      cell.textContent = c;
      tr.append(cell);
    }
  });
  if (rows.length > TABLE_ROWS) {
    const cap = table.createCaption();
    cap.textContent = `Showing the first ${TABLE_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows. "View as text" shows them all.`;
  }
  return table;
}

function toggleTable() {
  if (!isCsv(active)) return;
  active.table = !showsViewer(active);
  renderViewer();
  renderStatus();
  if (!active.table) view.focus();
  scheduleSession();
}

// ---------- print, export, convert ----------
const EXPORTS = {
  pdf: { label: 'PDF', name: 'PDF', ext: 'pdf' },
  html: { label: 'Web page (HTML)', name: 'Web page', ext: 'html' },
  docx: { label: 'Word document', name: 'Word document', ext: 'docx' },
  txt: { label: 'Plain text', name: 'Plain text', ext: 'txt' },
};

const stemOf = d => docName(d).replace(/\.[^.]+$/, '') || 'untitled';

function pageOf(d) {
  return {
    text: textOf(d).toString(),
    markdown: d.lang === 'markdown',
    mono: !PROSE.has(d.lang),
    title: stemOf(d),
  };
}

// `to` skips the save dialog (the smoke test uses it).
async function exportAs(kind, { d = active, to } = {}) {
  if (!d) return false;
  if (d.view) { flash('Nothing to export here'); return false; }
  const { name, ext } = EXPORTS[kind];
  const dir = d.path ? dirname(d.path) : d.near || settings.folder;
  const p = to || await api.saveDialog((dir ? dir + '\\' : '') + stemOf(d) + '.' + ext, [{ name, extensions: [ext] }]);
  if (!p) return false;
  const page = pageOf(d);
  let r;
  if (kind === 'pdf') r = await api.printPdf(docHtml({ ...page, base: d.path ? fileUrl(dirname(d.path)) + '/' : '' }), p);
  else if (kind === 'docx') r = await api.writeZip(p, docxParts(page.text, page.markdown));
  else {
    const out = kind === 'html' ? docHtml(page) : page.markdown ? markdownText(page.text) : page.text;
    r = await api.writeFile(p, kind === 'txt' ? out.replace(/\n/g, d.eol) : out, 'utf8', false);
  }
  if (!r.ok) { toast(`Couldn't export: ${r.error}`); return false; }
  flash(`Exported ${basename(p)}`);
  return p;
}

async function printDoc(d = active) {
  if (!d) return false;
  if (d.view) { flash('Open this one in another app to print it'); return false; }
  const r = await api.printDoc(docHtml({ ...pageOf(d), base: d.path ? fileUrl(dirname(d.path)) + '/' : '' }));
  if (!r.ok && r.error !== 'cancelled') toast(`Couldn't print: ${r.error}`);
  return r.ok;
}

function openExport() {
  if (!active || active.view) return;
  openPalette({
    placeholder: `Export ${docName(active)} as…`,
    source: q => rank([
      ...Object.entries(EXPORTS).map(([kind, e]) => ({ label: e.label, detail: '.' + e.ext, run: () => exportAs(kind) })),
      { label: 'Print…', run: () => printDoc() },
    ], q.trim()),
  });
}

// The result opens in a new tab, so the original is never changed.
function convert(fn, ext, d = active) {
  if (!d || d.view) return null;
  let out;
  try {
    out = fn(textOf(d).toString(), sepFor(d));
  } catch (err) {
    toast(`That didn't convert: ${err.message}`);
    return null;
  }
  const n = newDoc({ text: out.replace(/\r\n?/g, '\n'), title: `${stemOf(d)}.${ext}` });
  n.near = d.path ? dirname(d.path) : d.near;
  docs.push(n);
  activate(n);
  return n;
}

// ---------- theme picker ----------
const TONES = [['warm', 'Paper', 'Ink'], ['cool', 'Cloud', 'Slate'], ['sage', 'Sage', 'Forest'], ['rose', 'Rose', 'Plum']];
const themesEl = $('#themes');

function openThemes() {
  const grid = themesEl.querySelector('.swatches');
  grid.textContent = '';
  const dark = isDark();
  for (const [tone, ...names] of TONES) {
    ['light', 'dark'].forEach((theme, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      if (settings.tone === tone && dark === (theme === 'dark')) b.classList.add('current');
      const page = document.createElement('span');
      page.className = 'sample';
      // The tokens go on the sample only, so the label keeps the dialog's colours.
      page.dataset.tone = tone;
      page.dataset.theme = theme;
      page.innerHTML = '<i></i><i></i><i></i><b></b>';
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = names[i];
      b.append(page, label);
      b.addEventListener('click', () => pickTheme(tone, theme));
      grid.append(b);
    });
  }
  themesEl.querySelector('.follow').setAttribute('aria-pressed', settings.theme === 'system');
  if (!themesEl.open) themesEl.showModal();
  (grid.querySelector('.current') || grid.firstChild).focus();
}

function pickTheme(tone, theme) {
  Object.assign(settings, { tone, theme });
  api.saveSettings({ tone, theme });
  applySettings();
  themesEl.close();
}

themesEl.addEventListener('click', e => { if (e.target === themesEl) themesEl.close(); });
themesEl.querySelector('.follow').addEventListener('click', () => {
  setSetting('theme', settings.theme === 'system' ? (isDark() ? 'dark' : 'light') : 'system');
  openThemes();
});
themesEl.addEventListener('close', () => { if (active) view.focus(); });

api.onSystemTheme(dark => { systemDark = dark; applySettings(); });

// ---------- first-run setup: a note to Recto ----------
// Every pick applies straight away, so the note restyles itself as you write it.
const setupEl = $('#setup');
const setupForm = setupEl.querySelector('form');
for (const [tone, ...names] of TONES) {
  ['light', 'dark'].forEach((theme, i) => setupForm.look.add(new Option(names[i], `${tone}:${theme}`)));
}

function openSetup() {
  const f = setupForm;
  f.look.value = `${settings.tone}:${isDark() ? 'dark' : 'light'}`;
  f.layout.value = settings.layout;
  f.font.value = settings.font;
  f.menu.value = settings.shellMenu === false ? 'off' : 'on';
  f.desktop.value = settings.desktopShortcut === false ? 'off' : 'on';
  f.start.value = settings.startBlank ? 'blank' : 'resume';
  if (!setupEl.open) setupEl.showModal();
  f.querySelector('.go').focus();
}

setupForm.addEventListener('change', e => {
  const { name, value } = e.target;
  if (name === 'look') pickTheme(...value.split(':'));
  if (name === 'layout') setLayout(value);
  if (name === 'font') setSetting('font', value);
  if (name === 'start') setSetting('startBlank', value === 'blank');
});

// Sounds good, Skip and Esc all count as done, so the note only ever shows once by itself.
setupEl.addEventListener('close', async () => {
  settings.setupDone = true;
  const save = { setupDone: true };
  if (setupEl.returnValue === 'done') {
    Object.assign(save, { shellMenu: setupForm.menu.value === 'on', desktopShortcut: setupForm.desktop.value === 'on' });
    Object.assign(settings, save);
    await api.setupShell({ menu: save.shellMenu, desktop: save.desktopShortcut });
  }
  setupEl.returnValue = '';
  api.saveSettings(save);
  if (active) view.focus();
});

// ---------- sidebar ----------
async function setFolder(p) {
  settings.folder = p;
  folderFiles = null;
  expanded.clear();
  api.saveSettings({ folder: p });
  if (p) {
    settings.recentFolders = [p, ...settings.recentFolders.filter(x => x.toLowerCase() !== p.toLowerCase())].slice(0, 10);
    api.saveSettings({ recentFolders: settings.recentFolders });
    renderRecent();
    if (!settings.sidebar) setSetting('sidebar', true);
    loadFolderFiles();
  }
  renderSidebar();
  renderStatus();
}

async function loadFolderFiles() {
  if (settings.folder) folderFiles = await api.folderFiles(settings.folder);
}

let sidebarToken = 0;
async function renderSidebar() {
  if (!settings.sidebar || zen) return;
  const token = ++sidebarToken;
  const frag = document.createDocumentFragment();
  if (!settings.folder) {
    const empty = document.createElement('div');
    empty.className = 'side-empty';
    const b = document.createElement('button');
    b.textContent = 'Open a folder';
    b.addEventListener('click', async () => { const p = await api.folderDialog(); if (p) setFolder(p); });
    empty.append(b);
    frag.append(empty);
  } else {
    const head = document.createElement('div');
    head.className = 'side-head';
    head.textContent = basename(settings.folder);
    head.title = settings.folder;
    frag.append(head);
    const tree = document.createElement('div');
    tree.className = 'tree';
    await addEntries(tree, settings.folder, 0, token);
    frag.append(tree);
  }
  if (token !== sidebarToken) return;
  const keep = sidebarEl.querySelector('.tree')?.scrollTop || 0;
  sidebarEl.textContent = '';
  sidebarEl.append(frag);
  const tree = sidebarEl.querySelector('.tree');
  if (tree) tree.scrollTop = keep;
}

async function addEntries(parent, dir, depth, token) {
  const entries = await api.listFolder(dir);
  if (token !== sidebarToken) return;
  for (const e of entries) {
    const row = document.createElement('button');
    row.className = 'row' + (e.dir ? ' dir' : '') + (active?.path === e.path ? ' current' : '');
    if (e.dir && expanded.has(e.path)) row.classList.add('open');
    row.style.paddingLeft = 14 + depth * 14 + 'px';
    row.textContent = e.name;
    row.title = e.path;
    row.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      showMenu(ev.clientX, ev.clientY, [
        !e.dir && { label: 'Open', run: () => openPath(e.path) },
        { label: 'Copy path', run: () => copyPath(e.path) },
        { label: 'Show in File Explorer', run: () => api.reveal(e.path) },
      ]);
    });
    row.addEventListener('click', () => {
      if (e.dir) {
        if (expanded.has(e.path)) expanded.delete(e.path); else expanded.add(e.path);
        renderSidebar();
      } else openPath(e.path);
    });
    parent.append(row);
    if (e.dir && expanded.has(e.path)) await addEntries(parent, e.path, depth + 1, token);
  }
}

// ---------- markdown preview ----------
let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}

function renderPreview() {
  const frame = previewEl.querySelector('iframe');
  if (!active || active.lang !== 'markdown') {
    frame.srcdoc = `<body style="font:13px system-ui;color:#888;display:grid;place-items:center;height:90vh;margin:0">Preview shows Markdown files.</body>`;
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  const base = active.path ? 'file:///' + dirname(active.path).replace(/\\/g, '/') + '/' : '';
  const body = marked.parse(view.state.doc.toString(), { gfm: true, breaks: false });
  const prev = frame.contentDocument?.scrollingElement;
  const ratio = prev ? prev.scrollTop / Math.max(1, prev.scrollHeight - prev.clientHeight) : 0;
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"${base ? ` href="${encodeURI(base)}"` : ''}>
<style>
  html{background:${v('--page')};color:${v('--text')}}
  body{font:16px/1.65 "Segoe UI",system-ui,sans-serif;max-width:680px;margin:0 auto;padding:28px 32px 80px}
  h1,h2,h3{font-weight:600;line-height:1.25;margin:1.6em 0 .5em}body>:first-child{margin-top:0}
  h1{font-size:1.75em}h2{font-size:1.35em;padding-bottom:.3em;border-bottom:1px solid ${v('--line')}}h3{font-size:1.1em}
  a{color:${v('--ink')}}p,ul,ol,pre,blockquote,table{margin:0 0 1em}
  code{font:.88em ${v('--font-mono')};background:${v('--surface-2')};padding:.1em .35em}
  pre{background:${v('--surface-2')};padding:14px 16px;overflow:auto}pre code{background:none;padding:0}
  blockquote{margin-left:0;padding-left:16px;border-left:2px solid ${v('--line-strong')};color:${v('--text-2')}}
  hr{border:0;border-top:1px solid ${v('--line')};margin:2em 0}img{max-width:100%}
  table{border-collapse:collapse}td,th{border:1px solid ${v('--line')};padding:6px 10px}
  ::selection{background:${v('--mark-strong')}}
</style></head><body>${body}</body></html>`;
  frame.onload = () => {
    const se = frame.contentDocument?.scrollingElement;
    if (se) se.scrollTop = ratio * (se.scrollHeight - se.clientHeight);
  };
}

// Keep the preview roughly in step with the editor.
view.scrollDOM.addEventListener('scroll', () => {
  if (!settings.preview) return;
  const se = previewEl.querySelector('iframe').contentDocument?.scrollingElement;
  const s = view.scrollDOM;
  if (se) se.scrollTop = (s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight)) * (se.scrollHeight - se.clientHeight);
}, { passive: true });

// ---------- right-click menus ----------
const menuEl = $('#menu');

// items: [{ label, key, run }], '-' for a divider; falsy items are skipped.
function showMenu(x, y, items) {
  menuEl.textContent = '';
  for (const it of items) {
    if (!it) continue;
    // No divider at the top or two in a row.
    if (it === '-' && (!menuEl.lastChild || menuEl.lastChild.tagName === 'HR')) continue;
    const li = document.createElement(it === '-' ? 'hr' : 'button');
    if (it !== '-') {
      li.setAttribute('role', 'menuitem');
      li.textContent = it.label;
      if (it.key) { const k = document.createElement('kbd'); k.textContent = it.key; li.append(k); }
      if (it.cls) li.className = it.cls;
      // mousedown, not click, and no focus change, so the editor keeps its selection.
      li.addEventListener('mousedown', e => { e.preventDefault(); closeMenu(); it.run(); });
    }
    menuEl.append(li);
  }
  if (menuEl.lastChild?.tagName === 'HR') menuEl.lastChild.remove();
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
}

function closeMenu() {
  menuEl.hidden = true;
}

window.addEventListener('mousedown', e => { if (!menuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
// A narrower window can push the active tab out of sight.
window.addEventListener('resize', () => tabsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
document.addEventListener('scroll', closeMenu, true);

// The only time Recto talks to the internet, and only because you asked.
async function checkForUpdates() {
  flash('Checking…');
  const r = await api.checkUpdate();
  if (r.error) return toast(r.error);
  if (!r.newer) return toast(`You're on the latest version (${r.current}).`);
  toast(`Recto ${r.latest} is out. You have ${r.current}. Opening the download page.`);
  api.openUpdate();
}

function copyPath(p) {
  navigator.clipboard.writeText(p).then(() => flash('Path copied'));
}

// The editor and inputs: main tells us what was under the mouse.
api.onContextMenu(p => {
  if (!p.editable && !p.selection) return;
  const act = name => () => api.editAction(name);
  showMenu(p.x, p.y, [
    ...p.suggestions.map(s => ({ label: s, cls: 'suggest', run: () => api.editAction('replace', s) })),
    p.word && !p.suggestions.length && { label: 'No suggestions', cls: 'muted', run: () => {} },
    p.word && { label: `Add "${p.word}" to dictionary`, run: () => api.editAction('learn', p.word) },
    p.word && '-',
    p.editable && p.selection && { label: 'Cut', key: 'Ctrl+X', run: act('cut') },
    p.selection && { label: 'Copy', key: 'Ctrl+C', run: act('copy') },
    p.editable && { label: 'Paste', key: 'Ctrl+V', run: act('paste') },
    p.editable && '-',
    p.editable && { label: 'Select all', key: 'Ctrl+A', run: act('selectAll') },
  ]);
});

function tabMenu(d, x, y) {
  const i = docs.indexOf(d);
  showMenu(x, y, [
    { label: d.pinned ? 'Unpin' : 'Pin', run: () => togglePin(d) },
    { label: 'Close', key: 'Ctrl+W', run: () => closeDoc(d) },
    { label: 'Close others', run: () => closeEach(docs.filter(t => t !== d)) },
    i < docs.length - 1 && { label: 'Close tabs to the right', run: () => closeEach(docs.slice(i + 1)) },
    '-',
    d.path && { label: 'Copy path', run: () => copyPath(d.path) },
    d.path && { label: 'Show in File Explorer', run: () => api.reveal(d.path) },
    d.path && '-',
    { label: 'Reopen closed tab', key: 'Ctrl+Shift+T', run: reopenClosed },
  ]);
}

// ---------- find in files ----------
function openFindInFiles() {
  const sel = active && view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const folder = settings.folder;
  let wait = 0;
  openPalette({
    placeholder: folder ? `Find in ${basename(folder)}` : 'Find in open files',
    value: sel && !sel.includes('\n') ? sel : '',
    source: q => {
      if (q.length < 2) return [{ label: 'Type at least 2 characters', run: () => view.focus() }];
      if (!folder) return matchItems(searchOpenDocs(q), q);
      // Wait for a short pause in typing before reading files from disk.
      clearTimeout(wait);
      return new Promise(r => { wait = setTimeout(r, 150); })
        .then(() => api.searchFolder(folder, q))
        .then(hits => hits && matchItems(hits, q));
    },
  });
}

function searchOpenDocs(q) {
  const fold = q === q.toLowerCase();
  const out = [];
  for (const d of docs) {
    const doc = textOf(d);
    for (let n = 1; n <= doc.lines && out.length < 300; n++) {
      const text = doc.line(n).text;
      const col = (fold ? text.toLowerCase() : text).indexOf(q);
      if (col >= 0) out.push({ doc: d, path: d.path, line: n, col, text: text.slice(0, 300) });
    }
  }
  return out;
}

function matchItems(hits, q) {
  return hits.map(h => {
    const lead = h.text.length - h.text.trimStart().length;
    const at = h.col - lead;
    const where = h.path ? relativeTo(settings.folder, h.path) : docName(h.doc);
    return {
      label: h.text.trim(),
      hits: Array.from({ length: q.length }, (_, i) => at + i),
      detail: `${where}:${h.line}`,
      run: async () => {
        const d = h.doc && !h.path ? (activate(h.doc), h.doc) : await openPath(h.path);
        if (!d) return;
        const line = view.state.doc.line(Math.min(h.line, view.state.doc.lines));
        const from = Math.min(line.from + h.col, line.to);
        view.dispatch({ selection: { anchor: from, head: Math.min(from + q.length, line.to) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
        view.focus();
      },
    };
  });
}

// ---------- empty state ----------
function renderRecent() {
  const box = $('#recent');
  const ul = box.querySelector('ul');
  ul.textContent = '';
  for (const p of settings.recent.slice(0, 6)) {
    const li = document.createElement('li');
    li.title = p;
    const name = document.createElement('span');
    name.textContent = basename(p);
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = dirname(p).replace(/^C:\\Users\\[^\\]+/i, '~');
    li.append(name, dir);
    li.addEventListener('click', () => openPath(p));
    ul.append(li);
  }
  box.hidden = !ul.children.length;

  const fbox = $('#recent-folders');
  const ful = fbox.querySelector('ul');
  ful.textContent = '';
  for (const p of settings.recentFolders.slice(0, 3)) {
    const li = document.createElement('li');
    li.title = p;
    const name = document.createElement('span');
    name.textContent = basename(p);
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = dirname(p).replace(/^C:\\Users\\[^\\]+/i, '~');
    li.append(name, dir);
    li.addEventListener('click', () => openFolder(p));
    ful.append(li);
  }
  fbox.hidden = !ful.children.length;
}

// A folder that's gone gets dropped from the list instead of failing every time.
async function openFolder(p) {
  const r = await api.readFile(p);
  if (r.dir) return setFolder(p);
  settings.recentFolders = settings.recentFolders.filter(x => x.toLowerCase() !== p.toLowerCase());
  api.saveSettings({ recentFolders: settings.recentFolders });
  renderRecent();
  toast(`${basename(p)}: that folder isn't there any more.`);
}

function openRecentFolder() {
  const list = settings.recentFolders.map(p => ({ label: p, detail: p === settings.folder ? 'current' : '', run: () => openFolder(p) }));
  openPalette({
    placeholder: list.length ? 'Open a recent folder' : 'No recent folders yet. Use Open folder…',
    source: q => rank(list, q),
  });
}

// ---------- save when Recto loses focus ----------
window.addEventListener('blur', () => {
  if (settings.saveOnBlur) for (const d of docs) if (d.path && isDirty(d)) save(d);
});

// ---------- shortcuts ----------
function showShortcuts() {
  const list = [
    ['Ctrl+P', 'Go to file ( : line, @ symbol)'], ['Ctrl+Shift+P', 'Commands'], ['Ctrl+N / O / S', 'New, open, save'],
    ['Ctrl+W', 'Close tab'], ['Ctrl+Shift+T', 'Reopen closed tab'], ['Ctrl+Tab', 'Next tab'], ['Ctrl+1–9', 'Jump to tab'],
    ['Ctrl+F / H', 'Find, replace'], ['Ctrl+Shift+F', 'Find in files'], ['Ctrl+D', 'Select next match'], ['Ctrl+Shift+L', 'Cursor on each line'],
    ['Alt+drag', 'Column select'], ['Ctrl+Shift+D', 'Duplicate line'], ['Ctrl+Shift+K', 'Delete line'],
    ['Ctrl+Shift+↑ ↓', 'Move line'], ['Ctrl+/', 'Toggle comment'], ['Ctrl+J', 'Join lines'], ['Ctrl+L', 'Select line'],
    ['Ctrl+G / R', 'Go to line, symbol'], ['Ctrl+B', 'Sidebar'], ['Ctrl+Shift+M', 'Markdown preview'],
    ['Ctrl+K Z / F11', 'Focus mode'], ['Alt+Z', 'Word wrap'], ['Ctrl+= / - / 0', 'Zoom'], ['Ctrl+Shift+E', 'Export or print'],
  ];
  openPalette({ placeholder: 'Keyboard shortcuts', source: q => rank(list.map(([k, label]) => ({ label, key: k, run: () => view.focus() })), q) });
}

let chord = 0;
const chordKeys = {
  z: toggleZen,
  b: () => setSetting('sidebar', !settings.sidebar),
  u: () => text(s => s.toUpperCase()),
  l: () => text(s => s.toLowerCase()),
};

window.addEventListener('keydown', e => {
  if (paletteOpen() || document.querySelector('dialog[open]')) return;
  if (!menuEl.hidden) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } return; }
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (chord) {
    chord = 0;
    $('#chord').hidden = true;
    if (chordKeys[k]) { e.preventDefault(); e.stopPropagation(); chordKeys[k](); }
    return;
  }
  let run = null;
  if (ctrl && !e.altKey) {
    if (e.shiftKey) {
      run = { p: openCommands, f: openFindInFiles, s: () => save(active, { as: true }), t: reopenClosed, e: openExport, m: () => setSetting('preview', !settings.preview), tab: () => cycle(-1) }[k];
    } else {
      run = {
        n: newFile, o: openDialog, s: () => save(), w: () => active && closeDoc(active), p: () => openGoTo(),
        g: () => openGoTo(':'), r: () => openGoTo('@'), b: () => setSetting('sidebar', !settings.sidebar),
        tab: () => cycle(1), pagedown: () => cycle(1), pageup: () => cycle(-1), j: () => active && joinLines(),
        '=': () => zoom(1), '+': () => zoom(1), '-': () => zoom(-1), 0: () => zoom(0),
        k: () => { chord = 1; $('#chord').hidden = false; setTimeout(() => { chord = 0; $('#chord').hidden = true; }, 1500); },
      }[k];
      if (!run && !active && (k === 'f' || k === 'h')) run = () => flash('Open a file first, then search in it');
      if (!run && /^[1-9]$/.test(k)) run = () => { const d = k === '9' ? docs.at(-1) : docs[Number(k) - 1]; if (d) activate(d); };
    }
  } else if (e.altKey && !ctrl && k === 'z') run = toggleWrap;
  else if (e.key === 'F1') run = showShortcuts;
  else if (e.key === 'F9') run = () => lines(ls => [...ls].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  else if (e.key === 'F11') run = toggleZen;
  else if (e.key === 'Escape' && zen && !document.querySelector('.cm-panel')) run = toggleZen;
  if (run) { e.preventDefault(); e.stopPropagation(); run(); }
}, true);

window.addEventListener('wheel', e => {
  if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }
}, { passive: false });

document.addEventListener('palette-closed', () => { if (active && document.activeElement === document.body) view.focus(); });

$('#brand').addEventListener('click', openCommands);
emptyEl.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'new') newFile();
  if (act === 'open') openDialog();
  if (act === 'goto') openGoTo();
  if (act === 'commands') openCommands();
});

// ---------- start ----------
(async () => {
  const st = await api.loadState();
  settings = { ...settings, ...st.settings };
  systemDark = st.systemDark;
  $('#version').textContent = 'v' + st.version;
  applySettings();
  await restoreSession(st.session);
  for (const p of st.files) await openPath(p);
  if (settings.folder) loadFolderFiles();
  // A blank start opens a fresh page even when unsaved drafts came back, unless a file was opened.
  if (settings.startBlank && !st.files.length) newFile();
  else if (!active) activate(null);
  document.body.classList.add('ready');
  if (!settings.setupDone) openSetup();
})();

// Exposed for the smoke test in tests/app-check.mjs.
window.__recto = {
  docs: () => docs, active: () => active, view, openPath, newFile, save, closeDoc, sessionData, isDirty, setSetting,
  undo: () => undo(view), settings: () => settings, pickEncoding, openFindInFiles, tabMenu,
  exportAs, printDoc, openExport, convert, csvToJson, jsonToCsv, openThemes, pickTheme, setLayout, toggleZen, toggleTable,
  toggleLineNums, restoreSession, openSetup, checkForUpdates,
};
