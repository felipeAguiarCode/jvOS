import { useEffect, useMemo, useRef, useState } from "react";
import { loadProfiles, terminalBackend, type TerminalProfile } from "../../../../lib/terminal";
import { TerminalView } from "../terminal/TerminalView";
import { useIde, useStore } from "./context";
import { PanelFrame, usePanelFocus } from "./PanelFrame";

/** A shell in the project folder, as a panel; exiting cleanly closes it, [x] ends the shell. */
export function TerminalPanel({ id, profile }: { id: string; profile: string | null }) {
  const store = useStore();
  const { root, layout } = useIde();
  const backend = useMemo(() => terminalBackend(), []);
  const [chosen, setChosen] = useState<TerminalProfile | null | undefined>(undefined);
  const [title, setTitle] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  // Where it started: switching projects does not move a running shell.
  const [cwd] = useState(root);
  const holder = useRef<HTMLDivElement>(null);
  const focused = layout.focus === id;
  usePanelFocus(id, () => holder.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());

  useEffect(() => {
    let alive = true;
    void loadProfiles().then((profiles) => {
      if (!alive) return;
      const list = profiles?.profiles ?? [];
      setChosen(list.find((item) => item.id === profile) ?? list.find((item) => item.id === profiles?.default) ?? list[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [profile]);

  const name = chosen?.name ?? "…";
  const label = `Terminal ${id.replace("term-", "")}`;

  return (
    <PanelFrame
      id={id}
      label={label}
      title={`Terminal · ${title && title !== name ? `${name} · ${title}` : name}${exitCode !== null ? " (encerrado)" : ""}`}
      aside={cwd ? <span className="max-w-[40ch] truncate">{cwd}</span> : null}
    >
      <div ref={holder} className="absolute inset-0">
        {!backend ? (
          <div className="p-2 text-hud-text/50">Disponível no app desktop</div>
        ) : chosen === null ? (
          <div className="p-2 text-hud-text/50">Nenhum perfil de terminal encontrado</div>
        ) : chosen ? (
          <TerminalView
            profile={chosen}
            cwd={cwd}
            label={`${label} · ${name}`}
            role="region"
            active
            autoFocus={focused}
            backend={backend}
            onTitle={setTitle}
            onExit={(code) => (code === 0 || code === null ? store.closePanel(id) : setExitCode(code))}
          />
        ) : null}
      </div>
    </PanelFrame>
  );
}
