import { invoke, isTauri } from "@tauri-apps/api/core";

/** Agentes como contatos (feature agent-contacts). What it does and why: .specs/features/agent-contacts/spec.md. */

/** An agent the user can talk to in the chat. Mirrors `Contact` in src-tauri/src/agents.rs. */
export interface AgentContact {
  name: string;
  description: string;
}

/** Tolerant: what is not a contact is left out. */
export function parseContacts(raw: unknown): AgentContact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, description } = item as Record<string, unknown>;
    return typeof name === "string" && name ? [{ name, description: typeof description === "string" ? description : "" }] : [];
  });
}

/**
 * The chat's contacts: the agents JARVIS installed, with a valid draft (`agent_contacts`). In a
 * browser test, the ones the scripted JARVIS is given (`__JARVIS_ASSISTANT__.agents`); none
 * outside the app.
 */
export async function listContacts(): Promise<AgentContact[]> {
  if (isTauri()) return invoke<unknown>("agent_contacts").then(parseContacts, () => []);
  const fake = import.meta.env.DEV ? window.__JARVIS_ASSISTANT__ : undefined;
  return typeof fake === "object" ? parseContacts(fake.agents) : [];
}
