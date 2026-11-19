import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Bold, Code, Columns2, Eye, Heading1, Heading2, Italic, Link, List, ListOrdered, PenLine, Quote } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEditorDocument, type EditorStatus } from "../../../hooks/useEditorDocument";
import { useDictation, type DictationApi } from "../../../lib/dictation";
import type { FileFilter } from "../../../lib/files";
import { CodeMirror, type CursorInfo } from "./CodeMirror";
import { DictationButton } from "./DictationButton";
import { ConfirmBar, FileButtons, StatusBar, StatusItem, ToolButton, Toolbar, ToolSeparator } from "./editorChrome";
import { MARKDOWN_COMPONENTS } from "./markdownComponents";

type ViewMode = "editor" | "split" | "preview";

const FILTERS: FileFilter[] = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
const VIEWS: { mode: ViewMode; label: string; icon: typeof Eye }[] = [
  { mode: "editor", label: "Só o editor", icon: PenLine },
  { mode: "split", label: "Editor e visualização", icon: Columns2 },
  { mode: "preview", label: "Só a visualização", icon: Eye },
];

/** Wraps each selection with `before`/`after`, or unwraps it when already wrapped. */
function wrapSelection(view: EditorView, before: string, after = before) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const wrapped = text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after);
      const insert = wrapped ? text.slice(before.length, text.length - after.length) : before + text + after;
      const from = range.from + (wrapped ? 0 : before.length);
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(from, from + (wrapped ? insert.length : text.length)) };
    }),
  );
  view.focus();
}

/** Adds the prefix to every selected line, or removes it when every line already has it. */
function prefixLines(view: EditorView, prefix: string | ((index: number) => string)) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const first = view.state.doc.lineAt(range.from).number;
      const last = view.state.doc.lineAt(range.to).number;
      const lines = Array.from({ length: last - first + 1 }, (_, i) => view.state.doc.line(first + i));
      const prefixes = lines.map((_, i) => (typeof prefix === "function" ? prefix(i) : prefix));
      const remove = lines.every((line, i) => line.text.startsWith(prefixes[i]));
      const changes = lines.map((line, i) => (remove ? { from: line.from, to: line.from + prefixes[i].length, insert: "" } : { from: line.from, insert: prefixes[i] }));
      const delta = prefixes.reduce((sum, p) => sum + (remove ? -p.length : p.length), 0);
      return { changes, range: EditorSelection.range(lines[0].from, Math.max(lines[0].from, lines[lines.length - 1].to + delta)) };
    }),
  );
  view.focus();
}

const DICTATION_STATUS: Record<Exclude<DictationApi["state"], "idle">, EditorStatus> = {
  listening: { text: "Ditando… solte para inserir", tone: "info" },
  transcribing: { text: "Transcrevendo…", tone: "info" },
};

/** Markdown editor with live preview, formatting shortcuts, dictation and real files on the desktop. */
export function MarkdownEditor() {
  const document = useEditorDocument("markdown", FILTERS, "sem-titulo.md");
  const dictation = useDictation();
  const [mode, setMode] = useState<ViewMode>("split");
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, selected: 0, lines: 1 });
  const editor = useRef<EditorView | null>(null);
  // What was dictated before this editor opened is not for it.
  const inserted = useRef(dictation.text?.id ?? 0);
  const language = useMemo(() => markdown({ base: markdownLanguage, codeLanguages: languages }), []);
  const words = useMemo(() => document.content.split(/\s+/).filter(Boolean).length, [document.content]);

  const format = (action: (view: EditorView) => void) => {
    if (editor.current) action(editor.current);
  };

  // Dictated text lands at the cursor (or at the end when only the preview is showing).
  const { text: dictated } = dictation;
  const { setContent, content } = document;
  useEffect(() => {
    if (!dictated || dictated.id === inserted.current) return;
    inserted.current = dictated.id;
    const view = editor.current;
    if (view) {
      const { from } = view.state.selection.main;
      const before = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
      const spaced = (before && !/\s/.test(before) ? " " : "") + dictated.text + " ";
      view.dispatch(view.state.replaceSelection(spaced));
      view.focus();
    } else {
      setContent(content + (content && !/\s$/.test(content) ? " " : "") + dictated.text + " ");
    }
  }, [dictated, setContent, content]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const run: Record<string, () => void> = {
      s: () => void (event.shiftKey ? document.saveAs() : document.save()),
      o: document.openFile,
      n: document.newFile,
      b: () => format((view) => wrapSelection(view, "**")),
      i: () => format((view) => wrapSelection(view, "_")),
      k: () => format((view) => wrapSelection(view, "[", "](url)")),
      p: () => setMode((current) => VIEWS[(VIEWS.findIndex((v) => v.mode === current) + 1) % VIEWS.length].mode),
    };
    if (!run[key]) return;
    event.preventDefault();
    run[key]();
  };

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <Toolbar>
        <FileButtons document={document} />
        <ToolSeparator />
        <ToolButton label="Negrito" onClick={() => format((view) => wrapSelection(view, "**"))}>
          <Bold size={14} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Itálico" onClick={() => format((view) => wrapSelection(view, "_"))}>
          <Italic size={14} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Título 1" onClick={() => format((view) => prefixLines(view, "# "))}>
          <Heading1 size={15} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Título 2" onClick={() => format((view) => prefixLines(view, "## "))}>
          <Heading2 size={15} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Lista" onClick={() => format((view) => prefixLines(view, "- "))}>
          <List size={15} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Lista numerada" onClick={() => format((view) => prefixLines(view, (i) => `${i + 1}. `))}>
          <ListOrdered size={15} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Link" onClick={() => format((view) => wrapSelection(view, "[", "](url)"))}>
          <Link size={14} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Código" onClick={() => format((view) => wrapSelection(view, "`"))}>
          <Code size={14} strokeWidth={1.8} />
        </ToolButton>
        <ToolButton label="Citação" onClick={() => format((view) => prefixLines(view, "> "))}>
          <Quote size={14} strokeWidth={1.8} />
        </ToolButton>
        <ToolSeparator />
        <DictationButton dictation={dictation} />
        <span className="flex-1" />
        {VIEWS.map((view) => (
          <ToolButton key={view.mode} label={view.label} active={mode === view.mode} onClick={() => setMode(view.mode)}>
            <view.icon size={14} strokeWidth={1.6} />
          </ToolButton>
        ))}
      </Toolbar>
      <ConfirmBar document={document} />
      <div className={`grid min-h-0 flex-1 ${mode === "split" ? "grid-cols-2" : "grid-cols-1"}`}>
        {mode !== "preview" && (
          <CodeMirror
            doc={document.content}
            onChange={document.setContent}
            onCursor={setCursor}
            language={language}
            wrap
            placeholder="# Escreva em Markdown…"
            editorRef={editor}
            className={mode === "split" ? "border-r border-hud-cyan/10" : ""}
          />
        )}
        {mode !== "editor" && (
          <div data-testid="markdown-preview" className="hud-scroll min-h-0 overflow-y-auto px-5 py-3 text-sm text-hud-text select-text">
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {document.content}
            </Markdown>
          </div>
        )}
      </div>
      <StatusBar badge="MD" document={document} status={dictation.state === "idle" ? document.status : DICTATION_STATUS[dictation.state]}>
        <StatusItem>
          Ln {cursor.line}, Col {cursor.col}
        </StatusItem>
        {cursor.selected > 0 && <StatusItem>{cursor.selected} sel</StatusItem>}
        <StatusItem>{words} palavras</StatusItem>
        <StatusItem>UTF-8</StatusItem>
        <StatusItem>Markdown</StatusItem>
        <StatusItem>{document.canUseFiles ? (document.path ? "arquivo" : "rascunho") : "rascunho"}</StatusItem>
      </StatusBar>
    </div>
  );
}
