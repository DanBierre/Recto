// Just enough zip for .docx: write a few files, read one back, pull the text out of a Word file.
const zlib = require('zlib');

// files: [[name, string or Buffer], ...]
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const packed = zlib.deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // names are UTF-8
    local.writeUInt16LE(8, 8);        // deflate
    local.writeUInt16LE(0x21, 12);    // 1 Jan 1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

// Read one file out of a zip by name. Returns a Buffer, or null if it isn't there.
function unzip(buf, want) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nl) === want) {
      const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
      const data = buf.subarray(start, start + size);
      if (method === 8) return zlib.inflateRawSync(data);
      return method === 0 ? data : null;
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

// The words in a .docx, one paragraph per line. Formatting is left behind.
function docxText(buf) {
  let xml;
  try { xml = unzip(buf, 'word/document.xml'); } catch { return null; }
  if (!xml) return null;
  const text = xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, n) => String.fromCodePoint(parseInt(n, hex ? 16 : 10)));
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = { zip, unzip, docxText };
