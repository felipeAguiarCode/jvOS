/**
 * Requests for a window that may not be open yet (JARVIS writing a note, reviewing an agent):
 * delivered to the window's listener, or kept — the latest one — until the window opens and
 * takes it. The pattern of jv_sh's `requestTab`.
 */
export function requestChannel<T>() {
  let pending: T | null = null;
  const listeners = new Set<(request: T) => void>();
  return {
    send(request: T) {
      if (listeners.size) listeners.forEach((listener) => listener(request));
      else pending = request;
    },
    listen(listener: (request: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The request sent while nobody listened, once. */
    take(): T | null {
      const request = pending;
      pending = null;
      return request;
    },
  };
}

/**
 * JARVIS writing a file: its text so far, then `done` once it is on disk — with the last text
 * streamed, when there was one (an Edit streams none: the disk has it).
 */
export interface FileRequest {
  path: string;
  content: string | null;
  done: boolean;
}

/** Notes JARVIS writes (Documentos\JARVIS\Notas), for Jarvis Mark. */
export const noteRequests = requestChannel<FileRequest>();

/** Agent drafts JARVIS writes (Documentos\JARVIS\Agentes), for jv_agent. */
export const draftRequests = requestChannel<FileRequest>();
