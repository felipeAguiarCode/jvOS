import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Bold, Code, Columns2, Eye, Heading1, Heading2, Italic, Link, List, ListOrdered, Mic, PenLine, Quote } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEditorDocument, type EditorStatus } from "../../../hooks/useEditorDocument";
import { useDictation, type DictationApi } from "../../../lib/dictation";
import { UNAVAILABLE, type FileFilter } from "../../../lib/files";
import { CodeMirror, type CursorInfo } from "./CodeMirror";
import { ConfirmBar, FileButtons, StatusBar, StatusItem, ToolButton, Toolbar, ToolSeparator } from "./editorChrome";

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

/** Markdown preview styles, in the HUD palette. */
const PREVIEW_COMPONENTS: NonNullable<Parameters<typeof Markdown>[0]["components"]> = {
  h1: (props) => <h1 className="mt-4 mb-3 border-b border-hud-cyan/15 pb-2 text-xl font-semibold tracking-wide text-hud-light first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-4 mb-2 text-lg font-semibold text-hud-light first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-3 mb-2 text-base font-semibold text-hud-light/90" {...props} />,
  h4: (props) => <h4 className="mt-3 mb-1 text-sm font-semibold tracking-[0.08em] text-hud-light/80 uppercase" {...props} />,
  p: (props) => <p className="my-2 leading-relaxed" {...props} />,
  a: (props) => <a className="text-hud-cyan underline decoration-hud-cyan/40 underline-offset-2 hover:text-hud-light" target="_blank" rel="noreferrer" {...props} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-hud-cyan" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-hud-cyan" {...props} />,
  li: (props) => <li className="leading-relaxed [&>input]:mr-2 [&>input]:accent-hud-cyan" {...props} />,
  blockquote: (props) => <blockquote className="my-2 border-l-2 border-hud-cyan/40 pl-3 text-hud-text/75 italic" {...props} />,
  code: ({ className, ...props }) => {
    const block = /language-/.test(className ?? "");
    return <code className={`font-mono text-[12px] ${block ? "" : "rounded bg-hud-cyan/10 px-1 py-px text-hud-holo"} ${className ?? ""}`} {...props} />;
  },
  pre: (props) => <pre className="hud-scroll my-2 overflow-x-auto rounded-lg border border-hud-cyan/12 bg-black/25 p-3 text-hud-text" {...props} />,
  hr: () => <hr className="my-4 border-hud-cyan/15" />,
  table: (props) => <table className="my-2 w-full border-collapse text-xs" {...props} />,
  th: (props) => <th className="border border-hud-cyan/15 bg-hud-cyan/[0.06] px-2 py-1 text-left font-semibold text-hud-light" {...props} />,
  td: (props) => <td className="border border-hud-cyan/15 px-2 py-1" {...props} />,
  img: (props) => <img className="my-2 max-w-full rounded-lg border border-hud-cyan/12" alt="" {...props} />,
  del: (props) => <del className="text-hud-text/50" {...props} />,
};

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
  const inserted = useRef(0);
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
            <Markdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>
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

const HOLD_KEYS = [" ", "Enter"];

/**
 * The editor's own microphone: held like the dock's Voice button (pointer capture keeps the
 * release coming), the text arrives through the dictation context when Whisper is done.
 */
function DictationButton({ dictation }: { dictation: DictationApi }) {
  const holding = useRef(false);
  const listening = dictation.state === "listening";

  const hold = (down: boolean) => {
    if (!dictation.available || holding.current === down) return;
    holding.current = down;
    dictation.hold(down);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Keeps the editor's selection, so the text lands where the cursor was.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    hold(true);
  };

  return (
    <button
      type="button"
      aria-label="Ditar (segure para falar)"
      aria-pressed={listening}
      title={dictation.available ? "Ditar: segure para falar, solte para inserir no cursor" : UNAVAILABLE}
      disabled={!dictation.available}
      onPointerDown={onPointerDown}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      onLostPointerCapture={() => hold(false)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!HOLD_KEYS.includes(event.key)) return;
        event.preventDefault();
        if (!event.repeat) hold(true);
      }}
      onKeyUp={(event) => {
        if (!HOLD_KEYS.includes(event.key)) return;
        event.preventDefault();
        hold(false);
      }}
      onBlur={() => hold(false)}
      className={`relative grid size-7 cursor-pointer touch-none place-items-center rounded-lg outline-none transition select-none focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-30 ${
        listening
          ? "bg-hud-alert/15 text-hud-alert"
          : dictation.state === "transcribing"
            ? "bg-hud-cyan/[0.12] text-hud-light"
            : "text-hud-text/60 hover:bg-hud-cyan/10 hover:text-hud-light"
      }`}
    >
      <Mic size={14} strokeWidth={1.7} />
      {listening && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-hud-alert shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-alert)_80%,transparent)]"
        />
      )}
    </button>
  );
}
