// Editor extensions: look, syntax colours, Sublime-style keys.
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, scrollPastEnd, highlightWhitespace,
} from '@codemirror/view';
import {
  history, defaultKeymap, historyKeymap, indentWithTab, copyLineDown, moveLineUp, moveLineDown,
  insertBlankLine,
} from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, indentUnit,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, completeAnyWord } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { languageExtension } from './languages.js';

export const language = new Compartment();
export const wrapping = new Compartment();
export const gutters = new Compartment();
export const indentation = new Compartment();
export const spelling = new Compartment();
export const whitespace = new Compartment();

export const spellExt = on => (on ? EditorView.contentAttributes.of({ spellcheck: 'true' }) : []);
export const whitespaceExt = on => (on ? highlightWhitespace() : []);

// Every colour is a CSS variable, so light and dark only swap :root values.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword, t.tagName], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.inserted, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.annotation, t.self, t.changed], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.constant(t.name), t.standard(t.name), t.color], color: 'var(--syn-number)' },
  { tag: [t.operator, t.escape, t.regexp, t.punctuation, t.separator, t.bracket], color: 'var(--syn-operator)' },
  { tag: [t.comment, t.meta], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.heading, color: 'var(--text)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--syn-keyword)', textDecoration: 'underline', textUnderlineOffset: '3px' },
  { tag: t.monospace, color: 'var(--syn-string)' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--syn-comment)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

const look = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--page)', fontSize: 'var(--font-size)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '18px 0 0', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0 28px 0 18px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--mark-strong) !important' },
  '.cm-content ::selection': { background: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--mark)', outline: '1px solid var(--mark-strong)' },
  '.cm-searchMatch': { backgroundColor: 'var(--find)', outline: '1px solid var(--find-line)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--find-line)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--line-strong)', color: 'inherit' },
  '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-gutters': { backgroundColor: 'var(--page)', color: 'var(--text-4)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px', minWidth: '34px', fontSize: '0.86em' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-4)', padding: '0 4px', cursor: 'pointer', opacity: 0, transition: 'opacity .15s' },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement': { opacity: 1 },
  '.cm-foldPlaceholder': { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)', padding: '0 6px', margin: '0 2px' },
  '.cm-tooltip': { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '4px', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', maxHeight: '15em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 12px 3px 8px !important', lineHeight: '1.6' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--mark-strong)', color: 'var(--text)' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--ink)', fontWeight: '500' },
  '.cm-panels': { backgroundColor: 'var(--page)', color: 'var(--text)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-specialChar': { color: 'var(--danger)' },
});

// Sublime's Ctrl+Shift+L: one cursor at the end of each selected line.
function splitIntoLines(view) {
  const ranges = [];
  for (const r of view.state.selection.ranges) {
    if (r.empty) { ranges.push(r); continue; }
    const first = view.state.doc.lineAt(r.from).number;
    const last = view.state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      const line = view.state.doc.line(n);
      ranges.push(EditorSelection.cursor(Math.min(line.to, r.to)));
    }
  }
  view.dispatch({ selection: EditorSelection.create(ranges) });
  return true;
}

// Sublime's Ctrl+Enter / Ctrl+Shift+Enter: new line below / above without splitting this one.
function lineAbove(view) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const indent = /^\s*/.exec(line.text)[0];
  view.dispatch({
    changes: { from: line.from, insert: indent + '\n' },
    selection: { anchor: line.from + indent.length },
    scrollIntoView: true,
  });
  return true;
}

const sublimeKeys = [
  { key: 'Mod-Shift-d', run: copyLineDown, preventDefault: true },
  { key: 'Mod-Shift-ArrowUp', run: moveLineUp },
  { key: 'Mod-Shift-ArrowDown', run: moveLineDown },
  { key: 'Mod-Enter', run: insertBlankLine },
  { key: 'Mod-Shift-Enter', run: lineAbove },
  { key: 'Mod-Shift-l', run: splitIntoLines },
];

export function indentExtension(indent) {
  return [indentUnit.of(indent.tabs ? '\t' : ' '.repeat(indent.size)), EditorState.tabSize.of(indent.size)];
}

export function extensions({ lang, wrap, lineNums, indent, spell, ws, onUpdate }) {
  return [
    keymap.of(sublimeKeys),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [completeAnyWord], icons: false, activateOnTypingDelay: 250 }),
    rectangularSelection(),
    crosshairCursor({ key: 'Alt' }),
    highlightActiveLine(),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    search({ top: false }),
    scrollPastEnd(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    gutters.of(lineNums ? [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '⌄', closedText: '›' })] : []),
    wrapping.of(wrap ? EditorView.lineWrapping : []),
    language.of(languageExtension(lang)),
    indentation.of(indentExtension(indent)),
    spelling.of(spellExt(spell)),
    whitespace.of(whitespaceExt(ws)),
    look,
    EditorView.updateListener.of(onUpdate),
  ];
}

export { EditorState, EditorView, EditorSelection };

// A read-only copy of a tab for the split pane.
export function referenceExtensions({ lang, wrap }) {
  return [
    EditorState.readOnly.of(true), syntaxHighlighting(highlight), language.of(languageExtension(lang)),
    wrap ? EditorView.lineWrapping : [], look, scrollPastEnd(),
  ];
}
