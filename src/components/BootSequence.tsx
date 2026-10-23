import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, type TargetAndTransition } from "motion/react";
import { probeSystem, type BootInfo, type BootStatus, type SystemProbe } from "../lib/boot";
import { createBootSound, type BootSound } from "../lib/bootSound";

/** Pause between the prompt appearing and the typing starting. */
const TYPE_DELAY = 180;
const CHAR_MS = 24;
const LINE_MS = 85;
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
const PROMPT = "C:\\>";
const LABEL_WIDTH = 22;
const BAR_CELLS = 24;

type Line =
  | { kind: "text"; at: number; text: string; tone: "title" | "dim" }
  | { kind: "memory"; at: number; until: number; kilobytes: number }
  | { kind: "command"; at: number; text: string }
  | {
      kind: "check";
      at: number;
      label: string;
      value: string;
      status: BootStatus;
    }
  | { kind: "progress"; at: number; until: number }
  | { kind: "gap"; at: number };

interface Script {
  lines: Line[];
  /** Everything is on screen. */
  printed: number;
  beepAt: number;
  glitches: number[];
  keystrokes: number[];
}

/** The whole POST as a timeline (ms from the start); the screen is a function of the elapsed time. */
function buildScript(info: BootInfo, probe: SystemProbe): Script {
  const lines: Line[] = [];
  const glitches: number[] = [];
  const keystrokes: number[] = [];
  let t = 0;
  const push = (line: Line, advance: number) => {
    lines.push(line);
    t += advance;
  };
  const command = (text: string) => {
    for (let i = 0; i < text.length; i++) keystrokes.push(t + TYPE_DELAY + i * CHAR_MS);
    push({ kind: "command", at: t, text }, TYPE_DELAY + text.length * CHAR_MS + 140);
  };
  const check = (label: string, value: string, status: BootStatus = "ok") => push({ kind: "check", at: t, label, value, status }, LINE_MS);

  // A plain BIOS: no logo, no name.
  push({ kind: "text", at: t, text: `BIOS v${info.version} · Núcleo holográfico`, tone: "title" }, LINE_MS);
  push({ kind: "text", at: t, text: "Assistente local · nenhum dado sai desta máquina.", tone: "dim" }, LINE_MS);
  push({ kind: "gap", at: t }, 60);
  const memoryAt = t;
  push({ kind: "memory", at: t, until: t + 650, kilobytes: probe.memoryKb }, 720);
  const beepAt = memoryAt + 650;
  glitches.push(beepAt + 30);
  push({ kind: "gap", at: t }, 60);

  command("post --completo");
  check("Processador", probe.cpu);
  check("Vídeo", probe.gpu);
  check("Tela", probe.screen);
  check("Áudio", probe.audio ? "Web Audio API" : "indisponível", probe.audio ? "ok" : "warn");
  check("Perfil gráfico", info.quality);
  push({ kind: "gap", at: t }, 60);

  command("carregar modulos");
  check("Motor de voz", info.voice.value, info.voice.status);
  check("Ativação", info.activation);
  check("Matriz holográfica", info.matrix);
  check("Widgets e apps", `${info.modules} módulos`);
  check("Sessão", info.windows ? `${info.windows} ${info.windows === 1 ? "janela restaurada" : "janelas restauradas"}` : "área de trabalho limpa");
  push({ kind: "gap", at: t }, 60);

  glitches.push(t - 30);
  command("iniciar nucleo --holografico");
  push({ kind: "progress", at: t, until: t + 750 }, 850);

  return { lines, printed: t, beepAt, glitches, keystrokes };
}

const STATUS: Record<BootStatus, { text: string; className: string }> = {
  ok: { text: "[  OK  ]", className: "text-hud-holo" },
  warn: { text: "[ AVISO]", className: "text-hud-alert" },
  skip: { text: "[  --  ]", className: "text-hud-text/45" },
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
 * Startup screen: an old BIOS POST on a CRT (scanlines, phosphor glow, flicker), in the
 * SUPERHOT terminal manner — typed commands and glitches. Then, like a computer coming to life,
 * the screen calms down: a warm chord, the JARVIS emblem and a welcome, fading into the desktop.
 * Any key or click skips it; DEL skips to the settings.
 */
export function BootSequence({ started, sound, info, onDone }: BootSequenceProps) {
  const reduced = useReducedMotion() ?? false;
  const probe = useMemo(probeSystem, []);
  const script = useMemo(() => buildScript(info, probe), [info, probe]);
  const [go, setGo] = useState(started);
  const [elapsed, setElapsed] = useState(0);
  const [exit, setExit] = useState<{ settings: boolean } | null>(null);
  // The startup screen follows the POST (held a moment first with reduced motion).
  const startupAt = script.printed + (reduced ? REDUCED_HOLD : 0);
  const end = startupAt + STARTUP_MS;
  const latest = useRef({ script, startupAt, end, reduced });
  latest.current = { script, startupAt, end, reduced };
  const audio = useRef<BootSound | null>(null);

  useEffect(() => {
    if (started) setGo(true);
  }, [started]);
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
    let frame = 0;
    const tick = () => {
      const time = performance.now();
      const now = last + Math.min(time - lastFrame, MAX_STEP_MS);
      lastFrame = time;
      const { script, startupAt, end } = latest.current;
      const passed = (at: number) => at > last && at <= now;
      if (script.keystrokes.some(passed)) audio.current?.click();
      if (passed(script.beepAt)) audio.current?.beep();
      if (passed(startupAt + CHIME_DELAY)) audio.current?.chime();
      last = now;
      setElapsed(now);
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
  const visible = script.lines.filter((line) => elapsed >= line.at);
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
            className={`crt-text crt-flicker absolute inset-0 px-[5vw] pt-[5.5vh] pb-[9vh] font-mono text-[clamp(11px,1.55vh,18px)] leading-[1.5] text-hud-text ${
              glitching ? "crt-glitch" : ""
            }`}
          >
            {visible.map((line, index) => (
              <TerminalLine key={index} line={line} elapsed={elapsed} cursor={line === lastLine && !startup} />
            ))}
            <div className="absolute right-[5vw] bottom-[4vh] left-[5vw] text-hud-text/50">
              <span className="text-hud-light">DEL</span> configurações <span className="mx-3 text-hud-text/25">·</span>
              <span className="text-hud-light">qualquer tecla</span> pular
            </div>
          </div>
        </div>

        {startup && <Startup reduced={reduced} />}

        {/* The tube's texture goes quiet as the machine comes to life. */}
        <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${startup ? "opacity-0" : ""}`}>
          <div className="crt-scanlines absolute inset-0" />
          <div className="crt-mask absolute inset-0" />
          <div className="crt-noise absolute inset-0" />
          <div className="crt-roll absolute inset-x-0 top-0 h-[24vh]" />
        </div>
        <div className="crt-glass pointer-events-none absolute inset-0 rounded-[2.2vw]" />
      </motion.div>
    </motion.div>
  );
}

function TerminalLine({ line, elapsed, cursor }: { line: Line; elapsed: number; cursor: boolean }) {
  const since = elapsed - line.at;
  switch (line.kind) {
    case "text":
      return <div className={line.tone === "title" ? "text-hud-light" : "text-hud-text/55"}>{line.text}</div>;
    case "gap":
      return <div className="h-[0.75em]" />;
    case "memory": {
      const share = Math.min(1, since / (line.until - line.at));
      const kilobytes = Math.floor(line.kilobytes * share);
      return (
        <div>
          Teste de memória : <span className="text-hud-light tabular-nums">{String(kilobytes).padStart(String(line.kilobytes).length, " ")}K</span>
          {share >= 1 && <span className="ml-3 text-hud-holo">OK</span>}
        </div>
      );
    }
    case "command": {
      const typed = line.text.slice(0, Math.max(0, Math.floor((since - TYPE_DELAY) / CHAR_MS) + 1));
      return (
        <div>
          <span className="text-hud-light">{PROMPT}</span> {since >= TYPE_DELAY ? typed : ""}
          {cursor && <Cursor />}
        </div>
      );
    }
    case "check": {
      const status = since >= 60 ? STATUS[line.status] : { text: "[  ..  ]", className: "text-hud-text/35" };
      return (
        <div className="grid max-w-[78ch] grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] gap-x-3 pl-[2ch]">
          <span className="whitespace-pre text-hud-text/80">{`${line.label} `.padEnd(LABEL_WIDTH, ".")}</span>
          <span className="truncate text-hud-light">{line.value}</span>
          <span className={`whitespace-pre ${status.className}`}>{status.text}</span>
        </div>
      );
    }
    case "progress": {
      const share = Math.max(0, Math.min(1, since / (line.until - line.at)));
      const filled = Math.round(share * BAR_CELLS);
      return (
        <div className="pl-[2ch]">
          Ativando núcleo holográfico{" "}
          <span className="text-hud-light">
            [{"█".repeat(filled)}
            <span className="text-hud-text/25">{"░".repeat(BAR_CELLS - filled)}</span>]
          </span>{" "}
          <span className="tabular-nums">{String(Math.round(share * 100)).padStart(3, " ")}%</span>
          {cursor && share >= 1 && <Cursor />}
        </div>
      );
    }
  }
}

function Cursor() {
  return <span className="crt-cursor ml-[0.15em] text-hud-light">█</span>;
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
