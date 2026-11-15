import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { decode, encode } = createRequire(import.meta.url)('../encoding.js');
const text = 'Café “quotes” – €5\nline two';

for (const [encoding, bom] of [['utf8', false], ['utf8', true], ['utf16le', true], ['utf16be', true], ['cp1252', false]]) {
  test(`${encoding}${bom ? ' + BOM' : ''} round trip`, () => {
    const r = decode(encode(text, encoding, bom));
    assert.deepEqual(r, { content: text, encoding, bom });
  });
}

test('invalid UTF-8 falls back to Windows-1252', () => {
  assert.equal(decode(Buffer.from([0x43, 0x61, 0x66, 0xe9])).content, 'Café');
});

test('binary files are refused', () => {
  assert.equal(decode(Buffer.from([0x50, 0x4b, 0x03, 0x00, 0x14])).binary, true);
});

test('Windows-1252 refuses characters it cannot hold', () => {
  assert.equal(encode('筆', 'cp1252'), null);
});
