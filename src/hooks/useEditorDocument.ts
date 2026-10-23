import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { baseName, canUseFiles, pickAndRead, pickAndWrite, UNAVAILABLE, type FileFilter } from "../lib/files";
import { useStoredState } from "../lib/storage";

/** What the editor keeps between sessions (`jarvis.editor.<key>`). */
interface EditorDraft {
  version: 1;
  content: string;
  path: string | null;
  /** Language picked by hand (code editor); null = from the file name. */
  language: string | null;
  /** The text as last read from or written to disk; null when never saved. */
  savedContent: string | null;
}

const EMPTY: EditorDraft = { version: 1, content: "", path: null, language: null, savedContent: null };
const STATUS_MS = 4000;
const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function parseDraft(raw: unknown): EditorDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const { content, path, language, savedContent } = raw as Record<string, unknown>;
  return {
    version: 1,
    content: typeof content === "string" ? content : "",
    path: typeof path === "string" ? path : null,
    language: typeof language === "string" ? language : null,
    savedContent: typeof savedContent === "string" ? savedContent : null,
  };
}

export interface EditorStatus {
  text: string;
  tone: "info" | "error";
}

export interface EditorDocument {
  content: string;
  setContent: (content: string) => void;
  path: string | null;
  /** File name, or "sem título". */
  fileName: string;
  /** Differs from what is on disk (or was never saved). */
  dirty: boolean;
  language: string | null;
  setLanguage: (language: string | null) => void;
  canUseFiles: boolean;
  newFile: () => void;
  openFile: () => void;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  status: EditorStatus | null;
  /** New/Open asked over unsaved changes: waiting for confirmation. */
  pending: "new" | "open" | null;
  confirmPending: () => void;
  cancelPending: () => void;
}

/**
 * An editor's document: autosaved draft, dirty state and the file operations (desktop only).
 * Closing the window never discards anything — the draft is what reopens.
 */
export function useEditorDocument(key: "markdown" | "code", filters: FileFilter[], defaultName: string): EditorDocument {
  const [draft, setDraft, { quotaExceeded }] = useStoredState(`jarvis.editor.${key}`, EMPTY, parseDraft, 400);
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [pending, setPending] = useState<"new" | "open" | null>(null);
  const statusTimer = useRef(0);

  const show = useCallback((text: string, tone: "info" | "error" = "info") => {
    window.clearTimeout(statusTimer.current);
    setStatus({ text, tone });
    statusTimer.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  useEffect(() => {
    if (quotaExceeded) show("Rascunho grande demais para guardar automaticamente", "error");
  }, [quotaExceeded, show]);

  const dirty = draft.content !== (draft.savedContent ?? "");

  const setContent = useCallback((content: string) => setDraft((current) => (current.content === content ? current : { ...current, content })), [setDraft]);
  const setLanguage = useCallback((language: string | null) => setDraft((current) => ({ ...current, language })), [setDraft]);

  const doNew = useCallback(() => setDraft({ ...EMPTY }), [setDraft]);

  const doOpen = useCallback(async () => {
    try {
      const picked = await pickAndRead(filters, "Abrir arquivo");
      if (!picked) return;
      setDraft({ version: 1, content: picked.contents, path: picked.path, language: null, savedContent: picked.contents });
      show(`Aberto ${baseName(picked.path)}`);
    } catch (error) {
      show(String(error), "error");
    }
  }, [filters, setDraft, show]);

  const newFile = useCallback(() => (dirty ? setPending("new") : doNew()), [dirty, doNew]);

  const openFile = useCallback(() => {
    if (!canUseFiles) return show(UNAVAILABLE, "error");
    if (dirty) setPending("open");
    else void doOpen();
  }, [dirty, doOpen, show]);

  const write = useCallback(
    async (path: string | null) => {
      if (!canUseFiles) return show(`${UNAVAILABLE} · o rascunho fica guardado`, "error");
      try {
        const target = await pickAndWrite(path, draft.content, filters, draft.path ?? defaultName, "Salvar arquivo");
        if (!target) return;
        setDraft((current) => ({ ...current, path: target, savedContent: current.content }));
        show(`Salvo às ${TIME.format(new Date())}`);
      } catch (error) {
        show(String(error), "error");
      }
    },
    [draft.content, draft.path, filters, defaultName, setDraft, show],
  );

  const save = useCallback(() => write(draft.path), [write, draft.path]);
  const saveAs = useCallback(() => write(null), [write]);

  const confirmPending = useCallback(() => {
    const action = pending;
    setPending(null);
    if (action === "new") doNew();
    else if (action === "open") void doOpen();
  }, [pending, doNew, doOpen]);
  const cancelPending = useCallback(() => setPending(null), []);

  return useMemo(
    () => ({
      content: draft.content,
      setContent,
      path: draft.path,
      fileName: draft.path ? baseName(draft.path) : "sem título",
      dirty,
      language: draft.language,
      setLanguage,
      canUseFiles,
      newFile,
      openFile,
      save,
      saveAs,
      status,
      pending,
      confirmPending,
      cancelPending,
    }),
    [draft.content, draft.path, draft.language, dirty, setContent, setLanguage, newFile, openFile, save, saveAs, status, pending, confirmPending, cancelPending],
  );
}
