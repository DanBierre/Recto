// Pure helpers with no DOM or editor imports, so `npm test` can run them in plain Node.

export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

// True when a file has both CRLF and bare LF line endings.
export function mixedEol(text) {
  return /\r\n/.test(text) && /(?<!\r)\n/.test(text);
}

export function basename(p) {
  return p.split(/[\\/]/).pop();
}

export function dirname(p) {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('\\');
}

export function relativeTo(root, p) {
  if (root && p.toLowerCase().startsWith(root.toLowerCase())) return p.slice(root.length).replace(/^[\\/]/, '');
  return p;
}

// Sublime-style fuzzy match: every query char must appear in order.
// Scores reward consecutive runs, word starts and matches in the file name.
export function fuzzy(query, text) {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const nameStart = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/')) + 1;
  let score = 0, ti = 0, prev = -2;
  const hits = [];
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    let s = 1;
    if (i === prev + 1) s += 5;
    if (i === 0 || /[\\/_\-. ]/.test(t[i - 1]) || (text[i] >= 'A' && text[i] <= 'Z')) s += 4;
    if (i >= nameStart) s += 2;
    score += s;
    hits.push(i);
    prev = i;
    ti = i + 1;
  }
  return { score: score - t.length * 0.01, hits };
}

// Map a file name to a language key. Keys match src/languages.js.
const EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', astro: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', pyw: 'python',
  xml: 'xml', svg: 'xml', xaml: 'xml', csproj: 'xml', plist: 'xml',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  rs: 'rust',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'java',
  java: 'java', kt: 'java',
  php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  go: 'go', lua: 'lua', rb: 'ruby', swift: 'swift',
  txt: 'text', log: 'text',
};
const NAMES = { dockerfile: 'dockerfile', makefile: 'make', gnumakefile: 'make', '.gitignore': 'ignore', '.dockerignore': 'ignore', '.npmignore': 'ignore', '.env': 'ini', '.bashrc': 'shell' };
const SHEBANG = { sh: 'shell', bash: 'shell', zsh: 'shell', python: 'python', node: 'javascript', ruby: 'ruby', php: 'php', lua: 'lua', pwsh: 'powershell' };

// `text` is the start of the file: a script with no extension is told apart by its #! line.
export function languageFor(name, text = '') {
  if (!name) return 'text';
  const lower = basename(name).toLowerCase();
  if (NAMES[lower]) return NAMES[lower];
  if (lower.startsWith('.env')) return 'ini';
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  if (EXT[ext]) return EXT[ext];
  const m = !ext && /^#!\s*(?:\S*\/)?(?:env\s+(?:-S\s+)?)?([a-z]+)/i.exec(text.slice(0, 200));
  return (m && SHEBANG[m[1].toLowerCase()]) || 'text';
}

export function countWords(text) {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

// Guess the file's indent: tabs or spaces, and how many spaces.
export function detectIndent(text, fallback = { tabs: false, size: 2 }) {
  let tabs = 0, spaces = 0, twos = 0;
  const lines = text.split('\n', 3000);
  for (const line of lines) {
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) continue;
    if (m[1][0] === '\t') { tabs++; continue; }
    // A lone space before "*" is a block-comment line, not real indent.
    if (m[1].length === 1) continue;
    spaces++;
    if (m[1].length % 4 === 2) twos++;
  }
  if (!tabs && !spaces) return fallback;
  if (tabs > spaces) return { tabs: true, size: fallback.size === 2 ? 4 : fallback.size };
  return { tabs: false, size: twos > 0 && twos >= spaces * 0.05 ? 2 : 4 };
}
