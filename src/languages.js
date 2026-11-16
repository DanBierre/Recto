import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { go } from '@codemirror/legacy-modes/mode/go';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';

const legacy = mode => () => StreamLanguage.define(mode);

// key: [label, () => extension]
export const LANGUAGES = {
  text: ['Plain text', () => []],
  javascript: ['JavaScript', () => javascript()],
  jsx: ['JavaScript (JSX)', () => javascript({ jsx: true })],
  typescript: ['TypeScript', () => javascript({ typescript: true })],
  tsx: ['TypeScript (TSX)', () => javascript({ typescript: true, jsx: true })],
  json: ['JSON', () => json()],
  html: ['HTML', () => html()],
  css: ['CSS', () => css()],
  markdown: ['Markdown', () => markdown({ base: markdownLanguage })],
  python: ['Python', () => python()],
  xml: ['XML', () => xml()],
  sql: ['SQL', () => sql()],
  yaml: ['YAML', () => yaml()],
  rust: ['Rust', () => rust()],
  cpp: ['C / C++', () => cpp()],
  java: ['Java / C#', () => java()],
  php: ['PHP', () => php()],
  shell: ['Shell', legacy(shell)],
  make: ['Makefile', legacy(shell)],
  powershell: ['PowerShell', legacy(powerShell)],
  toml: ['TOML', legacy(toml)],
  ini: ['INI / env', legacy(properties)],
  ignore: ['Ignore file', legacy(properties)],
  go: ['Go', legacy(go)],
  lua: ['Lua', legacy(lua)],
  ruby: ['Ruby', legacy(ruby)],
  swift: ['Swift', legacy(swift)],
  dockerfile: ['Dockerfile', legacy(dockerFile)],
};

export const languageLabel = key => (LANGUAGES[key] || LANGUAGES.text)[0];
export const languageExtension = key => (LANGUAGES[key] || LANGUAGES.text)[1]();
