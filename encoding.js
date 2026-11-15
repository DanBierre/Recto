// Text encodings Recto reads and writes: UTF-8 (with or without BOM), UTF-16 LE/BE and Windows-1252.
// Plain CommonJS so main.js and the unit tests can both load it.

// Bytes 0x80–0x9F in Windows-1252. The rest of 0x00–0xFF matches Latin-1.
const CP1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8DŽ\x8F\x90‘’“”•–—˜™š›œ\x9DžŸ';

const LABELS = { utf8: 'UTF-8', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', cp1252: 'Windows-1252' };

// Returns { content, encoding, bom } or { binary: true }.
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { content: buf.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true };
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const b = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return { content: b.swap16().toString('utf16le'), encoding: 'utf16be', bom: true };
  }
  if (buf.subarray(0, 8000).includes(0)) return { binary: true };
  try {
    let content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    // TextDecoder drops the BOM by default, so check the bytes.
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    return { content, encoding: 'utf8', bom };
  } catch {
    // Not valid UTF-8: most likely an old Windows (Notepad, Excel CSV) file.
    return { content: new TextDecoder('windows-1252').decode(buf), encoding: 'cp1252', bom: false };
  }
}

// Returns a Buffer, or null when the text has characters the encoding can't hold.
function encode(text, encoding, bom) {
  if (encoding === 'utf16le') return Buffer.from('﻿' + text, 'utf16le');
  if (encoding === 'utf16be') return Buffer.from('﻿' + text, 'utf16le').swap16();
  if (encoding === 'cp1252') {
    const out = Buffer.alloc(text.length);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) { out[i] = c; continue; }
      const j = CP1252.indexOf(text[i]);
      if (j < 0) return null;
      out[i] = 0x80 + j;
    }
    return out;
  }
  return Buffer.from((bom ? '﻿' : '') + text, 'utf8');
}

module.exports = { decode, encode, LABELS };
