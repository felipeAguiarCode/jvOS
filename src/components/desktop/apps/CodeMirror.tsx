import { useEffect, useRef, type RefObject } from "react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { hudHighlight, hudTheme } from "../../../lib/editorTheme";

export interface CursorInfo {
  line: number;
  col: number;
  /** Selected characters. */
  selected: number;
  lines: number;
}

interface CodeMirrorProps {
  doc: string;
  onChange: (doc: string) => void;
  onCursor?: (cursor: CursorInfo) => void;
  language: Extension | null;
  wrap?: boolean;
  placeholder?: string;
  /** The live view, for toolbar commands. */
  editorRef?: RefObject<EditorView | null>;
  className?: string;
}

/**
 * Thin CodeMirror 6 host. One view per mount (StrictMode-safe); `doc` changes from outside
 * (open, new) replace the text, edits flow out through `onChange`.
 */
export function CodeMirror({ doc, onChange, onCursor, language, wrap = false, placeholder, editorRef, className = "" }: CodeMirrorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onCursor });
  handlers.current = { onChange, onCursor };
  const lastDoc = useRef(doc);
  const languageCompartment = useRef(new Compartment()).current;
  const wrapCompartment = useRef(new Compartment()).current;
  const initial = useRef({ language, wrap, placeholder });

  useEffect(() => {
    const { language, wrap, placeholder } = initial.current;
    const report = (state: EditorState) => {
      const { main } = state.selection;
      const line = state.doc.lineAt(main.head);
      handlers.current.onCursor?.({ line: line.number, col: main.head - line.from + 1, selected: main.to - main.from, lines: state.doc.lines });
    };
    const state = EditorState.create({
      doc: lastDoc.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        hudTheme,
        syntaxHighlighting(hudHighlight),
        languageCompartment.of(language ?? []),
        wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
        placeholder ? placeholderExtension(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            lastDoc.current = text;
            handlers.current.onChange(text);
          }
          if (update.docChanged || update.selectionSet) report(update.state);
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current! });
    view.current = created;
    if (editorRef) editorRef.current = created;
    report(state);
    return () => {
      created.destroy();
      view.current = null;
      if (editorRef) editorRef.current = null;
    };
    // Created once; later prop changes go through the compartments below.
  }, [editorRef, languageCompartment, wrapCompartment]);

  useEffect(() => {
    const current = view.current;
    if (!current || doc === lastDoc.current) return;
    lastDoc.current = doc;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: doc } });
  }, [doc]);

  useEffect(() => {
    view.current?.dispatch({ effects: languageCompartment.reconfigure(language ?? []) });
  }, [language, languageCompartment]);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, wrapCompartment]);

  return <div ref={host} data-allow-context-menu className={`h-full min-h-0 overflow-hidden select-text ${className}`} />;
}
