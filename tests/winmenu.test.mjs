import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { menuCommands } = createRequire(import.meta.url)('../winmenu.js');
const exe = 'C:\\Users\\x\\AppData\\Local\\Programs\\recto\\Recto.exe';

test('menuCommands adds three per-user entries with the right command', () => {
  const add = menuCommands(exe, true);
  assert.equal(add.length, 9);
  assert.ok(add.every(a => a[0] === 'add' && a[1].startsWith('HKCU\\Software\\Classes\\') && a.at(-1) === '/f'));
  assert.deepEqual(add[0], ['add', 'HKCU\\Software\\Classes\\*\\shell\\Recto', '/ve', '/d', 'Edit with Recto', '/f']);
  assert.deepEqual(add[2], ['add', 'HKCU\\Software\\Classes\\*\\shell\\Recto\\command', '/ve', '/d', `"${exe}" "%1"`, '/f']);
  assert.equal(add[8][4], `"${exe}" "%V"`, 'folder background uses %V');
});

test('menuCommands removes the same three keys', () => {
  assert.deepEqual(menuCommands(exe, false).map(a => a[1]), [
    'HKCU\\Software\\Classes\\*\\shell\\Recto',
    'HKCU\\Software\\Classes\\Directory\\shell\\Recto',
    'HKCU\\Software\\Classes\\Directory\\Background\\shell\\Recto',
  ]);
});
