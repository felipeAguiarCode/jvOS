import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type TargetAndTransition,
} from "motion/react";
import {
  AppWindow,
  ChevronLeft,
  Cloud,
  Code,
  Globe,
  LayoutGrid,
  Mic,
  MicOff,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export type DockItemId = "voice" | "browser" | "vscode" | "terminal" | "widgets" | "apps" | "claude" | "settings";

/** Microphone light: off, starting, waiting (for "Hey Jarvis" or a push-to-talk hold), listening, or failed. */
export type VoiceIndicator = "idle" | "loading" | "armed" | "active" | "error";

/** Push-to-talk hold: pressed, then released to send or cancelled (slid away, Esc, a tap). */
export type HoldPhase = "start" | "send" | "cancel";

/** Push-to-talk while held: waiting for the microphone (the model may be loading), or recording. */
export type RecordingState = "preparing" | "live";

/** Sliding this far left (px) while holding Voice cancels the recording, as in WhatsApp. */
const CANCEL_DISTANCE = 120;

/** A short message shown in place of an item's tooltip. */
export interface DockNotice {
  target: DockItemId;
  text: string;
  tone: "info" | "error";
  key: number;
}

interface DockItem {
  id: DockItemId;
  label: string;
  icon: LucideIcon;
}

const APPS: DockItem[] = [
  { id: "browser", label: "Browser", icon: Globe },
  { id: "vscode", label: "VS Code", icon: Code },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "widgets", label: "Widgets", icon: LayoutGrid },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "claude", label: "Claude Code", icon: Cloud },
  { id: "settings", label: "Settings", icon: Settings },
];

interface QuickDockProps {
  voice: VoiceIndicator;
  voiceLabel: string;
  notice: DockNotice | null;
  /** Item highlighted as open (e.g. Settings while its panel is shown). */
  selected: DockItemId | null;
  onSelect: (id: DockItemId) => void;
  /** Push-to-talk: Voice listens while held instead of toggling. */
  onVoiceHold?: (phase: HoldPhase) => void;
  /** Push-to-talk hold in progress: shows the recording strip beside the dock. */
  recording: RecordingState | null;
  /** Menus anchored above items (the Widgets and Apps launchers) while they are open. */
  popovers?: Partial<Record<DockItemId, ReactNode>>;
  /** Items with something open (a widget, an app): a steady light under them. */
  armed?: DockItemId[];
  /** False while the boot screen covers everything: the dock slides in afterwards. */
  entered?: boolean;
  /** Turned off in the advanced menu: only its notices and the recording strip show. */
  visible?: boolean;
  /** The icon under the pointer grows. */
  magnify?: boolean;
}

export function QuickDock({
  voice,
  voiceLabel,
  notice,
  selected,
  onSelect,
  onVoiceHold,
  recording,
  popovers,
  armed,
  entered = true,
  visible = true,
  magnify = true,
}: QuickDockProps) {
  const mouseX = useMotionValue(Infinity);
  const slide = useMotionValue(0);
  const shown = entered && visible;
  // The first entrance waits for the hologram; turning the dock on or off later is immediate.
  const [settled, setSettled] = useState(false);
  const voiceItem: DockItem = { id: "voice", label: voiceLabel, icon: voice === "error" ? MicOff : Mic };

  const itemState = (item: DockItem): ButtonState => {
    if (selected === item.id || notice?.target === item.id) return "selected";
    return armed?.includes(item.id) ? "armed" : "idle";
  };

  return (
    // Above the desktop windows, like a panel.
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[16] flex justify-center">
      <AnimatePresence>
        {!visible && entered && (notice || recording) && <DockToast key="toast" notice={notice} recording={recording} slide={slide} />}
      </AnimatePresence>
      <motion.nav
        aria-label="Quick actions"
        inert={!visible}
        initial={{ opacity: 0, y: 24 }}
        // Turned off: out of sight, out of the tab order and out of the accessibility tree.
        animate={
          shown
            ? { opacity: 1, y: 0, visibility: "visible" }
            : { opacity: 0, y: 24, transitionEnd: visible ? undefined : { visibility: "hidden" } }
        }
        transition={{ delay: settled ? 0 : 0.6, duration: settled ? 0.35 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => {
          if (shown) setSettled(true);
        }}
        onMouseMove={(event) => mouseX.set(event.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="pointer-events-auto relative flex h-16 items-center gap-1 rounded-[22px] border border-hud-cyan/18 bg-hud-panel/45 px-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.65),inset_0_0_22px_color-mix(in_oklab,var(--color-hud-cyan)_5%,transparent)] backdrop-blur-md"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-hud-light/35 to-transparent"
        />
        <AnimatePresence>{recording && visible && <RecordingBar key="recording" state={recording} slide={slide} />}</AnimatePresence>
        <DockButton
          item={voiceItem}
          mouseX={mouseX}
          magnify={magnify}
          state={voice}
          pressed={onVoiceHold ? voice === "active" : voice !== "idle" && voice !== "error"}
          notice={notice?.target === "voice" ? notice : null}
          onPress={() => onSelect("voice")}
          onHold={onVoiceHold}
          slide={slide}
        />
        <span aria-hidden className="mx-1.5 h-7 w-px bg-linear-to-b from-transparent via-hud-cyan/30 to-transparent" />
        {APPS.map((item) => (
          <DockButton
            key={item.id}
            item={item}
            mouseX={mouseX}
            magnify={magnify}
            state={itemState(item)}
            pressed={TOGGLES.includes(item.id) ? selected === item.id : undefined}
            notice={notice?.target === item.id ? notice : null}
            onPress={() => onSelect(item.id)}
            popover={popovers?.[item.id]}
          />
        ))}
      </motion.nav>
    </div>
  );
}

/** Items that open something of their own (a panel, a launcher) and show it as pressed. */
const TOGGLES: DockItemId[] = ["widgets", "apps", "settings"];

type ButtonState = "idle" | "active" | "selected" | "armed" | "loading" | "error";

interface DockButtonProps {
  item: DockItem;
  mouseX: MotionValue<number>;
  magnify: boolean;
  state: ButtonState;
  pressed?: boolean;
  notice: DockNotice | null;
  onPress: () => void;
  /** When set, the button is held instead of clicked: "start" on press, then "send" or "cancel". */
  onHold?: (phase: HoldPhase) => void;
  /** While held: how far (px, ≤ 0) the pointer has slid left toward cancelling. */
  slide?: MotionValue<number>;
  /** Menu anchored above the item; replaces the tooltip while present. */
  popover?: ReactNode;
}

const HOLD_KEYS = [" ", "Enter"];

function DockButton({ item, mouseX, magnify, state, pressed, notice, onPress, onHold, slide, popover }: DockButtonProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [ripples, setRipples] = useState<number[]>([]);
  const holding = useRef(false);
  /** The pointer holding the button and where it went down (keyboard holds have none). */
  const holdPointer = useRef<{ id: number; x: number } | null>(null);
  const resting = useMotionValue(0);
  // The icon trails the pointer a little while sliding to cancel.
  const iconX = useTransform(slide ?? resting, (offset) => offset * 0.3);

  const hold = (phase: HoldPhase) => {
    const down = phase === "start";
    if (!onHold || holding.current === down) return;
    holding.current = down;
    if (!down) holdPointer.current = null;
    slide?.set(0);
    if (down) setRipples((current) => [...current, Date.now()]);
    onHold(phase);
  };

  // macOS-style magnification, kept discreet: the hovered icon grows, neighbours a little.
  const distance = useTransform(mouseX, (x) => {
    const box = slot.current?.getBoundingClientRect();
    return box ? x - (box.left + box.width / 2) : Infinity;
  });
  const target = useTransform(distance, [-130, -60, 0, 60, 130], [1, 1.07, 1.22, 1.07, 1]);
  const scale = useSpring(target, { stiffness: 380, damping: 26, mass: 0.35 });
  const lift = useTransform(scale, (value) => (1 - value) * 14);

  const lit = state === "active" || state === "selected";
  const Icon = item.icon;

  return (
    <div ref={slot} className="relative flex h-12 w-12 items-center justify-center">
      {/* "wait": the label leaves before a notice replaces it, so they never overlap. */}
      <AnimatePresence>
        {popover && (
          <motion.div
            key="popover"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            // Hovering the menu must not magnify the icons under it.
            onMouseMove={(event) => {
              event.stopPropagation();
              mouseX.set(Infinity);
            }}
            className="pointer-events-auto absolute bottom-full left-1/2 mb-4 -translate-x-1/2"
          >
            {popover}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {(hovered || notice) && !popover && (
          <motion.span
            key={notice ? `notice-${notice.key}` : "label"}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 3, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap rounded-md border bg-hud-panel/80 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.22em] backdrop-blur-sm ${
              notice?.tone === "error" ? "border-hud-alert/30 text-hud-alert/90" : "border-hud-cyan/20 text-hud-text"
            }`}
          >
            {notice?.text ?? item.label}
          </motion.span>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label={item.label}
        aria-pressed={pressed}
        data-dock-item={item.id}
        onClick={() => {
          if (onHold) return;
          setRipples((current) => [...current, Date.now()]);
          onPress();
        }}
        // Pointer capture keeps the release coming even if the pointer slides off the button.
        onPointerDown={(event) => {
          if (!onHold || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          holdPointer.current = { id: event.pointerId, x: event.clientX };
          hold("start");
        }}
        onPointerMove={(event) => {
          const pointer = holdPointer.current;
          if (!pointer || pointer.id !== event.pointerId) return;
          const offset = Math.min(0, event.clientX - pointer.x);
          if (offset <= -CANCEL_DISTANCE) hold("cancel");
          else slide?.set(offset);
        }}
        onPointerUp={() => hold("send")}
        onPointerCancel={() => hold("send")}
        onLostPointerCapture={() => hold("send")}
        // A long touch must not open the context menu.
        onContextMenu={(event) => {
          if (onHold) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (!onHold) return;
          if (event.key === "Escape" && holding.current) {
            event.preventDefault();
            hold("cancel");
          } else if (HOLD_KEYS.includes(event.key)) {
            event.preventDefault();
            if (!event.repeat) hold("start");
          }
        }}
        onKeyUp={(event) => {
          if (!onHold || !HOLD_KEYS.includes(event.key)) return;
          event.preventDefault();
          hold("send");
        }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        // Keyboard focus shows the label; focus left behind by a mouse click must not.
        onFocus={(event) => setHovered(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => {
          setHovered(false);
          hold("send");
        }}
        whileTap={{ scale: 0.88 }}
        className={`group relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl outline-none focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
          onHold ? "touch-none" : ""
        }`}
      >
        <span
          aria-hidden
          className={`absolute inset-1 rounded-2xl transition-colors duration-300 ${
            lit ? "bg-hud-cyan/[0.08]" : "bg-transparent group-hover:bg-hud-cyan/[0.05]"
          }`}
        />
        <motion.span
          style={magnify ? { scale, y: lift, x: iconX } : { x: iconX }}
          className={`relative transition-[color,filter] duration-300 ${
            state === "error"
              ? "text-hud-alert/80"
              : lit
                ? "text-hud-light drop-shadow-[0_0_7px_color-mix(in_oklab,var(--color-hud-holo)_70%,transparent)]"
                : state === "armed" || state === "loading"
                  ? "text-hud-text/85 group-hover:text-hud-light"
                  : "text-hud-text/65 group-hover:text-hud-light group-hover:drop-shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-holo)_60%,transparent)]"
          }`}
        >
          <Icon size={22} strokeWidth={1.5} />
        </motion.span>
        {ripples.map((key) => (
          <motion.span
            key={key}
            aria-hidden
            initial={{ opacity: 0.55, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.45 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            onAnimationComplete={() => setRipples((current) => current.filter((value) => value !== key))}
            className="pointer-events-none absolute inset-1 rounded-2xl border border-hud-light/50"
          />
        ))}
      </motion.button>

      <Indicator state={state} />
    </div>
  );
}

/**
 * WhatsApp-style strip beside the dock while Voice is held: recording light, elapsed time and
 * the slide-to-cancel hint, which follows the pointer and fades as it nears the cancel point.
 */
function RecordingBar({ state, slide, inline = false }: { state: RecordingState; slide: MotionValue<number>; inline?: boolean }) {
  const live = state === "live";
  const [elapsed, setElapsed] = useState(0);
  const hintX = useTransform(slide, (offset) => offset * 0.6);
  const hintOpacity = useTransform(slide, [-CANCEL_DISTANCE, 0], [0.15, 1]);

  // The clock starts when the microphone opens (the first press may still be loading the model).
  useEffect(() => {
    if (!live) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 200);
    return () => {
      window.clearInterval(timer);
      setElapsed(0);
    };
  }, [live]);

  const seconds = Math.floor(elapsed / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div
      role="timer"
      aria-label={live ? `Gravando ${clock}` : "Preparando o microfone"}
      initial={{ opacity: 0, x: 16, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 10, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`pointer-events-none flex h-11 items-center gap-3 overflow-hidden rounded-full border border-hud-cyan/18 bg-hud-panel/70 pr-4 pl-3.5 whitespace-nowrap shadow-[0_12px_40px_rgba(0,0,0,0.65)] backdrop-blur-md ${
        inline ? "relative" : "absolute top-1/2 right-full mr-3 -translate-y-1/2"
      }`}
    >
      <motion.span
        aria-hidden
        animate={{ opacity: live ? [1, 0.3, 1] : 0.35 }}
        transition={live ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        className="size-2 shrink-0 rounded-full bg-hud-alert shadow-[0_0_8px_color-mix(in_oklab,var(--color-hud-alert)_80%,transparent)]"
      />
      <span className={`min-w-9 text-sm tabular-nums ${live ? "text-hud-light" : "text-hud-text/50"}`}>
        {live ? clock : "…"}
      </span>
      {/* The hint slides into a faded edge instead of over the clock. */}
      <span className="-ml-2 overflow-hidden pl-4 [mask-image:linear-gradient(to_right,transparent,black_16px)]">
        <motion.span
          style={{ x: hintX, opacity: hintOpacity }}
          className="flex items-center gap-1 text-[10px] font-medium tracking-[0.22em] text-hud-text/70 uppercase"
        >
          <ChevronLeft size={13} strokeWidth={1.8} aria-hidden /> Deslize para cancelar
        </motion.span>
      </span>
    </motion.div>
  );
}

/**
 * With the dock turned off, what it would have said still shows where it was: the notice
 * (“Abrindo Relógio”, voice errors) and the push-to-talk recording strip.
 */
function DockToast({ notice, recording, slide }: { notice: DockNotice | null; recording: RecordingState | null; slide: MotionValue<number> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="pointer-events-none absolute bottom-4 flex items-center gap-3"
    >
      {recording && <RecordingBar state={recording} slide={slide} inline />}
      {notice && (
        <span
          key={notice.key}
          role="status"
          aria-live="polite"
          data-testid="dock-toast"
          className={`rounded-md border bg-hud-panel/80 px-2.5 py-1.5 text-[10px] font-medium tracking-[0.22em] whitespace-nowrap uppercase backdrop-blur-sm ${
            notice.tone === "error" ? "border-hud-alert/30 text-hud-alert/90" : "border-hud-cyan/20 text-hud-text"
          }`}
        >
          {notice.text}
        </span>
      )}
    </motion.div>
  );
}

const INDICATOR_ANIMATION: Record<Exclude<ButtonState, "idle">, TargetAndTransition> = {
  active: { opacity: [0.55, 1, 0.55], scale: 1 },
  loading: { opacity: [0.15, 0.7, 0.15], scale: 1 },
  armed: { opacity: 0.45, scale: 1 },
  selected: { opacity: 0.6, scale: 1 },
  error: { opacity: 0.9, scale: 1 },
};

/** Small light under the icon: live microphone, waiting for the wake word, error, selection. */
function Indicator({ state }: { state: ButtonState }) {
  const looping = state === "active" || state === "loading";
  return (
    <AnimatePresence>
      {state !== "idle" && (
        <motion.span
          key={state}
          aria-hidden
          initial={{ opacity: 0, scale: 0.4 }}
          animate={INDICATOR_ANIMATION[state]}
          exit={{ opacity: 0, scale: 0.4 }}
          transition={
            looping
              ? {
                  opacity: { duration: state === "loading" ? 0.9 : 1.8, repeat: Infinity, ease: "easeInOut" },
                  scale: { duration: 0.2 },
                }
              : { duration: 0.2 }
          }
          className={`pointer-events-none absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
            state === "error"
              ? "bg-hud-alert shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-alert)_80%,transparent)]"
              : "bg-hud-light shadow-[0_0_8px_color-mix(in_oklab,var(--color-hud-light)_95%,transparent)]"
          }`}
        />
      )}
    </AnimatePresence>
  );
}
