import { markdown } from "@codemirror/lang-markdown";
import { CodeMirror } from "../CodeMirror";

const language = markdown();

/**
 * jv_agent's second tab: the draft as text. Its own chunk, with CodeMirror (most of the window's
 * weight), so the workshop opens at once while JARVIS is already writing.
 */
export function AgentEditor({ doc, onChange }: { doc: string; onChange: (text: string) => void }) {
  return <CodeMirror doc={doc} onChange={onChange} language={language} wrap className="h-full" />;
}
