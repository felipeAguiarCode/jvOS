import { useEffect, useState } from "react";
import { listContacts, type AgentContact } from "../../lib/agentContacts";
import { AgentAvatar } from "./AgentAvatar";

/**
 * The chat's contacts: the agents JARVIS installed. A click starts (or goes back to) a
 * conversation where that agent answers, confined as JARVIS is. Read again each time the
 * section opens.
 */
export function AgentsList({ onPick }: { onPick: (agent: string) => void }) {
  const [contacts, setContacts] = useState<AgentContact[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listContacts().then((found) => {
      if (!cancelled) setContacts(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ul data-testid="agents-list" className="hud-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
      {contacts?.map((contact) => (
        <li key={contact.name} data-testid="agent-contact" className="rounded-xl hover:bg-hud-light/5">
          <button
            type="button"
            onClick={() => onPick(contact.name)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-hud-light/50"
          >
            <AgentAvatar size={46} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-hud-light">{contact.name}</span>
              <span className="mt-0.5 block truncate text-[13px] text-hud-text/50">{contact.description || "Sem descrição"}</span>
            </span>
          </button>
        </li>
      ))}
      {contacts === null && <li className="px-3 py-6 text-center text-[12px] text-hud-text/40">Carregando agentes…</li>}
      {contacts?.length === 0 && <li className="px-3 py-6 text-center text-[12px] leading-relaxed text-hud-text/40">Nenhum agente ainda. Peça ao JARVIS para criar um.</li>}
    </ul>
  );
}
