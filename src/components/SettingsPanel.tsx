import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  Check,
  Cloud,
  Code,
  Download,
  Globe,
  Loader2,
  Play,
  Plus,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "../lib/commands";
import type { CoreMode } from "../lib/core";
import { createAppId, type Activation, type AppEntry, type Language, type ModelStatus, type Settings } from "../lib/settings";
import { BackgroundNote, BACKGROUNDS, CardPicker, ChipInput, IconButton, Mono, Section, Segmented, Switch, SwitchRow, themeOptions } from "./hud";

const APP_ICONS: Record<string, LucideIcon> = { browser: Globe, vscode: Code, terminal: SquareTerminal, claude: Cloud };

const ACTIVATIONS: { value: Activation; label: string; hint: string }[] = [
  {
    value: "pushToTalk",
    label: "Segurar para falar",
    hint: "Segure o botão Voice (ou a tecla M) enquanto fala, ex.: “abre o terminal”, e solte para enviar, como no WhatsApp. Para cancelar, deslize para a esquerda ou aperte Esc.",
  },
  { value: "wakeWord", label: "Hey Jarvis", hint: "Diga “Hey Jarvis” e o comando, ex.: “Hey Jarvis, abre o navegador”." },
  { value: "always", label: "Sempre ouvindo", hint: "Qualquer frase com uma palavra-chave abre o programa." },
];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
  { value: "auto", label: "Automático" },
];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  onChange: (change: (current: Settings) => Settings) => void;
  /** False in a regular browser: speech and launching need the desktop app. */
  desktop: boolean;
  listening: boolean;
  listeningLabel: string;
  onToggleListening: () => void;
  transcript: string | null;
  models: ModelStatus[];
  progress: Record<string, number>;
  modelErrors: Record<string, string>;
  onDownload: (id: string) => void;
  /** Launches an app; resolves to an error message or null. */
  onTestApp: (id: string) => Promise<string | null>;
  /** Opens the centred advanced menu (closing this panel). */
  onOpenAdvanced: () => void;
  /** Scrolls to this section when the panel opens (from the search). */
  section?: SettingsSection | null;
  /** The core's look (advanced menu): the animated backgrounds need the 3D one. */
  core: CoreMode;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { open, onClose, onOpenAdvanced, section } = props;
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !section) return;
    // After the panel has mounted.
    const frame = requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/25"
          />
          <motion.aside
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label="Configurações"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-4 right-4 bottom-4 z-40 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-hud-cyan/20 bg-hud-panel/82 text-hud-text shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-cyan)_4%,transparent)] backdrop-blur-xl select-text"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-hud-light/40 to-transparent"
            />
            <header className="flex items-center justify-between px-6 pt-5 pb-4">
              <h2 className="text-[11px] font-semibold tracking-[0.32em] text-hud-light uppercase">Configurações</h2>
              <button
                ref={closeButton}
                type="button"
                aria-label="Fechar configurações"
                onClick={onClose}
                className="grid size-8 cursor-pointer place-items-center rounded-lg text-hud-text/60 outline-none transition hover:bg-hud-cyan/10 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
              >
                <X size={16} strokeWidth={1.6} />
              </button>
            </header>
            <PanelBody {...props} />
            <footer className="flex items-center justify-between border-t border-hud-cyan/10 px-6 py-3 text-[10px] tracking-[0.18em] text-hud-text/40 uppercase">
              <span>Alterações salvas automaticamente</span>
              <button
                type="button"
                onClick={onOpenAdvanced}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-hud-text/70 outline-none transition hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
              >
                <SlidersHorizontal size={12} strokeWidth={1.6} aria-hidden /> Menu avançado
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function PanelBody({
  settings,
  onChange,
  core,
  desktop,
  listening,
  listeningLabel,
  onToggleListening,
  transcript,
  models,
  progress,
  modelErrors,
  onDownload,
  onTestApp,
}: SettingsPanelProps) {
  if (!settings) {
    return <div className="flex-1 px-6 text-sm text-hud-text/50">Carregando…</div>;
  }

  const setApp = (id: string, change: (app: AppEntry) => AppEntry) =>
    onChange((current) => ({ ...current, apps: current.apps.map((app) => (app.id === id ? change(app) : app)) }));

  const addApp = () =>
    onChange((current) => ({
      ...current,
      apps: [...current.apps, { id: createAppId(), name: "Novo programa", keywords: [], command: "", builtin: false }],
    }));

  const removeApp = (id: string) => onChange((current) => ({ ...current, apps: current.apps.filter((app) => app.id !== id) }));

  const activation = ACTIVATIONS.find((option) => option.value === settings.activation) ?? ACTIVATIONS[0];
  const selectedModel = models.find((model) => model.id === settings.model);

  return (
    <div className="hud-scroll flex-1 space-y-8 overflow-y-auto px-6 pb-6">
      {!desktop && (
        <p className="rounded-lg border border-hud-cyan/15 bg-hud-cyan/[0.04] px-3 py-2 text-xs leading-relaxed text-hud-text/70">
          Reconhecimento de voz e abertura de programas funcionam no app desktop.
        </p>
      )}

      <Section title="Ativação" id="settings-activation">
        <Segmented
          label="Modo de ativação"
          options={ACTIVATIONS}
          value={settings.activation}
          onChange={(value) => onChange((current) => ({ ...current, activation: value }))}
        />
        <p className="text-xs leading-relaxed text-hud-text/60">{activation.hint}</p>
        <div className="flex items-center justify-between rounded-xl border border-hud-cyan/12 bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-sm text-hud-text">Escuta</div>
            <div className="text-xs text-hud-text/50">{listeningLabel}</div>
          </div>
          <Switch label="Escuta ligada" checked={listening} onChange={onToggleListening} />
        </div>
      </Section>

      <Section title="Aparência" id="settings-appearance">
        <CardPicker
          label="Cor do JARVIS"
          options={themeOptions(settings.accentHue)}
          value={settings.theme}
          onChange={(theme) => onChange((current) => ({ ...current, theme }))}
          columns={2}
        />
        <CardPicker
          label="Fundo"
          options={BACKGROUNDS}
          value={settings.background}
          onChange={(background) => onChange((current) => ({ ...current, background }))}
        />
        <BackgroundNote core={core} />
        <SwitchRow
          label="Barra superior"
          hint="Atalhos das janelas, status, pomodoro, bateria e relógio no topo, estilo Waybar"
          checked={settings.taskbar}
          onChange={() => onChange((current) => ({ ...current, taskbar: !current.taskbar }))}
        />
      </Section>

      <Section title="Reconhecimento de voz" id="settings-voice">
        <div role="radiogroup" aria-label="Modelo Whisper" className="space-y-2">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selected={model.id === settings.model}
              progress={progress[model.id]}
              error={modelErrors[model.id]}
              desktop={desktop}
              onSelect={() => onChange((current) => ({ ...current, model: model.id }))}
              onDownload={() => onDownload(model.id)}
            />
          ))}
        </div>
        {selectedModel && !selectedModel.downloaded && (
          <p className="text-xs text-hud-text/60">Baixe o modelo selecionado para ativar a escuta.</p>
        )}
        <Segmented
          label="Idioma"
          options={LANGUAGES}
          value={settings.language}
          onChange={(value) => onChange((current) => ({ ...current, language: value }))}
        />
        <div className="text-xs text-hud-text/50">
          Último reconhecimento:{" "}
          <span className="text-hud-text/80" data-testid="last-transcript">
            {transcript ? `“${transcript}”` : "—"}
          </span>
        </div>
      </Section>

      <Section title="Programas e palavras-chave" id="settings-apps">
        <p className="text-xs leading-relaxed text-hud-text/60">
          Quando uma palavra-chave é reconhecida, o comando é executado. Use o nome de um programa no PATH
          (<Mono>wt</Mono>, <Mono>code</Mono>), um caminho entre aspas ou uma URL.
        </p>
        <div className="space-y-3">
          {settings.apps.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              desktop={desktop}
              onChange={(change) => setApp(app.id, change)}
              onRemove={() => removeApp(app.id)}
              onTest={() => onTestApp(app.id)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addApp}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-hud-cyan/25 py-2.5 text-xs tracking-[0.18em] text-hud-text/70 uppercase outline-none transition hover:border-hud-cyan/50 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
        >
          <Plus size={14} strokeWidth={1.6} /> Adicionar programa
        </button>
      </Section>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function ModelCard({
  model,
  selected,
  progress,
  error,
  desktop,
  onSelect,
  onDownload,
}: {
  model: ModelStatus;
  selected: boolean;
  progress: number | undefined;
  error: string | undefined;
  desktop: boolean;
  onSelect: () => void;
  onDownload: () => void;
}) {
  const downloading = progress !== undefined || model.downloading;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        selected ? "border-hud-cyan/40 bg-hud-cyan/[0.06]" : "border-hud-cyan/12 bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={`Modelo ${model.label}`}
        onClick={onSelect}
        className="flex flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:underline"
      >
        <span
          aria-hidden
          className={`grid size-4 shrink-0 place-items-center rounded-full border ${selected ? "border-hud-light" : "border-hud-text/30"}`}
        >
          {selected && <span className="size-2 rounded-full bg-hud-light shadow-[0_0_8px_color-mix(in_oklab,var(--color-hud-light)_90%,transparent)]" />}
        </span>
        <span>
          <span className="block text-sm text-hud-text">
            {model.label} <span className="text-hud-text/45">· {formatSize(model.size)}</span>
          </span>
          <span className="block text-xs text-hud-text/50">{error ?? model.description}</span>
        </span>
      </button>
      {model.downloaded ? (
        <span className="flex items-center gap-1 text-[10px] tracking-[0.16em] text-hud-light/80 uppercase">
          <Check size={13} strokeWidth={1.8} /> Baixado
        </span>
      ) : downloading ? (
        <div className="w-20 text-right" aria-label={`Baixando ${model.label}`}>
          <div className="mb-1 flex items-center justify-end gap-1 text-[10px] text-hud-text/60">
            <Loader2 size={11} className="animate-spin" /> {Math.round((progress ?? 0) * 100)}%
          </div>
          <div className="h-0.5 overflow-hidden rounded-full bg-hud-cyan/15">
            <div className="h-full bg-hud-light transition-[width]" style={{ width: `${(progress ?? 0) * 100}%` }} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onDownload}
          disabled={!desktop}
          aria-label={`Baixar modelo ${model.label}`}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-hud-cyan/25 px-2.5 py-1.5 text-[10px] tracking-[0.16em] text-hud-text/80 uppercase outline-none transition hover:border-hud-cyan/60 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={12} strokeWidth={1.8} /> Baixar
        </button>
      )}
    </div>
  );
}

function AppRow({
  app,
  desktop,
  onChange,
  onRemove,
  onTest,
}: {
  app: AppEntry;
  desktop: boolean;
  onChange: (change: (app: AppEntry) => AppEntry) => void;
  onRemove: () => void;
  onTest: () => Promise<string | null>;
}) {
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const Icon = APP_ICONS[app.id] ?? AppWindow;

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 2600);
    return () => window.clearTimeout(timer);
  }, [result]);

  const test = async () => {
    const error = await onTest();
    setResult(error ? { text: error, error: true } : { text: "Abrindo…", error: false });
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-hud-cyan/12 bg-white/[0.02] p-3" data-testid={`app-${app.id}`}>
      <div className="flex items-center gap-2.5">
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-hud-light/80" aria-hidden />
        {app.builtin ? (
          <span className="flex-1 text-sm text-hud-text">{app.name}</span>
        ) : (
          <input
            value={app.name}
            aria-label="Nome do programa"
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            className="hud-input flex-1 py-1"
          />
        )}
        <IconButton label={`Testar ${app.name}`} disabled={!desktop || !app.command.trim()} onClick={() => void test()}>
          <Play size={13} strokeWidth={1.7} />
        </IconButton>
        {!app.builtin && (
          <IconButton label={`Remover ${app.name}`} onClick={onRemove}>
            <Trash2 size={13} strokeWidth={1.7} />
          </IconButton>
        )}
      </div>
      <ChipInput
        items={app.keywords}
        onChange={(keywords) => onChange((current) => ({ ...current, keywords }))}
        addLabel={`Nova palavra-chave para ${app.name}`}
        removeLabel={(keyword) => `Remover palavra-chave ${keyword}`}
        placeholder="Palavras-chave (Enter para adicionar)"
      />
      <label className="block">
        <span className="mb-1 block text-[10px] tracking-[0.18em] text-hud-text/45 uppercase">Comando</span>
        <input
          value={app.command}
          spellCheck={false}
          placeholder="ex.: notepad, “C:\\…\\app.exe”, https://…"
          onChange={(event) => onChange((current) => ({ ...current, command: event.target.value }))}
          className="hud-input w-full font-mono text-xs"
        />
      </label>
      {result && (
        <p role="status" className={`text-xs ${result.error ? "text-hud-alert/90" : "text-hud-light/80"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
