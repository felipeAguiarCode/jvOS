import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, NotebookPen } from "lucide-react";
import type { Notes } from "../../hooks/useNotes";
import { answerNoteName, appendAnswer, noteFolder } from "../../lib/notesArea";
import { normalize } from "../../lib/search";

const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-hud-light outline-none hover:bg-hud-light/8 focus-visible:bg-hud-light/8 disabled:cursor-not-allowed disabled:text-hud-text/40 disabled:hover:bg-transparent";
/** The notes offered at once, the latest first. */
const OFFERED = 40;

interface AnswerMenuProps {
  /** Where the pointer was. */
  at: { x: number; y: number };
  question: string;
  /** The answer, in Markdown. */
  answer: string;
  notes: Notes;
  onClose: () => void;
  /** What was done, for the chat's notice line. */
  onTold: (said: { text: string; tone?: "error" }) => void;
}

/**
 * The right-click menu of an answer of the chat: "Adicionar à nota…" (then the note is picked from
 * a list that a field filters) and "Salvar como nova nota" (named after the question). The chat
 * stays on screen; the notice line says where the answer went. It stays up until what it started
 * is written: the notes are open only while it is.
 */
export function AnswerMenu({ at, question, answer, notes, onClose, onTold }: AnswerMenuProps) {
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  /** Writing: nothing else is started, and nothing closes it. */
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  working.current = busy;
  const ready = notes.status === "ready";

  useEffect(() => {
    const close = () => {
      if (!working.current) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only the menu closes: not the answer in progress, nor anything else Esc means.
      event.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const offered = useMemo(() => {
    const wanted = normalize(filter).trim();
    return notes.notes.filter((note) => !note.unreadable && (!wanted || normalize(note.title).includes(wanted))).slice(0, OFFERED);
  }, [notes.notes, filter]);

  const run = (work: () => Promise<string>) => {
    setBusy(true);
    void work()
      .then(
        (text) => onTold({ text }),
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          onTold({ text: reason.includes("file-changed") ? "A nota mudou no disco; a resposta não foi adicionada" : reason, tone: "error" });
        },
      )
      .finally(onClose);
  };
  /** The answer at the end of a note, over the file as it is now (never over a change made meanwhile). */
  const write = async (path: string, text: (contents: string) => string) => {
    const document = await notes.read(path);
    if (!document) throw new Error("Essa nota não é um texto que dá para editar");
    await notes.save(document, text(document.contents), document.stamp);
  };
  const saveNew = () =>
    run(async () => {
      const name = answerNoteName(question, notes.notes.filter((note) => noteFolder(note.path) === "").map((note) => note.title));
      const path = await notes.create(name);
      await write(path, () => `# ${name}\n\n${answer.trim()}\n`);
      return `Resposta salva em “${name}”`;
    });
  const addTo = (path: string, title: string) =>
    run(async () => {
      await write(path, (contents) => appendAnswer(contents, answer));
      return `Resposta adicionada a “${title}”`;
    });

  const width = picking ? 288 : 224;
  const height = picking ? 320 : 84;
  return (
    <div
      role="menu"
      aria-label="Resposta para as notas"
      data-testid="answer-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)), width }}
      className="fixed z-50 rounded-xl border border-hud-line/50 bg-hud-panel p-1 shadow-xl"
    >
      {!picking ? (
        <>
          <button type="button" role="menuitem" autoFocus disabled={!ready || busy} onClick={() => setPicking(true)} className={ITEM}>
            <NotebookPen aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
            Adicionar à nota…
          </button>
          <button type="button" role="menuitem" disabled={!ready || busy} onClick={saveNew} className={ITEM}>
            <FilePlus aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
            Salvar como nova nota
          </button>
          {!ready && <p className="px-2.5 py-1 text-[11px] text-hud-text/45">{notes.status === "unavailable" ? "Disponível no app desktop" : notes.status === "error" ? notes.error : "Abrindo as notas…"}</p>}
        </>
      ) : (
        <>
          <input
            autoFocus
            type="search"
            aria-label="Filtrar notas"
            placeholder="Adicionar a qual nota?"
            value={filter}
            disabled={busy}
            onChange={(event) => setFilter(event.target.value)}
            className="mb-1 w-full rounded-lg bg-chat-field px-2.5 py-1.5 text-[13px] text-hud-light outline-none placeholder:text-hud-text/40 focus-visible:ring-1 focus-visible:ring-hud-light/40"
          />
          <ul className="hud-scroll max-h-64 overflow-y-auto">
            {offered.map((note) => {
              const folder = noteFolder(note.path);
              return (
                <li key={note.path}>
                  <button type="button" role="menuitem" disabled={busy} title={note.path} onClick={() => addTo(note.path, note.title)} className={ITEM}>
                    <span className="truncate">{note.title}</span>
                    {folder && <span className="ml-auto max-w-[45%] shrink-0 truncate pl-2 text-[11px] text-hud-text/40">{folder}</span>}
                  </button>
                </li>
              );
            })}
            {offered.length === 0 && <li className="px-2.5 py-2 text-[12px] text-hud-text/45">{notes.notes.length === 0 ? "Nenhuma nota ainda" : "Nenhuma nota encontrada"}</li>}
          </ul>
        </>
      )}
    </div>
  );
}
