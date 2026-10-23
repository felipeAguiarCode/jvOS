import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ArrangeMode } from "../../hooks/useDesktop";
import type { BootPrefs } from "../../lib/boot";
import { CORE_MODES, type CorePrefs } from "../../lib/core";
import type { AdvancedTab } from "../../lib/commands";
import type { DesktopPrefs, SnapDistance, WindowStyle } from "../../lib/desktop";
import type { DockPrefs } from "../../lib/dock";
import type { Settings } from "../../lib/settings";
import { TASKBAR_MODULES, type TaskbarModules } from "../../lib/taskbar";
import { paletteFor, paletteFromHue } from "../../lib/theme";
import { TUI_ACCENTS, tuiSurface, type TuiAccent, type TuiPrefs } from "../../lib/tui";
import { VoiceTab } from "./VoiceTab";
import {
  ActionButton,
  BackgroundNote,
  BACKGROUNDS,
  CardPicker,
  CORE_OPTIONS,
  Range,
  Section,
  Segmented,
  SwitchRow,
  themeOptions,
  type CardOption,
} from "../hud";

type Tab = AdvancedTab;

const TABS: { id: Tab; label: string }[] = [
  { id: "colors", label: "Cores" },
  { id: "core", label: "Núcleo" },
  { id: "windows", label: "Janelas" },
  { id: "layout", label: "Layout" },
  { id: "tui", label: "TUI" },
  { id: "taskbar", label: "Barra superior" },
  { id: "dock", label: "Dock" },
  { id: "voice", label: "Voz" },
];

const WINDOW_STYLES: { value: WindowStyle; label: string }[] = [
  { value: "tui", label: "TUI" },
  { value: "holo", label: "Holográfico" },
];

const DISTANCES: { value: `${SnapDistance}`; label: string }[] = [
  { value: "8", label: "Curta" },
  { value: "14", label: "Média" },
  { value: "24", label: "Longa" },
];

/** The slider's track: the hue circle at the accent's lightness and chroma. */
const HUE_TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => `oklch(0.78 0.14 ${i * 30})`).join(", ")})`;

interface AdvancedMenuProps {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  onSettings: (change: (current: Settings) => Settings) => void;
  prefs: DesktopPrefs;
  onPrefs: (change: (prefs: DesktopPrefs) => DesktopPrefs) => void;
  /** Open desktop windows. */
  windows: number;
  onArrange: (mode: ArrangeMode) => void;
  onCloseAll: () => void;
  boot: BootPrefs;
  onBoot: (change: (prefs: BootPrefs) => BootPrefs) => void;
  /** Closes the menu and plays the boot screen again. */
  onReplayBoot: () => void;
  /** Tab to show when it opens (from the search); otherwise the last one. */
  initialTab?: Tab | null;
  tui: TuiPrefs;
  onTui: (change: (prefs: TuiPrefs) => TuiPrefs) => void;
  taskbarModules: TaskbarModules;
  onTaskbarModules: (change: (modules: TaskbarModules) => TaskbarModules) => void;
  dock: DockPrefs;
  onDock: (change: (prefs: DockPrefs) => DockPrefs) => void;
  core: CorePrefs;
  onCore: (change: (prefs: CorePrefs) => CorePrefs) => void;
  /** Names of every playlist, for voice interactions that play one. */
  playlists: string[];
}

/** Centred preferences dialog with a tab column: colours, window behaviour, layout. */
export function AdvancedMenu({
  open,
  onClose,
  settings,
  onSettings,
  prefs,
  onPrefs,
  windows,
  onArrange,
  onCloseAll,
  boot,
  onBoot,
  onReplayBoot,
  initialTab,
  tui,
  onTui,
  taskbarModules,
  onTaskbarModules,
  dock,
  onDock,
  core,
  onCore,
  playlists,
}: AdvancedMenuProps) {
  const [tab, setTab] = useState<Tab>("colors");
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A field must not keep the focus while the menu fades out, or the next "/" lands in it.
  const close = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && panel.current?.contains(active)) active.blur();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

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
            onClick={close}
            className="fixed inset-0 z-30 bg-black/25"
          />
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18 } }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed inset-0 z-40 grid place-items-center p-4"
          >
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label="Menu avançado"
              className="pointer-events-auto relative grid h-[480px] max-h-full w-[720px] max-w-full grid-cols-[180px_1fr] grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-hud-cyan/20 bg-hud-panel/82 text-hud-text shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-cyan)_4%,transparent)] backdrop-blur-xl select-text"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-hud-light/40 to-transparent"
              />
              <header className="col-span-2 flex items-center justify-between border-b border-hud-cyan/10 px-6 pt-5 pb-4">
                <h2 className="text-[11px] font-semibold tracking-[0.32em] text-hud-light uppercase">Menu avançado</h2>
                <button
                  ref={closeButton}
                  type="button"
                  aria-label="Fechar menu avançado"
                  onClick={close}
                  className="grid size-8 cursor-pointer place-items-center rounded-lg text-hud-text/60 outline-none transition hover:bg-hud-cyan/10 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
                >
                  <X size={16} strokeWidth={1.6} />
                </button>
              </header>

              <nav role="tablist" aria-orientation="vertical" aria-label="Seções" className="flex flex-col gap-1 border-r border-hud-cyan/10 p-3">
                {TABS.map((item) => {
                  const active = item.id === tab;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`advanced-tab-${item.id}`}
                      aria-selected={active}
                      aria-controls={`advanced-panel-${item.id}`}
                      onClick={() => setTab(item.id)}
                      className={`relative cursor-pointer rounded-lg px-3 py-2.5 text-left text-xs tracking-[0.14em] uppercase outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
                        active ? "text-hud-light" : "text-hud-text/55 hover:text-hud-text"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="advanced-tab"
                          className="absolute inset-0 rounded-lg border border-hud-cyan/30 bg-hud-cyan/[0.09] shadow-[0_0_14px_color-mix(in_oklab,var(--color-hud-cyan)_15%,transparent)]"
                          transition={{ duration: 0.25, ease: "easeOut" }}
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div
                role="tabpanel"
                id={`advanced-panel-${tab}`}
                aria-labelledby={`advanced-tab-${tab}`}
                className="hud-scroll min-h-0 space-y-7 overflow-y-auto px-6 py-5"
              >
                {tab === "colors" && (
                  <Section title="Inicialização">
                    <SwitchRow
                      label="Tela de inicialização"
                      hint="BIOS num monitor CRT ao abrir o JARVIS; qualquer tecla pula"
                      checked={boot.enabled}
                      onChange={() => onBoot((current) => ({ ...current, enabled: !current.enabled }))}
                    />
                    <SwitchRow
                      label="Sons da inicialização"
                      hint="Bipe de POST e cliques de teclado"
                      checked={boot.sound}
                      onChange={() => onBoot((current) => ({ ...current, sound: !current.sound }))}
                    />
                    <ActionButton label="Ver agora" onClick={onReplayBoot} />
                  </Section>
                )}
                {tab === "colors" &&
                  (settings ? (
                    <Section title="Aparência">
                      <CardPicker
                        label="Cor do JARVIS"
                        options={themeOptions(settings.accentHue)}
                        value={settings.theme}
                        onChange={(theme) => onSettings((current) => ({ ...current, theme }))}
                        columns={2}
                      />
                      <Range
                        label="Matiz"
                        min={0}
                        max={359}
                        value={Math.round(settings.accentHue)}
                        format={(value) => `${value}°`}
                        track={HUE_TRACK}
                        onChange={(accentHue) => onSettings((current) => ({ ...current, theme: "custom", accentHue }))}
                      />
                      <PaletteStrip hue={settings.accentHue} />
                      <CardPicker
                        label="Fundo"
                        options={BACKGROUNDS}
                        value={settings.background}
                        onChange={(background) => onSettings((current) => ({ ...current, background }))}
                      />
                      <BackgroundNote core={core.mode} />
                    </Section>
                  ) : (
                    <p className="text-sm text-hud-text/50">Carregando…</p>
                  ))}

                {tab === "core" && (
                  <>
                    <Section title="Núcleo">
                      <CardPicker
                        label="Visual do núcleo"
                        options={CORE_OPTIONS}
                        value={core.mode}
                        onChange={(mode) => onCore((current) => ({ ...current, mode }))}
                      />
                      <p className="text-xs leading-relaxed text-hud-text/55">{CORE_MODES.find((mode) => mode.value === core.mode)?.hint}</p>
                    </Section>
                    <Section title="Memória">
                      <p className="text-xs leading-relaxed text-hud-text/55">
                        Vale na hora. Ao sair do 3D, a memória de vídeo do holograma é devolvida na hora; o código dele, se já tinha sido
                        carregado, só sai ao reabrir o JARVIS. Abrindo no 2D ou desligado, o 3D nem é carregado. Os fundos Grid e Matrix
                        são desenhados junto com o holograma, então só aparecem no 3D.
                      </p>
                    </Section>
                  </>
                )}

                {tab === "windows" && (
                  <>
                    <Section title="Estilo">
                      <Segmented
                        label="Estilo das janelas"
                        options={WINDOW_STYLES}
                        value={prefs.windowStyle}
                        onChange={(windowStyle) => onPrefs((current) => ({ ...current, windowStyle }))}
                      />
                      <p className="text-xs leading-relaxed text-hud-text/55">
                        {prefs.windowStyle === "tui"
                          ? "Como apps de terminal num gerenciador tiling: sem bordas, nome em vídeo invertido, widgets em TUI."
                          : "Painéis de vidro com brilho, no visual do holograma."}
                      </p>
                    </Section>
                    <Section title="Encaixe">
                      <SwitchRow
                        label="Encaixar nas bordas"
                        hint="A janela gruda na borda da tela quando é solta perto dela"
                        checked={prefs.snap}
                        onChange={() => onPrefs((current) => ({ ...current, snap: !current.snap }))}
                      />
                      <SwitchRow
                        label="Encaixar no centro"
                        hint="Também gruda no centro da área do holograma"
                        checked={prefs.snapCenter}
                        onChange={() => onPrefs((current) => ({ ...current, snapCenter: !current.snapCenter }))}
                      />
                      <Segmented
                        label="Distância de encaixe"
                        options={DISTANCES}
                        value={`${prefs.snapDistance}`}
                        onChange={(value) => onPrefs((current) => ({ ...current, snapDistance: Number(value) as SnapDistance }))}
                      />
                    </Section>
                    <Section title="Aparência das janelas">
                      <Range
                        label="Opacidade das janelas"
                        min={60}
                        max={100}
                        value={Math.round(prefs.opacity * 100)}
                        format={(value) => `${value}%`}
                        onChange={(value) => onPrefs((current) => ({ ...current, opacity: value / 100 }))}
                      />
                    </Section>
                  </>
                )}

                {tab === "taskbar" &&
                  (settings ? (
                    <>
                      <Section title="Barra superior">
                        <SwitchRow
                          label="Mostrar a barra superior"
                          hint="Barra no topo da tela, estilo Waybar; as partes vazias arrastam a janela"
                          checked={settings.taskbar}
                          onChange={() => onSettings((current) => ({ ...current, taskbar: !current.taskbar }))}
                        />
                      </Section>
                      <Section title="Módulos">
                        <p className="text-xs leading-relaxed text-hud-text/55">
                          {settings.taskbar ? "Mudam na barra, ao vivo." : "Ligue a barra para ver os módulos."}
                        </p>
                        {TASKBAR_MODULES.map((module) => (
                          <SwitchRow
                            key={module.key}
                            label={module.label}
                            hint={module.hint}
                            checked={taskbarModules[module.key]}
                            onChange={() => onTaskbarModules((current) => ({ ...current, [module.key]: !current[module.key] }))}
                          />
                        ))}
                      </Section>
                    </>
                  ) : (
                    <p className="text-sm text-hud-text/50">Carregando…</p>
                  ))}

                {tab === "dock" && (
                  <>
                    <Section title="Dock">
                      <SwitchRow
                        label="Mostrar a dock"
                        hint="Voice, programas, Widgets, Apps e Configurações na base da tela"
                        checked={dock.visible}
                        onChange={() => onDock((current) => ({ ...current, visible: !current.visible }))}
                      />
                      <SwitchRow
                        label="Ampliar ícones"
                        hint="O ícone sob o ponteiro cresce, como no macOS"
                        checked={dock.magnify}
                        onChange={() => onDock((current) => ({ ...current, magnify: !current.magnify }))}
                      />
                    </Section>
                    <Section title="Sem a dock">
                      <p className="text-xs leading-relaxed text-hud-text/55">
                        Tecle <Key>M</Key> para falar, <Key>/</Key> para abrir widgets, apps e programas, <Key>Ctrl ,</Key> para as
                        Configurações e <Key>Ctrl Shift ,</Key> para voltar aqui. Os avisos continuam aparecendo na base da tela.
                      </p>
                    </Section>
                  </>
                )}

                {tab === "voice" &&
                  (settings ? (
                    <VoiceTab settings={settings} onSettings={onSettings} playlists={playlists} />
                  ) : (
                    <p className="text-sm text-hud-text/50">Carregando…</p>
                  ))}

                {tab === "tui" && (
                  <>
                    <Section title="Efeitos dos apps de terminal">
                      <p className="text-xs leading-relaxed text-hud-text/55">
                        Valem para o Jarvis Mark e o Jarvis Code e, no estilo de janela TUI, também para os widgets. Na hora.
                      </p>
                      <SwitchRow
                        label="Aberração cromática"
                        hint="Franjas vermelha e azul no texto, como num CRT desalinhado"
                        checked={tui.aberration}
                        onChange={() => onTui((current) => ({ ...current, aberration: !current.aberration }))}
                      />
                      <SwitchRow
                        label="Brilho (glow)"
                        hint="O texto brilha como fósforo de monitor antigo"
                        checked={tui.glow}
                        onChange={() => onTui((current) => ({ ...current, glow: !current.glow }))}
                      />
                    </Section>
                    <Section title="Cor de acento">
                      <CardPicker
                        label="Cor dos apps de terminal"
                        options={accentOptions(settings)}
                        value={tui.accent}
                        onChange={(accent) => onTui((current) => ({ ...current, accent }))}
                      />
                    </Section>
                    <Section title="Prévia">
                      <TuiPreview prefs={tui} />
                    </Section>
                  </>
                )}

                {tab === "layout" && (
                  <>
                    <Section title="Organizar janelas">
                      <div className="grid grid-cols-3 gap-2">
                        <ActionButton label="Lado a lado" disabled={!windows} onClick={() => onArrange("tile")} />
                        <ActionButton label="Cascata" disabled={!windows} onClick={() => onArrange("cascade")} />
                        <ActionButton label="Centralizar" disabled={!windows} onClick={() => onArrange("center")} />
                      </div>
                      <p className="text-xs text-hud-text/50">
                        {windows ? `${windows} ${windows === 1 ? "janela aberta" : "janelas abertas"}.` : "Abra janelas pelos itens Widgets e Apps da dock."}
                      </p>
                    </Section>
                    <Section title="Alinhamento">
                      <SwitchRow
                        label="Alinhar à grade"
                        hint="Posições arredondam para 8 px quando nada encaixa"
                        checked={prefs.grid}
                        onChange={() => onPrefs((current) => ({ ...current, grid: !current.grid }))}
                      />
                    </Section>
                    <Section title="Janelas abertas">
                      <ActionButton label="Fechar todas as janelas" disabled={!windows} onClick={onCloseAll} />
                    </Section>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-hud-cyan/20 px-1 font-mono text-[11px] text-hud-light/85">{children}</kbd>;
}

/** Accent cards: each swatch in its own colours ("Cor do JARVIS" in the current theme's). */
function accentOptions(settings: Settings | null): CardOption<TuiAccent>[] {
  return TUI_ACCENTS.map(({ value, label, hue }) => {
    const { holo, light } = hue === null ? paletteFor(settings?.theme ?? "blue", settings?.accentHue ?? 224) : paletteFromHue(hue);
    return {
      value,
      label,
      swatch: (
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-md border font-mono text-[11px] font-bold"
          style={{ borderColor: holo, color: light, textShadow: `0 0 6px ${holo}`, boxShadow: `0 0 10px ${holo}44, inset 0 0 6px ${holo}33` }}
        >
          &gt;_
        </span>
      ),
    };
  });
}

/** A few lines of terminal with the current TUI look, exactly as the apps get it. */
function TuiPreview({ prefs }: { prefs: TuiPrefs }) {
  const surface = tuiSurface(prefs);
  return (
    <div
      data-testid="tui-preview"
      className={`${surface.className} rounded-xl border border-hud-cyan/20 bg-black/40 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-hud-text`}
      style={surface.style}
    >
      <div>
        <span className="text-hud-cyan">builder@jarvis</span> <span className="text-hud-text/50">~/projetos</span>{" "}
        <span className="text-hud-light">$</span> jarvis code main.rs
      </div>
      <div>
        <span className="text-hud-light">fn</span> <span className="text-hud-cyan">main</span>() {"{"}
      </div>
      <div className="pl-[2ch]">
        <span className="text-hud-text/45 italic">// núcleo holográfico online</span>
      </div>
      <div className="pl-[2ch]">
        <span className="text-hud-cyan">println!</span>(<span className="text-hud-glow">"Olá, Builder"</span>);
      </div>
      <div>{"}"}</div>
      <div className="mt-1 flex">
        <span className="bg-hud-cyan/25 px-2 font-semibold text-hud-light">RS</span>
        <span className="px-2 text-hud-text/70">main.rs</span>
        <span className="ml-auto text-hud-text/50">LN 3, COL 18</span>
      </div>
    </div>
  );
}

/** The tokens a hue produces, so the slider has immediate feedback. */
function PaletteStrip({ hue }: { hue: number }) {
  const palette = paletteFromHue(hue);
  return (
    <div aria-hidden className="flex items-center gap-2">
      {(["line", "cyan", "holo", "light", "glow"] as const).map((token) => (
        <span key={token} className="size-5 rounded-full border border-white/10" style={{ background: palette[token], boxShadow: `0 0 10px ${palette[token]}66` }} />
      ))}
      <span className="ml-1 font-mono text-[10px] text-hud-text/50 uppercase">{palette.cyan}</span>
    </div>
  );
}
