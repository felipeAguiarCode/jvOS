import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import type { EditorView } from "@codemirror/view";
import { Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NoteDocument, Notes } from "../../hooks/useNotes";
import { useDictation } from "../../lib/dictation";
import { NOTE_VIEWS, noteTitle, SAVE_DELAY_MS, TITLE_LENGTH, type NoteView } from "../../lib/notesArea";
import { backlinks, linkedMarkdown, readHref, type NotesGraphData } from "../../lib/notesGraph";
import { FILE_CHANGED, type Stamp } from "../../lib/workspace";
import { CodeMirror } from "../desktop/apps/CodeMirror";
import { DictationButton } from "../desktop/apps/DictationButton";
import { MARKDOWN_COMPONENTS } from "../desktop/apps/markdownComponents";

/** What the header says about the note's file. */
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; text: string } | { kind: "conflict" };

/** The note in the editor: its file as last read or written, and the text on screen. */
interface Editing {
  document: NoteDocument;
  stamp: Stamp;
  /** What is on disk, as far as this editor knows. */
  saved: string;
  text: string;
  timer: number;
  /** The save in progress, if any: the next one waits for it. */
  saving: Promise<void> | null;
  conflict: boolean;
}

interface NotesPanelProps {
  notes: Notes;
  /** The note to show (null: none). */
  path: string | null;
  onPath: (path: string | null) => void;
  view: NoteView;
  onView: (view: NoteView) => void;
  /** A note just made: its title takes the focus, selected, to be named. */
  naming: boolean;
  onNamed: () => void;
  /** The notes' links and tags, for "Mencionada em". */
  graph: NotesGraphData;
  /** A `[[link]]` clicked in the rendered note: its note opens (or is made). */
  onLink: (target: string) => void;
  /** A `#tag` clicked: the list is searched for it. */
  onTag: (tag: string) => void;
}

/**
 * A note of the notes area: its title (which names the file), the Markdown editor and the
 * rendered note. It saves itself a moment after the last key and before anything else takes its
 * place; a file changed on disk meanwhile is never written over without asking.
 */
export function NotesPanel({ notes, path, onPath, view, onView, naming, onNamed, graph, onLink, onTag }: NotesPanelProps) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const editing = useRef<Editing | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const editor = useRef<EditorView | null>(null);
  const language = useMemo(() => markdown({ base: markdownLanguage, codeLanguages: languages }), []);
  // The rendered note: its [[links]] and #tags are clickable, the rest is the usual Markdown.
  const rendered = useMemo(() => linkedMarkdown(text, notes.notes), [text, notes.notes]);
  const components = useMemo(
    () => ({
      ...MARKDOWN_COMPONENTS,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const link = readHref(href);
        if (!link) {
          return (
            <a className="text-hud-cyan underline decoration-hud-cyan/40 underline-offset-2 hover:text-hud-light" target="_blank" rel="noreferrer" href={href}>
              {children}
            </a>
          );
        }
        const act = (event: { preventDefault: () => void }) => {
          event.preventDefault();
          if (link.kind === "note") onLink(link.target);
          else onTag(link.tag);
        };
        return link.kind === "note" ? (
          <a
            href={href}
            data-note-link={link.missing ? "missing" : "note"}
            title={link.missing ? `Criar a nota "${link.target}"` : link.target}
            onClick={act}
            className={link.missing ? "cursor-pointer text-hud-text/50 underline decoration-dashed underline-offset-2 hover:text-hud-light" : "cursor-pointer text-hud-holo underline decoration-hud-holo/50 underline-offset-2 hover:text-hud-light"}
          >
            {children}
          </a>
        ) : (
          <a href={href} data-note-tag={link.tag} onClick={act} className="cursor-pointer rounded bg-hud-amber/10 px-1 text-hud-amber no-underline hover:bg-hud-amber/20">
            {children}
          </a>
        );
      },
    }),
    [onLink, onTag],
  );
  const mentions = useMemo(() => (path ? backlinks(graph, path) : []), [graph, path]);
  const { read, save: write, rename, remove } = notes;

  /** Writes what is on screen, if it differs from the disk. Never over a conflict. */
  const flush = useCallback(
    async (doc: Editing | null = editing.current, force = false): Promise<void> => {
      if (!doc) return;
      window.clearTimeout(doc.timer);
      doc.timer = 0;
      if (doc.saving) await doc.saving;
      if (doc.text === doc.saved || (doc.conflict && !force)) return;
      const contents = doc.text;
      const shown = () => editing.current === doc;
      if (shown()) setSave({ kind: "saving" });
      doc.saving = write(doc.document, contents, force ? null : doc.stamp).then(
        (stamp) => {
          doc.stamp = stamp;
          doc.saved = contents;
          doc.conflict = false;
          if (shown()) setSave(doc.text === contents ? { kind: "saved" } : { kind: "saving" });
        },
        (failure: unknown) => {
          const changed = String(failure).includes(FILE_CHANGED);
          doc.conflict = changed;
          if (shown()) setSave(changed ? { kind: "conflict" } : { kind: "error", text: String(failure) });
        },
      );
      await doc.saving;
      doc.saving = null;
      // Typed on while it was being written: that goes too.
      if (doc.text !== doc.saved && !doc.conflict && doc.timer === 0) doc.timer = window.setTimeout(() => void flush(doc), SAVE_DELAY_MS);
    },
    [write],
  );

  /** Reads the note from disk into the editor. */
  const load = useCallback(
    async (target: string) => {
      const document = await read(target).catch(() => null);
      if (!document) return false;
      editing.current = { document, stamp: document.stamp, saved: document.contents, text: document.contents, timer: 0, saving: null, conflict: false };
      setText(document.contents);
      setLoaded(target);
      setSave({ kind: "idle" });
      return true;
    },
    [read],
  );

  // Another note (or none): the one on screen is saved first, then the new one is read.
  const ready = notes.status === "ready";
  useEffect(() => {
    if (!path || !ready) return;
    let cancelled = false;
    setTitle(noteTitle(path));
    setTitleError(null);
    setConfirming(false);
    setUnreadable(false);
    void load(path).then((ok) => {
      if (!cancelled && !ok) setUnreadable(true);
    });
    return () => {
      cancelled = true;
      const doc = editing.current;
      editing.current = null;
      setLoaded(null);
      void flush(doc);
    };
  }, [path, ready, load, flush]);

  // A note just made is named first.
  useEffect(() => {
    if (!naming || loaded !== path) return;
    titleField.current?.focus();
    titleField.current?.select();
    onNamed();
  }, [naming, loaded, path, onNamed]);

  // What changed on disk: gone, the editor closes; changed with nothing typed, it is read again.
  const listed = path ? notes.notes.find((note) => note.path === path) : undefined;
  const listedStamp = listed ? `${listed.modified}:${listed.size}` : null;
  useEffect(() => {
    const doc = editing.current;
    if (!path || !ready || loaded !== path || !doc) return;
    if (listedStamp === null) return onPath(null);
    if (listedStamp === `${doc.stamp.modified}:${doc.stamp.size}`) return;
    if (doc.text === doc.saved && !doc.saving) void load(path);
  }, [path, ready, loaded, listedStamp, load, onPath]);

  const change = (next: string) => {
    setText(next);
    const doc = editing.current;
    if (!doc) return;
    doc.text = next;
    if (doc.conflict) return;
    window.clearTimeout(doc.timer);
    doc.timer = window.setTimeout(() => void flush(doc), SAVE_DELAY_MS);
    setSave({ kind: "saving" });
  };

  // Dictation (hold the microphone): what was said lands at the cursor, or at the end of the
  // note when only the rendered side is showing, and is saved like anything typed.
  const dictation = useDictation();
  const { text: dictated } = dictation;
  // What was dictated before this editor opened is not for it.
  const inserted = useRef(dictated?.id ?? 0);
  useEffect(() => {
    if (!dictated || dictated.id === inserted.current) return;
    inserted.current = dictated.id;
    const doc = editing.current;
    if (!dictated.text.trim() || !doc) return;
    const current = editor.current;
    if (current) {
      const { from } = current.state.selection.main;
      const before = from > 0 ? current.state.sliceDoc(from - 1, from) : "";
      // The editor's own change handler takes it from here (the text, the autosave).
      current.dispatch(current.state.replaceSelection(`${before && !/\s/.test(before) ? " " : ""}${dictated.text} `));
      current.focus();
    } else {
      change(`${doc.text}${doc.text && !/\s$/.test(doc.text) ? " " : ""}${dictated.text} `);
    }
    // Only a new dictation inserts (`change` is this render's, as the text is).
  }, [dictated]);

  const commitTitle = async () => {
    if (!path || title === noteTitle(path)) return setTitleError(null);
    await flush();
    const result = await rename(path, title);
    if (!result.ok) return setTitleError(result.reason);
    setTitleError(null);
    onPath(result.path);
  };

  const deleteNote = async () => {
    if (!path) return;
    const index = notes.notes.findIndex((note) => note.path === path);
    const next = notes.notes[index + 1] ?? notes.notes[index - 1] ?? null;
    // Nothing of it is written again.
    const doc = editing.current;
    if (doc) {
      window.clearTimeout(doc.timer);
      doc.saved = doc.text;
    }
    try {
      await remove(path);
      onPath(next?.path ?? null);
    } catch (failure) {
      setSave({ kind: "error", text: String(failure) });
    }
    setConfirming(false);
  };

  if (notes.status === "unavailable") return <Empty>Disponível no app desktop</Empty>;
  if (notes.status === "error") return <Empty tone="error">{notes.error}</Empty>;
  if (!path) return <Empty>{notes.status === "loading" ? "Carregando notas…" : notes.notes.length ? "Escolha uma nota ou crie uma nova" : "Nenhuma nota ainda. Crie a primeira, ou peça ao JARVIS para anotar algo."}</Empty>;

  const open = loaded === path;
  return (
    <div data-testid="notes-panel" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-hud-line/60 bg-hud-panel px-4">
        <input
          ref={titleField}
          aria-label="Título da nota"
          aria-invalid={titleError !== null}
          value={title}
          maxLength={TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitTitle().then(() => editor.current?.focus());
            } else if (event.key === "Escape") {
              // The name as it was; not for the answer in progress.
              event.preventDefault();
              setTitle(noteTitle(path));
              setTitleError(null);
            }
          }}
          className="min-w-0 flex-1 truncate bg-transparent text-[15px] font-semibold text-hud-light outline-none select-text placeholder:text-hud-text/35"
          placeholder="Título"
        />
        <span role="status" data-testid="note-status" className={`shrink-0 text-[11px] ${titleError || save.kind === "error" ? "text-hud-alert" : "text-hud-text/45"}`}>
          {titleError ??
            (dictation.state === "listening"
              ? "Ditando… solte para inserir"
              : dictation.state === "transcribing"
                ? "Transcrevendo…"
                : save.kind === "saving"
                  ? "Salvando…"
                  : save.kind === "saved"
                    ? "Salvo"
                    : save.kind === "error"
                      ? save.text
                      : "")}
        </span>
        <DictationButton dictation={dictation} />
        <div role="group" aria-label="Visão da nota" className="flex shrink-0 overflow-hidden rounded-lg border border-hud-line/40">
          {NOTE_VIEWS.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-pressed={view === item.view}
              onClick={() => onView(item.view)}
              className={`cursor-pointer px-2.5 py-1 text-[11px] outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
                view === item.view ? "bg-hud-cyan/20 text-hud-light" : "text-hud-text/60 hover:text-hud-light"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {confirming ? (
          <span role="group" aria-label="Apagar nota?" className="flex shrink-0 items-center gap-1 text-[11px] text-hud-text/80">
            Apagar?
            <button type="button" autoFocus onClick={() => void deleteNote()} className="cursor-pointer rounded px-2 py-1 text-hud-alert outline-none hover:bg-hud-alert/15 focus-visible:ring-1 focus-visible:ring-hud-alert/60">
              Sim, apagar
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="cursor-pointer rounded px-2 py-1 outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50">
              Não
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Apagar nota"
            title="Apagar nota (vai para a Lixeira)"
            onClick={() => setConfirming(true)}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-hud-text/60 outline-none transition hover:bg-hud-alert/15 hover:text-hud-alert focus-visible:ring-1 focus-visible:ring-hud-light/50"
          >
            <Trash2 size={14} strokeWidth={1.7} />
          </button>
        )}
      </header>
      {save.kind === "conflict" && (
        <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-hud-amber/40 bg-hud-amber/10 px-4 py-1.5 text-[12px] text-hud-amber">
          <span className="flex-1">A nota mudou no disco.</span>
          <button type="button" onClick={() => void load(path)} className="cursor-pointer rounded px-2 py-0.5 outline-none hover:bg-hud-amber/15 focus-visible:ring-1 focus-visible:ring-hud-amber/60">
            Recarregar
          </button>
          <button type="button" onClick={() => void flush(editing.current, true)} className="cursor-pointer rounded px-2 py-0.5 outline-none hover:bg-hud-amber/15 focus-visible:ring-1 focus-visible:ring-hud-amber/60">
            Manter a minha
          </button>
        </div>
      )}
      {unreadable ? (
        <Empty>Esta nota não pode ser aberta aqui</Empty>
      ) : !open ? (
        <Empty>Abrindo…</Empty>
      ) : (
        <div className="flex min-h-0 flex-1">
          {view !== "read" && (
            <div data-testid="note-editor" className={`min-h-0 min-w-0 ${view === "split" ? "w-1/2 border-r border-hud-line/30" : "flex-1"}`}>
              <CodeMirror key={path} doc={text} onChange={change} language={language} wrap placeholder="Escreva aqui…" editorRef={editor} />
            </div>
          )}
          {view !== "write" && (
            <div data-testid="note-preview" className="hud-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4 text-[13px] text-hud-text/90 select-text">
              <Markdown remarkPlugins={[remarkGfm]} components={components}>
                {rendered}
              </Markdown>
            </div>
          )}
        </div>
      )}
      {open && mentions.length > 0 && (
        <footer data-testid="note-backlinks" className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-hud-line/30 px-4 py-2 text-[11px] text-hud-text/55">
          Mencionada em
          {mentions.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onPath(node.id)}
              className="cursor-pointer rounded bg-hud-cyan/10 px-1.5 py-0.5 text-hud-holo outline-none hover:bg-hud-cyan/20 focus-visible:ring-1 focus-visible:ring-hud-light/50"
            >
              {node.label}
            </button>
          ))}
        </footer>
      )}
    </div>
  );
}

function Empty({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div data-testid="notes-empty" className={`flex flex-1 items-center justify-center px-8 text-center text-[13px] ${tone === "error" ? "text-hud-alert" : "text-hud-text/45"}`}>
      {children}
    </div>
  );
}
