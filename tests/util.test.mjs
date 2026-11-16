import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEol, fuzzy, languageFor, basename, relativeTo, countWords } from '../src/util.js';

test('detectEol picks the most common line ending', () => {
  assert.equal(detectEol('a\r\nb\r\nc\n'), '\r\n');
  assert.equal(detectEol('a\nb\n'), '\n');
  assert.equal(detectEol('one line'), '\n');
});

test('fuzzy matches in order and ranks file-name hits higher', () => {
  assert.equal(fuzzy('xyz', 'main.js'), null);
  assert.ok(fuzzy('mjs', 'main.js'));
  const name = fuzzy('app', 'src\\app.js').score;
  const deep = fuzzy('app', 'a\\p\\p\\other.js').score;
  assert.ok(name > deep);
  assert.deepEqual(fuzzy('ma', 'main.js').hits, [0, 1]);
});

test('languageFor maps names and extensions', () => {
  assert.equal(languageFor('C:\\x\\App.TSX'), 'tsx');
  assert.equal(languageFor('Dockerfile'), 'dockerfile');
  assert.equal(languageFor('.env.local'), 'ini');
  assert.equal(languageFor('notes'), 'text');
  assert.equal(languageFor(null), 'text');
  assert.equal(languageFor('Makefile'), 'make');
  assert.equal(languageFor('C:\\x\\.gitignore'), 'ignore');
  assert.equal(languageFor('run', '#!/usr/bin/env python3\nprint(1)'), 'python');
  assert.equal(languageFor('run', '#!/bin/bash\n'), 'shell');
  assert.equal(languageFor('run', 'hello'), 'text');
  assert.equal(languageFor('a.txt', '#!/bin/bash'), 'text');
});

test('path helpers', () => {
  assert.equal(basename('C:\\a\\b.txt'), 'b.txt');
  assert.equal(relativeTo('C:\\Dev\\Recto', 'C:\\Dev\\Recto\\src\\a.js'), 'src\\a.js');
  assert.equal(relativeTo(null, 'C:\\a.js'), 'C:\\a.js');
});

test('countWords', () => {
  assert.equal(countWords('  hello   there\nmate '), 3);
  assert.equal(countWords(''), 0);
});

import { detectIndent } from '../src/util.js';
test('detectIndent', () => {
  assert.deepEqual(detectIndent('a\n\tb\n\tc'), { tabs: true, size: 4 });
  assert.deepEqual(detectIndent('a\n  b\n    c\n'), { tabs: false, size: 2 });
  assert.deepEqual(detectIndent('a\n    b\n        c\n'), { tabs: false, size: 4 });
  assert.deepEqual(detectIndent('plain', { tabs: false, size: 4 }), { tabs: false, size: 4 });
});
