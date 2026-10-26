import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, Facet, type ChangeSpec, type Extension, type Text } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { ideTheme } from "../../../../lib/editorTheme";
import { editorBasics } from "../CodeMirror";
import type { IdePrefs } from "./types";

/**
 * The pieces of every tab's EditorState. One EditorView shows the active tab; switching tabs
 * swaps whole states (`view.setState`), so each tab keeps its own undo history and selection.
 */

/** Which buffer a state belongs to, so one update listener serves them all. */
export const bufferId = Facet.define<string, string>({ combine: (values) => values[0] ?? "" });

export const idSlot = new Compartment();
export const languageSlot = new Compartment();
export const indentSlot = new Compartment();
export const readOnlySlot = new Compartment();
export const prefsSlot = new Compartment();

export const indentExtension = (tabSize: number, useTabs: boolean): Extension => [
  indentUnit.of(useTabs ? "\t" : " ".repeat(tabSize)),
  EditorState.tabSize.of(tabSize),
];

export const readOnlyExtension = (readOnly: boolean): Extension => EditorState.readOnly.of(readOnly);

const blockCursor = EditorView.theme({ ".cm-cursor": { borderLeftWidth: "0.6em", opacity: "0.75" } });

export const prefsExtension = (prefs: IdePrefs): Extension => [
  prefs.wrap ? EditorView.lineWrapping : [],
  EditorView.theme({ "&": { fontSize: `${prefs.fontSize}px` } }),
  prefs.blockCursor ? blockCursor : [],
];

export function bufferExtensions(options: {
  id: string;
  language: Extension;
  tabSize: number;
  useTabs: boolean;
  readOnly: boolean;
  prefs: IdePrefs;
  onUpdate: (update: ViewUpdate) => void;
}): Extension {
  return [
    editorBasics(),
    ideTheme,
    idSlot.of(bufferId.of(options.id)),
    languageSlot.of(options.language),
    indentSlot.of(indentExtension(options.tabSize, options.useTabs)),
    readOnlySlot.of(readOnlyExtension(options.readOnly)),
    prefsSlot.of(prefsExtension(options.prefs)),
    EditorView.updateListener.of(options.onUpdate),
  ];
}

/** Tabs or 2/4/8 spaces, from how the lines step in; `fallback` when the text says nothing. */
export function detectIndent(text: string, fallback: number): { tabSize: number; useTabs: boolean } {
  let tabs = 0;
  let spaces = 0;
  const steps = new Map<number, number>();
  let previous = 0;
  const lines = text.split("\n", 2000);
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent.startsWith("\t")) tabs++;
    else if (indent.length) spaces++;
    const width = indent.includes("\t") ? -1 : indent.length;
    if (width >= 0) {
      const step = Math.abs(width - previous);
      if (step === 2 || step === 4 || step === 8) steps.set(step, (steps.get(step) ?? 0) + 1);
      previous = width;
    }
  }
  if (tabs > spaces) return { tabSize: fallback, useTabs: true };
  let best = 0;
  let size = fallback;
  for (const [step, count] of steps) {
    if (count > best || (count === best && step < size)) {
      best = count;
      size = step;
    }
  }
  return { tabSize: size, useTabs: false };
}

/** One change turning `doc` into `next`: just the middle that differs, so the cursor and the scroll stay. */
export function minimalChange(doc: Text, next: string): ChangeSpec | null {
  const current = doc.toString();
  if (current === next) return null;
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let end = 0;
  while (end < shortest - start && current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  return { from: start, to: current.length - end, insert: next.slice(start, next.length - end) };
}

export interface CursorInfo {
  line: number;
  col: number;
  selected: number;
  lines: number;
}

export function cursorOf(state: EditorState): CursorInfo {
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  return { line: line.number, col: main.head - line.from + 1, selected: main.to - main.from, lines: state.doc.lines };
}
