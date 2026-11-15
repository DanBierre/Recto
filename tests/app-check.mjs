// Smoke test in the real app: node tests/app-check.mjs [outDir]
// Uses a throwaway profile so your own settings and session stay untouched.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { unzip } = createRequire(import.meta.url)('../zip.js');
const watch = (p, errors) => {
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
};
const open = (p, file) => p.evaluate(f => window.__recto.openPath(f), file);

const out = process.argv[2] || path.join(os.tmpdir(), 'recto-shots');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-profile-'));
const sample = path.join(profile, 'sample.js');
fs.writeFileSync(sample, [
  "// Recto: a quiet little editor",
  "import { readFile } from 'node:fs/promises';",
  '',
  'export async function wordCount(path) {',
  "  const text = await readFile(path, 'utf8');",
  '  const words = text.match(/\\S+/g) ?? [];',
  '  return { path, words: words.length, ok: true };',
  '}',
  '',
  'const LIMIT = 42;',
  "console.log(`limit is ${LIMIT}`);",
  '',
].join('\r\n'));
// The first-run setup note gets its own fresh profile at the end; skip it here.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ setupDone: true }));

const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, sample], cwd: process.cwd() });
const page = await app.firstWindow();
const errors = [];
watch(page, errors);
await page.waitForSelector('body.ready');
await page.waitForSelector('.cm-content');
await page.waitForTimeout(400);

// File opened with CRLF kept, not dirty.
const info = await page.evaluate(() => {
  const d = window.__recto.active();
  return { eol: d.eol, dirty: window.__recto.isDirty(d), tabs: window.__recto.docs().length, lang: d.lang };
});
assert.equal(info.eol, '\r\n');
assert.equal(info.dirty, false);
assert.equal(info.lang, 'javascript');

// Type, save, check the file on disk keeps CRLF.
await page.click('.cm-content');
await page.keyboard.press('Control+End');
await page.keyboard.type('// saved by the smoke test');
assert.equal(await page.evaluate(() => window.__recto.isDirty(window.__recto.active())), true);
await page.keyboard.press('Control+s');
await page.waitForTimeout(300);
const disk = fs.readFileSync(sample, 'utf8');
assert.ok(disk.includes('// saved by the smoke test'));
assert.ok(!/[^\r]\n/.test(disk), 'CRLF kept on save');
assert.equal(await page.evaluate(() => window.__recto.isDirty(window.__recto.active())), false);

await page.screenshot({ path: path.join(out, 'light.png') });

// Palette: commands.
await page.keyboard.press('Control+Shift+p');
await page.keyboard.type('theme dark');
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(out, 'palette.png') });
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
await page.screenshot({ path: path.join(out, 'dark.png') });

// Unsaved untitled tab survives a restart (hot exit).
await page.keyboard.press('Control+n');
await page.keyboard.type('scratch note that never got saved');
await page.waitForTimeout(800);
await app.close();

const app2 = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: process.cwd() });
const page2 = await app2.firstWindow();
watch(page2, errors);
await page2.waitForSelector('body.ready');
await page2.waitForTimeout(400);
const restored = await page2.evaluate(() => window.__recto.docs().map(d => window.__recto.view.state && (d === window.__recto.active() ? window.__recto.view.state.doc.toString() : d.state.doc.toString())));
assert.equal(restored.length, 2);
assert.ok(restored.includes('scratch note that never got saved'));
await page2.screenshot({ path: path.join(out, 'restored.png') });

// Markdown preview and empty state.
const md = path.join(profile, 'notes.md');
fs.writeFileSync(md, '# Recto\n\nA quiet editor. **Bold**, `code` and a [link](https://example.com).\n\n- one\n- two\n\n> quote\n');
await page2.evaluate(p => window.__recto.openPath(p), md);
await page2.keyboard.press('Control+Shift+m');
await page2.waitForTimeout(500);
await page2.screenshot({ path: path.join(out, 'markdown.png') });
await page2.keyboard.press('Control+Shift+m');
await page2.evaluate(() => window.__recto.setSetting('theme', 'light'));
assert.equal(await page2.evaluate(() => document.documentElement.dataset.tone), 'warm');

// UTF-16 LE stays UTF-16 LE after an edit and save.
const u16 = path.join(profile, 'wide.txt');
fs.writeFileSync(u16, Buffer.from('﻿Hello wide world\r\n', 'utf16le'));
await page2.evaluate(p => window.__recto.openPath(p), u16);
await page2.waitForTimeout(200);
assert.match(await page2.textContent('#status'), /UTF-16 LE/);
await page2.evaluate(async () => {
  const v = window.__recto.view;
  v.dispatch({ changes: { from: v.state.doc.length, insert: 'more' } });
  await window.__recto.save(window.__recto.active());
});
const wide = fs.readFileSync(u16);
assert.deepEqual([...wide.subarray(0, 2)], [0xff, 0xfe]);
assert.match(wide.subarray(2).toString('utf16le'), /Hello wide world\r\nmore/);

// Find in files (no folder open, so it searches open tabs).
await page2.evaluate(() => window.__recto.openFindInFiles());
await page2.keyboard.type('quiet');
await page2.waitForTimeout(400);
assert.match(await page2.textContent('#palette ul'), /quiet editor/);
await page2.screenshot({ path: path.join(out, 'find-in-files.png') });
await page2.keyboard.press('Escape');

// Right-click a tab.
await page2.click('.tab', { button: 'right' });
assert.equal(await page2.isVisible('#menu'), true);
assert.match(await page2.textContent('#menu'), /Close others/);
await page2.screenshot({ path: path.join(out, 'tab-menu.png') });
await page2.keyboard.press('Escape');
assert.equal(await page2.isVisible('#menu'), false);

// ---------- Print and PDF ----------
await open(page2, md);
const pdfOut = path.join(profile, 'notes.pdf');
assert.equal(await page2.evaluate(p => window.__recto.exportAs('pdf', { to: p }), pdfOut), pdfOut);
assert.equal(fs.readFileSync(pdfOut).subarray(0, 5).toString(), '%PDF-');
console.log('pdf ok');

// The real print dialog would block the test, so swap it for a stub in the hidden print window.
await app2.evaluate(({ app }) => {
  app.on('browser-window-created', (_e, w) => { w.webContents.print = (_o, cb) => { globalThis.__printed = true; cb(true); }; });
});
assert.equal(await page2.evaluate(() => window.__recto.printDoc()), true);
assert.equal(await app2.evaluate(() => globalThis.__printed), true);
console.log('print ok');

// ---------- Other exports ----------
const outs = { html: 'notes.html', docx: 'notes.docx', txt: 'notes-plain.txt' };
for (const [kind, name] of Object.entries(outs)) {
  outs[kind] = path.join(profile, name);
  assert.equal(await page2.evaluate(([k, p]) => window.__recto.exportAs(k, { to: p }), [kind, outs[kind]]), outs[kind]);
}
assert.match(fs.readFileSync(outs.html, 'utf8'), /<h1[^>]*>Recto<\/h1>/);
assert.match(unzip(fs.readFileSync(outs.docx), 'word/document.xml').toString(), /Recto/);
const plain = fs.readFileSync(outs.txt, 'utf8');
assert.match(plain, /^Recto/);
assert.ok(!/[#*`]/.test(plain), 'markdown marks stripped from plain text');
console.log('exports ok');

// ---------- CSV table and CSV <-> JSON ----------
const csv = path.join(profile, 'people.csv');
fs.writeFileSync(csv, 'name,town\nAroha,"Nelson, NZ"\nSam,Dunedin\n');
await open(page2, csv);
await page2.waitForSelector('#viewer table');
assert.equal(await page2.textContent('#viewer td'), 'Aroha');
await page2.screenshot({ path: path.join(out, 'csv-table.png') });
const asJson = await page2.evaluate(() => {
  const r = window.__recto;
  r.convert(r.csvToJson, 'json');
  return [r.active().title, r.view.state.doc.toString()];
});
assert.equal(asJson[0], 'people.json');
assert.deepEqual(JSON.parse(asJson[1]), [{ name: 'Aroha', town: 'Nelson, NZ' }, { name: 'Sam', town: 'Dunedin' }]);
const backToCsv = await page2.evaluate(() => {
  const r = window.__recto;
  r.convert(r.jsonToCsv, 'csv');
  return r.view.state.doc.toString();
});
assert.match(backToCsv, /^name,town\r?\nAroha,"Nelson, NZ"\r?\nSam,Dunedin/);
await page2.waitForSelector('#viewer table'); // the converted .csv tab shows as a table too
await page2.evaluate(() => window.__recto.toggleTable());
assert.equal(await page2.isVisible('#viewer'), false);
console.log('csvjson ok');

// ---------- Theme picker ----------
await page2.evaluate(() => window.__recto.openThemes());
assert.equal(await page2.locator('#themes .swatch').count(), 8);
await page2.screenshot({ path: path.join(out, 'themes-light.png') });
await page2.click('#themes .sample[data-tone="sage"][data-theme="dark"]');
assert.equal(await page2.isVisible('#themes'), false);
assert.deepEqual(await page2.evaluate(() => [document.documentElement.dataset.tone, document.documentElement.dataset.theme]), ['sage', 'dark']);
await page2.evaluate(() => window.__recto.openThemes());
assert.equal(await page2.getAttribute('#themes .swatch.current .sample', 'data-tone'), 'sage');
await page2.screenshot({ path: path.join(out, 'themes-dark.png') });
await page2.keyboard.press('Escape');
assert.equal(await page2.isVisible('#themes'), false);
console.log('themes ok');

// ---------- Layouts and the reading font ----------
await open(page2, md);
await page2.waitForSelector('#editor.prose');
assert.equal(await page2.locator('.cm-lineNumbers').count(), 0, 'prose has no line numbers by default');
await page2.evaluate(() => window.__recto.toggleLineNums());
assert.equal(await page2.locator('.cm-lineNumbers').count(), 1);
await page2.evaluate(() => window.__recto.toggleLineNums());
await page2.evaluate(() => window.__recto.setLayout('page'));
assert.equal(await page2.evaluate(() => document.body.classList.contains('layout-page')), true);
await page2.waitForTimeout(150);
await page2.screenshot({ path: path.join(out, 'page-dark.png') });
await page2.evaluate(() => window.__recto.pickTheme('warm', 'light'));
await page2.waitForTimeout(150);
await page2.screenshot({ path: path.join(out, 'page-light.png') });
await page2.evaluate(() => window.__recto.setSetting('font', 'sans'));
assert.match(await page2.evaluate(() => getComputedStyle(document.querySelector('#editor.prose .cm-scroller')).fontFamily), /Segoe UI/);
await page2.evaluate(() => window.__recto.setSetting('font', 'serif'));
await page2.evaluate(() => window.__recto.setLayout('focus'));
assert.equal(await page2.evaluate(() => document.body.classList.contains('zen')), true);
await page2.evaluate(() => window.__recto.toggleZen());
assert.equal(await page2.evaluate(() => window.__recto.settings().layout), 'page', 'focus goes back to the layout before it');
await page2.evaluate(() => window.__recto.setLayout('classic'));
assert.equal(await page2.evaluate(() => document.body.classList.contains('layout-page') || document.body.classList.contains('zen')), false);
console.log('layouts ok');

// ---------- More file types ----------
const png = path.join(profile, 'dot.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
await open(page2, png);
await page2.waitForSelector('#viewer img');
await page2.waitForFunction(() => document.querySelector('#viewer img').naturalWidth === 1);
assert.match(await page2.textContent('#status'), /Image/);
await open(page2, pdfOut);
await page2.waitForSelector('#viewer iframe');
await page2.waitForTimeout(1200);
await page2.screenshot({ path: path.join(out, 'pdf-view.png') });
await open(page2, outs.docx);
const fromWord = await page2.evaluate(() => {
  const r = window.__recto, d = r.active();
  return { title: d.title, path: d.path, text: r.view.state.doc.toString() };
});
assert.equal(fromWord.title, 'notes.txt');
assert.equal(fromWord.path, null, 'a Word file opens as a new untitled tab');
assert.match(fromWord.text, /^Recto\n/);
console.log('filetypes ok');

await page2.evaluate(async () => { for (const d of [...window.__recto.docs()]) await window.__recto.closeDoc(d, { ask: false }); });
await page2.waitForTimeout(200);
assert.ok(await page2.locator('#recent li').count() >= 2);
await page2.screenshot({ path: path.join(out, 'empty.png') });

// ---------- Blank start ----------
// Leave a saved file and an unsaved draft open, then restart with "start with a blank page" on.
await page2.evaluate(() => window.__recto.setSetting('startBlank', true));
await open(page2, md);
await page2.evaluate(() => window.__recto.newFile());
await page2.keyboard.type('draft kept over a blank start');
await page2.waitForTimeout(800);
await app2.close();

const app3 = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: process.cwd() });
const page3 = await app3.firstWindow();
watch(page3, errors);
await page3.waitForSelector('body.ready');
const blank = await page3.evaluate(() => {
  const r = window.__recto;
  return {
    texts: r.docs().map(d => (d === r.active() ? r.view.state.doc.toString() : d.state.doc.toString())),
    paths: r.docs().map(d => d.path).filter(Boolean),
    active: { path: r.active().path, text: r.view.state.doc.toString() },
  };
});
assert.deepEqual(blank.active, { path: null, text: '' });
assert.ok(blank.texts.includes('draft kept over a blank start'), 'unsaved draft kept');
assert.deepEqual(blank.paths, [], 'saved files not reopened');
console.log('blank ok');
await app3.close();

// ---------- First-run setup: a note to Recto ----------
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-setup-'));
const app4 = await electron.launch({ args: ['.', `--user-data-dir=${fresh}`], cwd: process.cwd() });
const page4 = await app4.firstWindow();
watch(page4, errors);
await page4.waitForSelector('#setup[open]');
await page4.waitForTimeout(200);
await page4.screenshot({ path: path.join(out, 'setup-light.png') });
await page4.selectOption('#setup [name=look]', 'sage:dark');
await page4.selectOption('#setup [name=layout]', 'page');
await page4.selectOption('#setup [name=font]', 'sans');
await page4.selectOption('#setup [name=menu]', 'off');
await page4.selectOption('#setup [name=start]', 'blank');
assert.equal(await page4.isVisible('#setup'), true, 'picks apply without closing the note');
assert.deepEqual(await page4.evaluate(() => [document.documentElement.dataset.tone, document.documentElement.dataset.theme]), ['sage', 'dark']);
await page4.waitForTimeout(150);
await page4.screenshot({ path: path.join(out, 'setup-dark.png') });
await page4.click('#setup .go');
assert.equal(await page4.isVisible('#setup'), false);
await page4.waitForTimeout(300);
const saved = JSON.parse(fs.readFileSync(path.join(fresh, 'settings.json'), 'utf8'));
assert.deepEqual(
  [saved.setupDone, saved.tone, saved.theme, saved.layout, saved.font, saved.startBlank, saved.shellMenu, saved.desktopShortcut],
  [true, 'sage', 'dark', 'page', 'sans', true, false, true],
);
await app4.close();
const app5 = await electron.launch({ args: ['.', `--user-data-dir=${fresh}`], cwd: process.cwd() });
const page5 = await app5.firstWindow();
watch(page5, errors);
await page5.waitForSelector('body.ready');
await page5.waitForTimeout(300);
assert.equal(await page5.isVisible('#setup'), false, 'the note shows only once');
await page5.evaluate(() => window.__recto.openSetup());
assert.equal(await page5.inputValue('#setup [name=menu]'), 'off', 'running it again shows the saved picks');
await page5.keyboard.press('Escape');
assert.equal(await page5.isVisible('#setup'), false);
console.log('setup ok');
await app5.close();
fs.rmSync(fresh, { recursive: true, force: true });

fs.rmSync(profile, { recursive: true, force: true });
if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }
console.log('app-check passed. Screenshots in', out);
