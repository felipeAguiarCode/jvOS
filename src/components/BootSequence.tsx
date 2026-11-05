import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, type TargetAndTransition } from "motion/react";
import "@fontsource/vt323/latin.css";
import { probeSystem, type BootInfo, type BootStatus, type SystemProbe } from "../lib/boot";
import { createBootSound, type BootSound } from "../lib/bootSound";

const LINE_MS = 70;
/** A device being probed: its name shows, and what answered comes a moment later. */
const DETECT_MS = 240;
const GLITCH_MS = 140;
/** After the POST, the screen calms down and the machine comes to life: chord, emblem, welcome. */
const STARTUP_MS = 2100;
/** The chord sounds as the emblem appears. */
const CHIME_DELAY = 250;
/** With reduced motion: everything printed at once, held this long before the startup screen. */
const REDUCED_HOLD = 1100;
/** Starts anyway if the hologram never reports its first frame. */
const START_FALLBACK_MS = 1500;
/** A stalled frame advances the timeline this much at most: it slows down instead of skipping a phase. */
const MAX_STEP_MS = 100;
/** Time between two renders of the screen (~30 fps). */
const RENDER_STEP_MS = 32;
/** The text-mode font, preloaded so the POST never starts in the fallback. */
const BIOS_FONT = '1em "VT323"';
/** Where the colons line up, on the first screen and in the summary box. */
const LABEL_WIDTH = 22;
const SUMMARY_LABEL_WIDTH = 15;
const DMI_DOTS = 12;
/** Bus, device, function, vendor, device ID, class, description, IRQ. */
const PCI_COLUMNS = [6, 6, 6, 8, 6, 7, 30, 3];
/** PCI vendor IDs of the usual graphics makers; anything else shows as Microsoft's basic display. */
const PCI_VENDORS: [RegExp, string][] = [
  [/nvidia|geforce|quadro/i, "10DE"],
  [/amd|radeon/i, "1002"],
  [/intel/i, "8086"],
  [/apple/i, "106B"],
  [/qualcomm|adreno/i, "5143"],
  [/swiftshader|google/i, "1AE0"],
];

interface Field {
  label: string;
  value: string;
  status: BootStatus;
}

type Line =
  | { kind: "text"; at: number; text: string; tone: "title" | "plain" | "dim" }
  | { kind: "memory"; at: number; until: number; kilobytes: number }
  /** `found`: when the value shows (a device answering the probe). */
  | ({ kind: "field"; at: number; found: number } & Field)
  /** The summary box, row by row: left column, right column. */
  | { kind: "summary"; at: number; fields: Field[] }
  | { kind: "dots"; at: number; until: number; text: string }
  | { kind: "gap"; at: number };

interface Script {
  lines: Line[];
  /** Everything is on screen. */
  printed: number;
  /** The POST passed: one short beep, and the summary screen replaces the first. */
  clearAt: number;
  glitches: number[];
  /** The BIOS ID string in the corner of the first screen. */
  biosId: string;
}

/** A stable, made-up PCI device ID for a device name. */
function deviceId(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return hash.toString(16).toUpperCase().padStart(4, "0");
}

const pciRow = (cells: string[]) =>
  cells.map((cell, index) => (index === cells.length - 1 ? cell.padStart(PCI_COLUMNS[index]) : cell.padEnd(PCI_COLUMNS[index]))).join("");

/**
 * The whole POST as a timeline (ms from the start); the screen is a function of the elapsed time.
 * Laid out like an Award BIOS: the banner, the CPU, the memory count and the devices answering
 * one by one; then the beep, the summary box, the PCI listing and the hand-over.
 */
function buildScript(info: BootInfo, probe: SystemProbe): Script {
  const lines: Line[] = [];
  let t = 0;
  const push = (line: Line, advance: number) => {
    lines.push(line);
    t += advance;
  };
  const text = (value: string, tone: "title" | "plain" | "dim" = "plain") => push({ kind: "text", at: t, text: value, tone }, LINE_MS);
  const gap = () => push({ kind: "gap", at: t }, 40);
  const detect = (label: string, value: string, status: BootStatus = "ok") =>
    push({ kind: "field", at: t, found: t + DETECT_MS, label: `  ${label}`, value, status }, DETECT_MS + LINE_MS);

  // A plain BIOS: no logo, no name.
  text(`BIOS Modular v${info.version}, Núcleo Holográfico`, "title");
  text(`Copyright (C) ${new Date().getFullYear()}, Assistente Local. Nenhum dado sai desta máquina.`, "dim");
  gap();
  push({ kind: "field", at: t, found: t, label: "Processador principal", value: probe.cpu, status: "ok" }, LINE_MS);
  push({ kind: "memory", at: t, until: t + 700, kilobytes: probe.memoryKb }, 760);
  gap();
  text("Detectando dispositivos...");
  detect("Vídeo primário", probe.gpu);
  detect("Tela", probe.screen);
  detect("Áudio", probe.audio ? "Web Audio API" : "Nenhum", probe.audio ? "ok" : "warn");
  detect("Motor de voz", info.voice.value, info.voice.status);
  t += 450;

  // The monitor resyncs as the summary screen is drawn.
  const clearAt = t;
  const field = (label: string, value: string, status: BootStatus = "ok"): Field => ({ label, value, status });
  const session = info.windows ? `${info.windows} ${info.windows === 1 ? "janela restaurada" : "janelas restauradas"}` : "área de trabalho limpa";
  const fields = [
    [field("Processador", probe.cpu), field("Motor de voz", info.voice.value, info.voice.status)],
    [field("Memória", `${probe.memoryKb}K`), field("Ativação", info.activation)],
    [field("Vídeo", probe.gpu), field("Tema", info.theme)],
    [field("Tela", probe.screen), field("Widgets e apps", `${info.modules} módulos`)],
    [field("Perfil gráfico", info.quality), field("Sessão", session)],
  ].flat();
  push({ kind: "summary", at: t, fields }, 380);
  gap();

  const vendor = PCI_VENDORS.find(([pattern]) => pattern.test(probe.gpu))?.[1] ?? "1414";
  text("Listagem de dispositivos PCI...");
  text(pciRow(["Barr.", "Disp.", "Func.", "Fornec.", "Disp.", "Classe", "Descrição do dispositivo", "IRQ"]));
  text("-".repeat(PCI_COLUMNS.reduce((sum, width) => sum + width, 0)));
  text(pciRow(["  0", "  2", "  0", vendor, deviceId(probe.gpu), "0300", "Controlador de vídeo", "16"]));
  if (probe.audio) text(pciRow(["  0", " 31", "  3", vendor === "1002" ? "1022" : "8086", deviceId("audio"), "0403", "Controlador de áudio", "11"]));
  text(pciRow(["", "", "", "", "", "", "Controlador ACPI", "9"]));
  gap();
  push({ kind: "dots", at: t, until: t + 600, text: "Verificando dados do pool DMI " }, 700);
  text("Iniciando o núcleo holográfico...");
  t += 500;

  return {
    lines,
    printed: t,
    clearAt,
    glitches: [clearAt],
    biosId: `JV-HOLO-${info.version.replace(/\D/g, "")}-${deviceId(probe.gpu)}${vendor}-00`,
  };
}

const VALUE_TONE: Record<BootStatus, string> = {
  ok: "text-hud-light",
  warn: "text-hud-alert",
  skip: "text-hud-text/45",
};

/** CRT switching on: a dot, a line, then the whole tube. */
const CRT_ON: TargetAndTransition = {
  scaleX: [0, 1, 1],
  scaleY: [0.006, 0.006, 1],
  filter: ["brightness(3)", "brightness(2.4)", "brightness(1)"],
  transition: { duration: 0.5, times: [0, 0.35, 1], ease: "easeOut" },
};
/**
 * Leaving: the picture just fades, a touch brighter, into the desktop (no tube switching off).
 * The scale stays explicit: left out, motion would take it back to \`initial\` — a collapse.
 */
const SCREEN_OUT: TargetAndTransition = {
  opacity: 0,
  scaleX: 1,
  scaleY: 1,
  filter: "brightness(1.15)",
  transition: { duration: 0.6, ease: "easeOut" },
};

interface BootSequenceProps {
  /** The hologram rendered its first frame (the window is visible): the POST starts. */
  started: boolean;
  sound: boolean;
  info: BootInfo;
  /** `openSettings`: DEL was pressed, as in an old BIOS setup. */
  onDone: (openSettings: boolean) => void;
}

/**
 * Startup screen: an old BIOS POST on a CRT (scanlines, phosphor glow, flicker), in a text-mode
 * font — the banner, the memory count, the devices answering, then the beep, the summary box and
 * the PCI listing. Then, like a computer coming to life, the screen calms down: a warm chord, the
 * JARVIS emblem and a welcome, fading into the desktop. Any key or click skips it; DEL skips to
 * the settings.
 */
export function BootSequence({ started, sound, info, onDone }: BootSequenceProps) {
  const reduced = useReducedMotion() ?? false;
  const probe = useMemo(probeSystem, []);
  const script = useMemo(() => buildScript(info, probe), [info, probe]);
  const [fontReady, setFontReady] = useState(() => document.fonts.check(BIOS_FONT));
  const [go, setGo] = useState(started && fontReady);
  const [elapsed, setElapsed] = useState(0);
  const [exit, setExit] = useState<{ settings: boolean } | null>(null);
  // The startup screen follows the POST (held a moment first with reduced motion).
  const startupAt = script.printed + (reduced ? REDUCED_HOLD : 0);
  const end = startupAt + STARTUP_MS;
  const latest = useRef({ script, startupAt, end, reduced });
  latest.current = { script, startupAt, end, reduced };
  const audio = useRef<BootSound | null>(null);

  useEffect(() => {
    let live = true;
    const ready = () => live && setFontReady(true);
    document.fonts.load(BIOS_FONT).then(ready, ready);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (started && fontReady) setGo(true);
  }, [started, fontReady]);
  useEffect(() => {
    const timer = window.setTimeout(() => setGo(true), START_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const created = createBootSound(sound);
    audio.current = created;
    return () => {
      created.close();
      audio.current = null;
    };
  }, [sound]);

  // The clock: every frame derives from the elapsed time; sounds fire as their moment passes.
  useEffect(() => {
    if (!go || exit) return;
    let last = latest.current.reduced ? latest.current.script.printed : 0;
    let lastFrame = performance.now();
    let rendered = -Infinity;
    let frame = 0;
    const tick = () => {
      const time = performance.now();
      const now = last + Math.min(time - lastFrame, MAX_STEP_MS);
      lastFrame = time;
      const { script, startupAt, end } = latest.current;
      const passed = (at: number) => at > last && at <= now;
      if (passed(script.clearAt)) audio.current?.beep();
      if (passed(startupAt + CHIME_DELAY)) audio.current?.chime();
      last = now;
      // Sounds are checked every frame; the screen (the whole boot tree) re-renders at ~30 fps,
      // plenty for typed text and half the work on a 60 Hz screen.
      if (now - rendered >= RENDER_STEP_MS || now >= end) {
        rendered = now;
        setElapsed(now);
      }
      if (now >= end) setExit({ settings: false });
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [go, exit]);

  const skip = useCallback((settings: boolean) => setExit((current) => current ?? { settings }), []);

  // Any key skips (and goes no further: M must not open the microphone); shortcuts with Ctrl still work.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      skip(event.key === "Delete");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [skip]);

  // A skip goes straight to the fade; the startup screen follows a POST that ran its course.
  const startup = elapsed >= startupAt;
  const glitching = !reduced && !exit && !startup && script.glitches.some((at) => elapsed >= at && elapsed < at + GLITCH_MS);
  const firstScreen = elapsed < script.clearAt;
  const visible = script.lines.filter((line) => elapsed >= line.at && firstScreen === line.at < script.clearAt);
  const lastLine = visible[visible.length - 1];

  return (
    <motion.div
      data-testid="boot"
      initial={false}
      animate={{ opacity: exit ? 0 : 1 }}
      transition={exit ? { duration: 0.6, ease: "easeOut" } : { duration: 0 }}
      onAnimationComplete={() => exit && onDone(exit.settings)}
      onPointerDown={() => skip(false)}
      className="fixed inset-0 z-[60] cursor-default bg-black select-none"
    >
      <p role="status" className="sr-only">
        Inicializando o sistema. Qualquer tecla pula; Delete abre as configurações.
      </p>
      <motion.div
        aria-hidden
        initial={reduced ? false : { scaleX: 0, scaleY: 0.006, filter: "brightness(3)" }}
        animate={exit ? SCREEN_OUT : reduced ? { scaleX: 1, scaleY: 1 } : CRT_ON}
        className="crt-screen absolute inset-[1.4vh] overflow-hidden rounded-[2.2vw]"
      >
        {/* The fade lives on a wrapper: crt-flicker animates the text's own opacity. */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${startup ? "opacity-0" : ""}`}>
          <div
            className={`crt-text crt-flicker absolute inset-0 px-[5vw] pt-[5.5vh] pb-[9vh] font-bios text-[clamp(15px,2.8vh,34px)] leading-[1.2] text-hud-text ${
              glitching ? "crt-glitch" : ""
            }`}
          >
            {visible.map((line, index) => (
              <TerminalLine key={index} line={line} elapsed={elapsed} cursor={line === lastLine && !startup} />
            ))}
            {firstScreen && (
              <div className="absolute right-[5vw] bottom-[4vh] left-[5vw] text-hud-text/70">
                <div>
                  Pressione <span className="text-hud-light">DEL</span> para entrar no SETUP, qualquer tecla para pular
                </div>
                <div className="text-hud-text/55">{script.biosId}</div>
              </div>
            )}
          </div>
        </div>

        {startup && <Startup reduced={reduced} />}

        {/* The tube's texture goes quiet as the machine comes to life. */}
        <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${startup ? "opacity-0" : ""}`}>
          <div className="crt-scanlines absolute inset-0" />
          <div className="crt-mask absolute inset-0" />
          {/* Larger than the screen by the noise's largest jump (64 px), clipped by the tube. */}
          <div className="crt-noise absolute -inset-16" />
          <div className="crt-roll absolute inset-x-0 top-0 h-[24vh]" />
        </div>
        <div className="crt-glass pointer-events-none absolute inset-0 rounded-[2.2vw]" />
      </motion.div>
    </motion.div>
  );
}

const TEXT_TONE = { title: "text-hud-light", plain: "", dim: "text-hud-text/55" };

function TerminalLine({ line, elapsed, cursor }: { line: Line; elapsed: number; cursor: boolean }) {
  const since = elapsed - line.at;
  switch (line.kind) {
    case "text":
      return (
        <div className={`whitespace-pre-wrap ${TEXT_TONE[line.tone]}`}>
          {line.text}
          {cursor && <Cursor />}
        </div>
      );
    case "gap":
      return <div className="h-[0.6em]" />;
    case "memory": {
      const share = Math.min(1, since / (line.until - line.at));
      const kilobytes = Math.floor(line.kilobytes * share);
      return (
        <div className="whitespace-pre">
          {`${"Teste de memória".padEnd(LABEL_WIDTH)}: `}
          <span className="text-hud-light">{String(kilobytes).padStart(String(line.kilobytes).length, " ")}K</span>
          {share >= 1 && <span className="text-hud-light"> OK</span>}
          {cursor && <Cursor />}
        </div>
      );
    }
    case "field":
      return (
        <div className="flex min-w-0 whitespace-pre">
          {`${line.label.padEnd(LABEL_WIDTH)}: `}
          {elapsed >= line.found && <span className={`truncate ${VALUE_TONE[line.status]}`}>{line.value}</span>}
          {cursor && <Cursor />}
        </div>
      );
    case "summary":
      return (
        <fieldset className="m-0 mb-[0.3em] max-w-[100ch] border-[3px] border-double border-hud-text/70 px-0 pt-0 pb-[0.2em]">
          <legend className="mx-auto px-[1ch] text-hud-light">Configuração do sistema</legend>
          <div className="grid grid-cols-2">
            {line.fields.map((field, index) => (
              <div key={index} className={`flex min-w-0 px-[1ch] whitespace-pre ${index % 2 ? "border-l-[3px] border-double border-hud-text/70" : ""}`}>
                {`${field.label.padEnd(SUMMARY_LABEL_WIDTH)}: `}
                <span className={`truncate ${VALUE_TONE[field.status]}`}>{field.value}</span>
              </div>
            ))}
          </div>
        </fieldset>
      );
    case "dots": {
      const share = Math.max(0, Math.min(1, since / (line.until - line.at)));
      return (
        <div className="whitespace-pre">
          {line.text}
          {".".repeat(Math.round(share * DMI_DOTS))}
          {cursor && <Cursor />}
        </div>
      );
    }
  }
}

/** The text-mode cursor: a blinking underscore. */
function Cursor() {
  return <span className="crt-cursor text-hud-light">_</span>;
}

/**
 * The machine coming to life after the POST: a soft glow, the JARVIS emblem settling in the
 * middle and a welcome under it (the chord sounds with it).
 */
function Startup({ reduced }: { reduced: boolean }) {
  const enter = (delay: number) =>
    reduced
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.3, delay },
        }
      : {
          initial: { opacity: 0, scale: 0.94, filter: "blur(6px)" },
          animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
          transition: {
            duration: 0.8,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };
  return (
    <div data-testid="boot-startup" className="absolute inset-0 grid place-items-center">
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, delay: 0.15 }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,color-mix(in_oklab,var(--color-hud-cyan)_16%,transparent),transparent_58%)]"
      />
      <div className="relative flex flex-col items-center gap-[3.2vh] text-hud-light">
        <motion.div {...enter(CHIME_DELAY / 1000)}>
          <Rings className="size-[20vh] drop-shadow-[0_0_24px_color-mix(in_oklab,var(--color-hud-holo)_60%,transparent)]" />
        </motion.div>
        <motion.p {...enter(CHIME_DELAY / 1000 + 0.35)} className="m-0 font-sans text-[clamp(16px,2.6vh,30px)] font-light tracking-[0.08em]">
          Bem-vindo
        </motion.p>
      </div>
    </div>
  );
}

/** JARVIS rings in the theme colour, turning: the emblem of the startup screen. */
function Rings({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`overflow-visible ${className}`}>
      <g className="origin-center animate-[spin_9s_linear_infinite]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M50 6 A44 44 0 0 1 94 50" />
        <path d="M50 94 A44 44 0 0 1 6 50" />
      </g>
      <g
        className="origin-center animate-[spin_5s_linear_infinite_reverse]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 5"
        opacity="0.8"
      >
        <circle cx="50" cy="50" r="34" />
      </g>
      <circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.9" />
      <circle cx="50" cy="50" r="7" fill="currentColor" />
    </svg>
  );
}
