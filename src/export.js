// Turning a document into other things: a printable page, a Word file, CSV and JSON.
// No DOM in here, so the tests can run it straight in Node.
import { marked } from 'marked';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unent = s => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

// ---------- a printable page (PDF, print, HTML export) ----------
const PAPER = `
body{font:11pt/1.55 "Segoe UI",system-ui,sans-serif;color:#1f1f1f;background:#fff;max-width:680px;margin:0 auto}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em;break-after:avoid}
h1{font-size:22pt;margin-top:0}h2{font-size:16pt}h3{font-size:13pt}
p,ul,ol,table,pre,blockquote{margin:0 0 .8em}
a{color:#2a5db0}
code{font:10pt Consolas,monospace;background:#f2f2ef;padding:1px 4px;border-radius:3px}
pre{background:#f6f6f3;padding:10px 12px;border-radius:4px;white-space:pre-wrap;overflow-wrap:anywhere}
pre code{background:none;padding:0}
blockquote{border-left:3px solid #d0d0cc;padding-left:14px;color:#555}
table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
img{max-width:100%}hr{border:0;border-top:1px solid #ccc;margin:1.5em 0}
.plain{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.plain.mono{font:10pt/1.5 Consolas,monospace}
@media screen{body{padding:40px 24px}}`;

export function docHtml({ text, markdown = false, mono = false, title = 'Untitled', base = '' }) {
  const body = markdown ? marked.parse(text) : `<div class="plain${mono ? ' mono' : ''}">${esc(text)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${base ? `<base href="${esc(base)}">` : ''}<style>${PAPER}</style></head><body>${body}</body></html>`;
}

// ---------- Markdown as plain words ----------
function plainInline(tokens = []) {
  return tokens.map(t => {
    if (t.type === 'br') return '\n';
    if (t.type === 'image') return t.text;
    if (t.tokens) return plainInline(t.tokens);
    return unent(t.text ?? '');
  }).join('');
}

function plainBlocks(tokens, indent = '', gap = '\n\n') {
  const out = [];
  for (const t of tokens) {
    if (t.type === 'space') continue;
    if (t.type === 'list') {
      out.push(t.items.map((it, i) => {
        const mark = t.ordered ? `${(t.start || 1) + i}. ` : '• ';
        return indent + mark + plainBlocks(it.tokens, indent + '   ', '\n').replace(/^\s+/, '');
      }).join('\n'));
    } else if (t.type === 'code') out.push(t.text);
    else if (t.type === 'table') {
      const row = cells => cells.map(c => plainInline(c.tokens)).join('\t');
      out.push([row(t.header), ...t.rows.map(row)].join('\n'));
    } else if (t.type === 'hr') out.push('—');
    else if (t.type === 'blockquote') out.push(plainBlocks(t.tokens).replace(/^/gm, '  '));
    else if (t.type === 'html') continue;
    else out.push(indent + plainInline(t.tokens || [{ text: t.text || '' }]));
  }
  return out.join(gap);
}

export const markdownText = text => plainBlocks(marked.lexer(text)).trim() + '\n';

// ---------- Word (.docx) ----------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(text, f = {}) {
  const props = (f.b ? '<w:b/>' : '') + (f.i ? '<w:i/>' : '') + (f.s ? '<w:strike/>' : '')
    + (f.u ? '<w:color w:val="2A5DB0"/><w:u w:val="single"/>' : '')
    + (f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>' : '');
  return String(text).split('\n').map((line, n) =>
    `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${n ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`).join('');
}

function runs(tokens = [], f = {}) {
  return tokens.map(t => {
    switch (t.type) {
      case 'strong': return runs(t.tokens, { ...f, b: true });
      case 'em': return runs(t.tokens, { ...f, i: true });
      case 'del': return runs(t.tokens, { ...f, s: true });
      case 'link': return runs(t.tokens, { ...f, u: true });
      case 'codespan': return run(unent(t.text), { ...f, code: true });
      case 'br': return '<w:r><w:br/></w:r>';
      case 'image': return run(`[${t.text || 'image'}]`, f);
      case 'html': return '';
      default: return t.tokens ? runs(t.tokens, f) : run(unent(t.text ?? t.raw ?? ''), f);
    }
  }).join('');
}

const para = (body, { style, indent, border } = {}) => {
  const pPr = (style ? `<w:pStyle w:val="${style}"/>` : '')
    + (border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>' : '')
    + (indent ? `<w:ind w:left="${indent}" w:hanging="300"/>` : '');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
};

function table(t) {
  const cols = t.header.length;
  const width = Math.floor(9000 / Math.max(cols, 1));
  const cell = (c, head) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(runs(c.tokens, { b: head }))}</w:tc>`;
  const row = (cells, head) => `<w:tr>${cells.map(c => cell(c, head)).join('')}</w:tr>`;
  const b = side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders></w:tblPr>`
    + `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>${row(t.header, true)}${t.rows.map(r => row(r, false)).join('')}</w:tbl>`;
}

// ponytail: lists are "• " / "1. " text with an indent, not real Word numbering (numbering.xml). Fine to read and print.
function blocks(tokens, { quote = false, level = 0 } = {}) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space': case 'html': break;
      case 'heading': out.push(para(runs(t.tokens), { style: `Heading${Math.min(t.depth, 4)}` })); break;
      case 'code': out.push(...t.text.split('\n').map(l => para(run(l), { style: 'Code' }))); break;
      case 'blockquote': out.push(blocks(t.tokens, { quote: true, level })); break;
      case 'hr': out.push(para('', { border: true })); break;
      case 'table': out.push(table(t), para('')); break;
      case 'list':
        t.items.forEach((it, i) => {
          const mark = t.ordered ? `${(t.start || 1) + i}.\t` : '•\t';
          let first = true;
          for (const c of it.tokens) {
            if (c.type === 'list') { out.push(blocks([c], { quote, level: level + 1 })); continue; }
            if (c.type === 'space') continue;
            out.push(para((first ? run(mark) : '') + runs(c.tokens || [{ text: c.text || '' }]), { indent: 360 + level * 360 + 300 }));
            first = false;
          }
        });
        break;
      default: out.push(para(runs(t.tokens || [{ text: t.text || '' }]), { style: quote ? 'Quote' : undefined }));
    }
  }
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[[1, 36], [2, 30], [3, 26], [4, 24]].map(([n, sz]) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('\n')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

export function docxParts(text, markdown = false) {
  const body = markdown
    ? blocks(marked.lexer(text))
    : text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(chunk => para(run(chunk))).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/styles.xml', STYLES],
    ['word/document.xml', doc],
  ];
}

// ---------- CSV and JSON ----------
export function parseCsv(text, sep = ',') {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const toCsv = (rows, sep = ',') => rows.map(r => r.map(v => {
  const s = v == null ? '' : String(v);
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(sep)).join('\r\n') + '\r\n';

export function csvToJson(text, sep = ',') {
  const [head = [], ...rest] = parseCsv(text, sep);
  const items = rest.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  return JSON.stringify(items, null, 2) + '\n';
}

export function jsonToCsv(text, sep = ',') {
  let data = JSON.parse(text);
  if (!Array.isArray(data)) data = [data];
  if (data.every(Array.isArray)) return toCsv(data, sep);
  const keys = [...new Set(data.flatMap(o => (o && typeof o === 'object' ? Object.keys(o) : [])))];
  const cell = v => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  return toCsv([keys, ...data.map(o => keys.map(k => cell(o?.[k])))], sep);
}
