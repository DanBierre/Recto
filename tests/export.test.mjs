import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { docHtml, docxParts, markdownText, parseCsv, toCsv, csvToJson, jsonToCsv } from '../src/export.js';

const { zip, unzip, docxText } = createRequire(import.meta.url)('../zip.js');

test('zip and unzip round-trip, including UTF-8 and binary', () => {
  const bin = Buffer.from([0, 1, 2, 255, 254]);
  const buf = zip([['a.txt', 'kia ora — café'], ['dir/b.bin', bin]]);
  assert.equal(unzip(buf, 'a.txt').toString('utf8'), 'kia ora — café');
  assert.deepEqual([...unzip(buf, 'dir/b.bin')], [...bin]);
  assert.equal(unzip(buf, 'missing.txt'), null);
  assert.equal(unzip(Buffer.from('not a zip'), 'a.txt'), null);
});

test('docxParts makes a Word file that docxText reads back', () => {
  const md = '# Title\n\nSome **bold** & 5 < 6 text.\n\n- one\n- two\n';
  const text = docxText(zip(docxParts(md, true)));
  assert.match(text, /^Title\n/);
  assert.match(text, /Some bold & 5 < 6 text\./);
  assert.match(text, /one\n[\s\S]*two/);
  const plain = docxText(zip(docxParts('first para\nsame para\n\nsecond', false)));
  assert.match(plain, /first para/);
  assert.match(plain, /second/);
  assert.equal(docxText(zip([['x.txt', 'no word file here']])), null);
});

test('docHtml escapes plain text and renders markdown', () => {
  assert.match(docHtml({ text: '<script>x</script>', title: 'a<b' }), /&lt;script&gt;/);
  assert.ok(!docHtml({ text: '<script>x</script>' }).includes('<script>x'));
  assert.match(docHtml({ text: '# Hi', markdown: true }), /<h1[^>]*>Hi<\/h1>/);
});

test('markdownText drops the marks and keeps the words', () => {
  const t = markdownText('# Head\n\nA **b** and `c` and [d](https://x.nz).\n\n1. one\n2. two\n');
  assert.ok(!/[#*`[\]]/.test(t), t);
  assert.match(t, /Head/);
  assert.match(t, /A b and c and d/);
  assert.match(t, /1\. one\n2\. two/);
});

test('parseCsv handles quotes, commas, newlines and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z'), [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2\n', '\t'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
});

test('toCsv quotes only what needs quoting', () => {
  assert.equal(toCsv([['a', 'b,c', 'd"e', null]]), 'a,"b,c","d""e",\r\n');
});

test('CSV to JSON and back', () => {
  const csv = 'name,town\nAroha,"Nelson, NZ"\n\nSam,Dunedin\n';
  const json = csvToJson(csv);
  assert.deepEqual(JSON.parse(json), [{ name: 'Aroha', town: 'Nelson, NZ' }, { name: 'Sam', town: 'Dunedin' }]);
  assert.equal(jsonToCsv(json), 'name,town\r\nAroha,"Nelson, NZ"\r\nSam,Dunedin\r\n');
  assert.equal(jsonToCsv('[[1,2],[3,4]]'), '1,2\r\n3,4\r\n');
  assert.equal(jsonToCsv('{"a":1,"b":{"c":2}}'), 'a,b\r\n1,"{""c"":2}"\r\n');
  assert.throws(() => jsonToCsv('not json'));
});
