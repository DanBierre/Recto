// Takes the README screenshots of newer features: node scripts/screenshots.mjs [outDir]
// Uses a throwaway profile, so your own settings and files stay untouched.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] || path.join(process.cwd(), 'docs', 'screenshots');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-shots-'));
const file = (name, text) => { const p = path.join(profile, name); fs.writeFileSync(p, text); return p; };

const js = file('wordcount.js', [
  '// Recto: a quiet little editor',
  "import { readFile } from 'node:fs/promises';",
  '',
  'export async function wordCount(path) {',
  "  const text = await readFile(path, 'utf8');",
  '  const words = text.match(/\S+/g) ?? [];',
  '  return { path, words: words.length, ok: true };',
  '}',
  '',
  'const LIMIT = 42;',
  'console.log(`limit is ${LIMIT}`);',
  '',
].join('\n'));
const md = file('notes.md', [
  '# Trip notes', '',
  'Leave early, **bring a jacket**, and keep the map on the seat.', '',
  '- Pack lunch', '- Fill the tank', '- Text Mum when we get there', '',
  'The road over the hill is [worth the detour](https://example.com).', '',
].join('\n'));
const todo = file('todo.txt', 'Call the plumber\nBook the car in\nWrite back to Sam\n');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ setupDone: true, theme: 'light', tone: 'warm' }));

const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`, js, md, todo], cwd: process.cwd() });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 740));
await page.waitForSelector('body.ready');
await page.waitForSelector('.cm-content');
await page.waitForTimeout(500);
const r = fn => page.evaluate(fn);
const shot = async name => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, name) }); };

// Split view: the code on the left, the notes beside it.
await r(() => { const z = window.__recto; z.setSplit(z.docs().find(d => /notes\.md/.test(d.path))); });
await page.click('.cm-content');
await shot('split-view.png');
await r(() => window.__recto.setSplit(null));

// Pinned tab, plus the counts and Wrap button in the status bar.
await page.click('#tabs .tab:has-text("todo")', { button: 'right' });
await page.click('#menu >> text="Pin"').catch(() => {});
await page.click('#tabs .tab:has-text("notes")');
await shot('pinned-tabs.png');

// Font picker, previewing a font as you move through the list.
await page.click('#tabs .tab:has-text("wordcount")');
await page.keyboard.press('Control+Shift+p');
await page.keyboard.type('choose the code font');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await shot('font-picker.png');
await page.keyboard.press('Escape');

await app.close();
console.log('screenshots saved in', out);
