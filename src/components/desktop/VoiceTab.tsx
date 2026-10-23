import type { ReactNode } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { WINDOW_KINDS, WINDOW_SPECS } from "../../lib/desktop";
import {
  createVoiceCommandId,
  DEFAULT_VOICE_COMMANDS,
  type Activation,
  type Settings,
  type VoiceCommand,
  type VoiceCommandKind,
} from "../../lib/settings";
import { ChipInput, IconButton, Section } from "../hud";

/** The built-in commands, grouped as the tab shows them. */
const SECTIONS: { title: string; hint: string; kinds: VoiceCommandKind[] }[] = [
  {
    title: "Janelas",
    hint: "Com um verbo de abrir ou fechar (“abre o relógio”, “fecha a fita”); a palavra sozinha abre.",
    kinds: ["window"],
  },
  {
    title: "Verbos",
    hint: "Uma palavra por verbo. Os de tocar vêm antes do nome de uma playlist (“toca a Flash FM”, “coloca a treino”).",
    kinds: ["verbs", "playVerbs"],
  },
  { title: "Fechar em grupo", hint: "Só com um verbo de fechar (“fecha todos os widgets”, “fecha tudo”).", kinds: ["group"] },
  {
    title: "Música · jv_T4p3",
    hint: "A frase inteira, palavra por palavra; se uma contém outra, vale a mais longa (“pausa o pomodoro” não pausa a música).",
    kinds: ["music"],
  },
  { title: "Pomodoro", hint: "Com o widget aberto ou não; a dock confirma acima de Widgets.", kinds: ["pomodoro"] },
];

const ACTIVATION_HINT: Record<Activation, string> = {
  pushToTalk: "Segurar para falar: segure Voice (ou M) e diga a frase.",
  wakeWord: "Hey Jarvis: comece com “Jarvis” (“Jarvis, próxima música”).",
  always: "Sempre ouvindo: basta dizer a frase.",
};

/** What a new interaction can do, as "kind:target" (a playlist's name is chosen apart). */
const ACTIONS: { group: string; options: { value: string; label: string }[] }[] = [
  { group: "Abrir ou fechar", options: WINDOW_KINDS.map((kind) => ({ value: `window:${kind}`, label: WINDOW_SPECS[kind].title })) },
  {
    group: "Fechar em grupo",
    options: DEFAULT_VOICE_COMMANDS.filter((command) => command.kind === "group").map((command) => ({ value: `group:${command.target}`, label: command.label })),
  },
  {
    group: "Música",
    options: [
      { value: "playlist:", label: "Tocar uma playlist…" },
      ...DEFAULT_VOICE_COMMANDS.filter((command) => command.kind === "music").map((command) => ({ value: `music:${command.target}`, label: command.label })),
    ],
  },
  {
    group: "Pomodoro",
    options: DEFAULT_VOICE_COMMANDS.filter((command) => command.kind === "pomodoro").map((command) => ({ value: `pomodoro:${command.target}`, label: `Pomodoro: ${command.label.toLowerCase()}` })),
  },
];

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

interface VoiceTabProps {
  settings: Settings;
  onSettings: (change: (current: Settings) => Settings) => void;
  /** Names of every playlist (the stations and the user's), for "Tocar uma playlist". */
  playlists: string[];
}

/**
 * Menu avançado → Voz: everything the voice understands, in one place. Built-in commands keep
 * their action and change their phrases (and can go back to the default); the user's own
 * interactions pick any action. Programs keep their keywords here too.
 */
export function VoiceTab({ settings, onSettings, playlists }: VoiceTabProps) {
  const commands = settings.voiceCommands;
  const custom = commands.filter((command) => !command.builtin);

  const setCommands = (change: (list: VoiceCommand[]) => VoiceCommand[]) =>
    onSettings((current) => ({ ...current, voiceCommands: change(current.voiceCommands) }));
  const patch = (id: string, change: Partial<VoiceCommand>) =>
    setCommands((list) => list.map((command) => (command.id === id ? { ...command, ...change } : command)));

  const add = () =>
    setCommands((list) => [
      ...list,
      { id: createVoiceCommandId(), kind: "music", target: "resume", label: "", phrases: [], builtin: false },
    ]);

  const choose = (command: VoiceCommand, value: string) => {
    const [kind, target] = value.split(":") as [VoiceCommandKind, string];
    // A playlist action always names one (the backend drops it otherwise).
    patch(command.id, { kind, target: kind === "playlist" ? (playlists.includes(command.target) ? command.target : playlists[0] ?? "") : target });
  };

  return (
    <>
      <Section title="Como falar">
        <p className="text-xs leading-relaxed text-hud-text/60">
          {ACTIVATION_HINT[settings.activation]} Acentos e maiúsculas não importam. Mudanças valem na próxima frase. Clique no × de uma
          frase para tirá-la; digite e aperte Enter para acrescentar.
        </p>
      </Section>

      {SECTIONS.map((section) => (
        <Section key={section.title} title={section.title}>
          <p className="text-xs leading-relaxed text-hud-text/50">{section.hint}</p>
          {commands
            .filter((command) => command.builtin && section.kinds.includes(command.kind))
            .map((command) => {
              const original = DEFAULT_VOICE_COMMANDS.find((item) => item.id === command.id);
              const changed = original && !sameList(original.phrases, command.phrases);
              return (
                <Row key={command.id} label={command.label} changed={!!changed} onRestore={() => original && patch(command.id, { phrases: original.phrases })}>
                  <ChipInput
                    items={command.phrases}
                    onChange={(phrases) => patch(command.id, { phrases })}
                    addLabel={`Nova frase para ${command.label}`}
                    removeLabel={(phrase) => `Remover frase “${phrase}” de ${command.label}`}
                    placeholder="Sem frases: desligado"
                  />
                </Row>
              );
            })}
        </Section>
      ))}

      <Section title="Programas">
        <p className="text-xs leading-relaxed text-hud-text/50">Abrem pelo nome (“abre o terminal”); as mesmas palavras-chave das Configurações.</p>
        {settings.apps.map((app) => (
          <Row key={app.id} label={app.name}>
            <ChipInput
              items={app.keywords}
              onChange={(keywords) => onSettings((current) => ({ ...current, apps: current.apps.map((item) => (item.id === app.id ? { ...item, keywords } : item)) }))}
              addLabel={`Nova frase para ${app.name}`}
              removeLabel={(keyword) => `Remover frase “${keyword}” de ${app.name}`}
              placeholder="Sem palavras-chave"
            />
          </Row>
        ))}
      </Section>

      <Section title="Suas interações">
        <p className="text-xs leading-relaxed text-hud-text/50">
          Frases suas para qualquer ação: “hora de treinar” → tocar a sua playlist, “bora focar” → iniciar o Pomodoro.
        </p>
        {custom.map((command, index) => {
          const name = command.label || `Interação ${index + 1}`;
          return (
            <div key={command.id} data-testid="custom-voice-command" className="space-y-2 rounded-xl border border-hud-cyan/12 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <input
                  value={command.label}
                  aria-label="Nome da interação"
                  placeholder={name}
                  onChange={(event) => patch(command.id, { label: event.target.value })}
                  className="hud-input min-w-0 flex-1 text-xs"
                />
                <IconButton label={`Remover ${name}`} onClick={() => setCommands((list) => list.filter((item) => item.id !== command.id))}>
                  <Trash2 size={13} strokeWidth={1.7} />
                </IconButton>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Ação de ${name}`}
                  value={`${command.kind}:${command.kind === "playlist" ? "" : command.target}`}
                  onChange={(event) => choose(command, event.target.value)}
                  className="hud-input min-w-0 flex-1 text-xs"
                >
                  {ACTIONS.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {command.kind === "playlist" && (
                  <select
                    aria-label={`Playlist de ${name}`}
                    value={command.target}
                    onChange={(event) => patch(command.id, { target: event.target.value })}
                    className="hud-input min-w-0 flex-1 text-xs"
                  >
                    {(playlists.includes(command.target) ? playlists : [command.target, ...playlists]).map((playlist) => (
                      <option key={playlist} value={playlist}>
                        {playlist}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <ChipInput
                items={command.phrases}
                onChange={(phrases) => patch(command.id, { phrases })}
                addLabel={`Nova frase para ${name}`}
                removeLabel={(phrase) => `Remover frase “${phrase}” de ${name}`}
                placeholder="O que você vai dizer (Enter para adicionar)"
              />
            </div>
          );
        })}
        <button
          type="button"
          onClick={add}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-hud-cyan/25 py-2 text-xs text-hud-text/70 outline-none transition hover:border-hud-cyan/45 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
        >
          <Plus size={13} strokeWidth={1.8} aria-hidden /> Nova interação
        </button>
      </Section>
    </>
  );
}

function Row({ label, changed = false, onRestore, children }: { label: string; changed?: boolean; onRestore?: () => void; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr_auto] items-start gap-2" data-testid="voice-row">
      <span className="pt-2 text-xs text-hud-text/80">{label}</span>
      {children}
      {onRestore ? (
        <span className="pt-1">
          <IconButton label={`Restaurar ${label}`} disabled={!changed} onClick={onRestore}>
            <RotateCcw size={12} strokeWidth={1.7} />
          </IconButton>
        </span>
      ) : (
        <span className="w-7" />
      )}
    </div>
  );
}
