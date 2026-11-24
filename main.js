// Recto main process: window, files, settings and session on disk.
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, Menu, session, screen, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('./encoding');
const { zip, docxText } = require('./zip');
const { menuCommands } = require('./winmenu');
const { execFile } = require('child_process');

const userDir = app.getPath('userData');
const settingsFile = path.join(userDir, 'settings.json');
const sessionFile = path.join(userDir, 'session.json');

// The app used to be called Fude. Bring its settings and unsaved tabs across once.
const oldDir = path.join(app.getPath('appData'), 'Fude');
for (const f of ['settings.json', 'session.json']) {
  const from = path.join(oldDir, f), to = path.join(userDir, f);
  try { if (!fs.existsSync(to) && fs.existsSync(from)) { fs.mkdirSync(userDir, { recursive: true }); fs.copyFileSync(from, to); } } catch {}
}
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', 'out', 'target']);
const MAX_BYTES = 50 * 1024 * 1024;

let win = null;
let pendingFiles = filesFromArgv(process.argv);

if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', (_e, argv) => {
  const files = filesFromArgv(argv);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  if (files.length) win.webContents.send('open-files', files);
});

function filesFromArgv(argv) {
  // Skip the exe (and "." when run with `electron .`), keep real files.
  return argv.slice(1).filter(a => !a.startsWith('-') && a !== '.' && fs.existsSync(a)).map(a => path.resolve(a));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  // Write to a temp file first so a crash mid-write never leaves half a file.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// First-paint colours; the renderer sends the real ones from its CSS once it loads.
const START = {
  warm: [{ bg: '#f5f2eb', fg: '#5f5a51' }, { bg: '#151413', fg: '#b0a99d' }],
  cool: [{ bg: '#fbfbfc', fg: '#5d6370' }, { bg: '#111317', fg: '#a3a9b5' }],
  sage: [{ bg: '#f1f3ec', fg: '#59614f' }, { bg: '#121512', fg: '#a2ab9c' }],
  rose: [{ bg: '#f8f1ef', fg: '#6b5a58' }, { bg: '#161218', fg: '#ad9fae' }],
};
const startColours = (dark, tone) => (START[tone] || START.warm)[dark ? 1 : 0];

function createWindow() {
  const settings = readJson(settingsFile, {});
  const b = { ...settings.bounds };
  // A saved position on a monitor that's gone would open the window out of reach.
  if (b.x != null && !screen.getAllDisplays().some(({ workArea: w }) => b.x + 100 > w.x && b.x < w.x + w.width - 100 && b.y >= w.y - 20 && b.y < w.y + w.height - 50)) { delete b.x; delete b.y; }
  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors);
  const c = startColours(dark, settings.tone);
  win = new BrowserWindow({
    width: b.width || 1100,
    height: b.height || 760,
    x: b.x, y: b.y,
    minWidth: 420, minHeight: 300,
    show: false,
    backgroundColor: c.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: c.bg, symbolColor: c.fg, height: 38 },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      plugins: true, // Chromium's PDF viewer
    },
  });
  if (b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Keep links in Markdown previews out of the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  // Right-click: hand the details to the renderer, which draws its own menu.
  win.webContents.on('context-menu', (_e, p) => {
    win.webContents.send('context-menu', {
      x: p.x, y: p.y, editable: p.isEditable, selection: !!p.selectionText,
      word: p.misspelledWord, suggestions: p.dictionarySuggestions.slice(0, 5),
    });
  });

  win.on('close', () => {
    const s = readJson(settingsFile, {});
    s.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    writeJson(settingsFile, s);
  });
  win.on('closed', () => { win = null; });
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  // NZ English first, falling back to the nearest one Windows has.
  const have = session.defaultSession.availableSpellCheckerLanguages;
  const lang = ['en-NZ', 'en-GB', 'en-AU', 'en-US'].find(l => have.includes(l));
  if (lang) session.defaultSession.setSpellCheckerLanguages([lang]);
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- state ----------
ipcMain.handle('state:load', () => {
  const files = pendingFiles;
  pendingFiles = [];
  return {
    settings: readJson(settingsFile, {}),
    session: readJson(sessionFile, null),
    files,
    systemDark: nativeTheme.shouldUseDarkColors,
    version: app.getVersion(),
  };
});

ipcMain.handle('settings:save', (_e, partial) => {
  writeJson(settingsFile, { ...readJson(settingsFile, {}), ...partial });
});

// The setup screen's two Windows choices. Only the installed app touches the registry and desktop;
// a dev run (`electron .`) would point them at electron.exe.
ipcMain.handle('setup:shell', async (_e, { menu, desktop }) => {
  if (!app.isPackaged) return false;
  const exe = process.execPath;
  for (const args of menuCommands(exe, menu)) {
    // Deleting a key that isn't there fails, which is fine.
    await new Promise(done => execFile('reg', args, { windowsHide: true }, () => done()));
  }
  const lnk = path.join(app.getPath('desktop'), 'Recto.lnk');
  if (desktop) shell.writeShortcutLink(lnk, 'create', { target: exe, icon: exe, iconIndex: 0 });
  else fs.rmSync(lnk, { force: true });
  return true;
});

ipcMain.on('session:saveSync', (e, session) => {
  try { writeJson(sessionFile, session); e.returnValue = true; } catch { e.returnValue = false; }
});

ipcMain.handle('window:theme', (_e, { bg, fg }) => {
  if (!win) return;
  win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 38 });
  win.setBackgroundColor(bg);
});

ipcMain.handle('edit:action', (_e, name, arg) => {
  const wc = win?.webContents;
  if (!wc) return;
  if (name === 'replace') wc.replaceMisspelling(arg);
  else if (name === 'learn') wc.session.addWordToSpellCheckerDictionary(arg);
  else if (['cut', 'copy', 'paste', 'selectAll'].includes(name)) wc[name]();
});

nativeTheme.on('updated', () => win?.webContents.send('system-theme', nativeTheme.shouldUseDarkColors));

// ---------- files ----------
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

function readFile(p) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return { path: p, dir: true };
    if (st.size > MAX_BYTES) return { path: p, error: 'That file is over 50 MB, which is too big for Recto.' };
    const ext = path.extname(p).slice(1).toLowerCase();
    if (IMAGES.has(ext)) return { path: p, view: 'image', mtime: st.mtimeMs };
    if (ext === 'pdf') return { path: p, view: 'pdf', mtime: st.mtimeMs };
    if (ext === 'docx') {
      const text = docxText(fs.readFileSync(p));
      return text == null ? { path: p, error: "Couldn't read the text in that Word file." } : { path: p, extracted: text, mtime: st.mtimeMs };
    }
    const r = decode(fs.readFileSync(p));
    if (r.binary) return { path: p, error: "That looks like a binary file, so Recto won't open it." };
    return { path: p, ...r, mtime: st.mtimeMs };
  } catch (err) {
    return { path: p, missing: err.code === 'ENOENT', error: err.code === 'ENOENT' ? 'File not found.' : err.message };
  }
}

ipcMain.handle('file:read', (_e, p) => readFile(p));

// Plain words for the save errors people actually hit. Anything else keeps the system's own text.
function saveError(err) {
  switch (err.code) {
    case 'EPERM': case 'EACCES': case 'EROFS': return "it's read-only, or Windows won't let Recto change it. Try Save as…";
    case 'EBUSY': return "another program is using it.";
    case 'ENOSPC': return 'the disk is full.';
    case 'ENOENT': return "its folder isn't there any more. Try Save as…";
    default: return err.message;
  }
}

ipcMain.handle('file:write', (_e, p, content, encoding, bom) => {
  try {
    let buf = encode(content, encoding, bom);
    // Text that Windows-1252 can't hold gets saved as UTF-8 rather than lost.
    if (!buf) { encoding = 'utf8'; bom = false; buf = encode(content, encoding, bom); }
    fs.writeFileSync(p, buf);
    return { ok: true, mtime: fs.statSync(p).mtimeMs, encoding, bom };
  } catch (err) {
    return { ok: false, error: saveError(err) };
  }
});

ipcMain.handle('file:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('file:save-dialog', async (_e, defaultPath, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('folder:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('folder:list', (_e, dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.') || d.name === '.gitignore' || d.name === '.env')
      .map(d => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
});

function listFiles(root) {
  // ponytail: plain recursive walk capped at 20k files; swap for a watcher-backed index if huge repos feel slow.
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (out.length >= 20000) return;
      if (IGNORE.has(d.name) || (d.name.startsWith('.') && d.isDirectory())) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full); else out.push(full);
    }
  };
  walk(root);
  return out;
}

ipcMain.handle('folder:files', (_e, root) => listFiles(root));

// Find in files. A newer search makes the older one give up.
let searchId = 0;
ipcMain.handle('folder:search', async (_e, root, query) => {
  const id = ++searchId;
  const files = listFiles(root);
  // Smart case: an all lower case query ignores case.
  const fold = query === query.toLowerCase();
  const out = [];
  for (const f of files) {
    if (id !== searchId) return null;
    let buf;
    try {
      const st = await fs.promises.stat(f);
      if (st.size > 2 * 1024 * 1024) continue;
      buf = await fs.promises.readFile(f);
    } catch { continue; }
    const r = decode(buf);
    if (r.binary) continue;
    const lines = r.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const col = (fold ? lines[i].toLowerCase() : lines[i]).indexOf(query);
      if (col < 0) continue;
      out.push({ path: f, line: i + 1, col, text: lines[i].slice(0, 300) });
      if (out.length >= 300) return out;
    }
  }
  return out;
});

ipcMain.handle('dialog:unsaved', async (_e, name) => {
  const r = await dialog.showMessageBox(win, {
    type: 'none',
    message: `Save changes to ${name}?`,
    detail: "Your changes are lost if you don't save them.",
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0, cancelId: 2, noLink: true,
  });
  return r.response;
});

ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

// ---------- updates: only when you ask, never in the background ----------
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
ipcMain.handle('update:check', async () => {
  try {
    const res = await net.fetch('https://api.github.com/repos/DanBierre/Recto/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return { error: `GitHub said ${res.status}` };
    const latest = String((await res.json()).tag_name || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+/.test(latest)) return { error: "Couldn't read the latest version" };
    return { current: app.getVersion(), latest, newer: newer(latest, app.getVersion()) };
  } catch {
    return { error: "Couldn't reach GitHub. Are you online?" };
  }
});
ipcMain.handle('update:open', () => shell.openExternal('https://github.com/DanBierre/Recto/releases/latest'));

// ---------- watch open files for outside changes ----------
const watched = new Map();
ipcMain.handle('file:watch', (_e, paths) => {
  const want = new Set(paths);
  for (const [p] of watched) if (!want.has(p)) { fs.unwatchFile(p); watched.delete(p); }
  for (const p of want) {
    if (watched.has(p)) continue;
    // ponytail: 1 s stat polling per open file; fine for tens of tabs, use fs.watch on folders if it ever matters.
    const fn = (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) win?.webContents.send('file:changed', p); };
    fs.watchFile(p, { interval: 1000 }, fn);
    watched.set(p, fn);
  }
});

// ---------- print and export ----------
// Lay the page out in a hidden window, then print it or save it as a PDF.
async function htmlWindow(html) {
  const tmp = path.join(app.getPath('temp'), `recto-print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, parent: win, webPreferences: { javascript: false, sandbox: true } });
  try { await w.loadFile(tmp); } catch (err) { w.destroy(); throw err; } finally { fs.rm(tmp, { force: true }, () => {}); }
  return w;
}

ipcMain.handle('doc:pdf', async (_e, html, p) => {
  let w;
  try {
    w = await htmlWindow(html);
    const pdf = await w.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
    });
    fs.writeFileSync(p, pdf);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; } finally { w?.destroy(); }
});

ipcMain.handle('doc:print', async (_e, html) => {
  let w;
  try { w = await htmlWindow(html); } catch (err) { return { ok: false, error: err.message }; }
  return new Promise(resolve => w.webContents.print({}, (ok, why) => { w.destroy(); resolve({ ok, error: ok ? null : why }); }));
});

ipcMain.handle('doc:zip', (_e, p, parts) => {
  try { fs.writeFileSync(p, zip(parts)); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});
