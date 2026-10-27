import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openSession, type TerminalBackend, type TerminalProfile, type TerminalSession } from "../../../../lib/terminal";

/** How long the terminal waits for a resize to settle before telling the shell. */
const RESIZE_DEBOUNCE_MS = 60;

/** The JARVIS palette, read from the CSS variables around the terminal (theme and TUI accent). */
function readTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const text = color("--color-hud-text", "#c8d6e0");
  const light = color("--color-hud-light", "#9fe8ff");
  const cyan = color("--color-hud-cyan", "#2fb8e6");
  const alert = color("--color-hud-alert", "#ff5d5d");
  return {
    background: "rgba(0, 0, 0, 0)",
    foreground: text,
    cursor: light,
    cursorAccent: "#000000",
    selectionBackground: `color-mix(in oklab, ${cyan} 35%, transparent)`,
    black: "#0b1014",
    red: alert,
    green: "#5fd38d",
    yellow: "#e5c07b",
    blue: cyan,
    magenta: "#c678dd",
    cyan: light,
    white: text,
    brightBlack: "#5c6873",
    brightRed: "#ff8080",
    brightGreen: "#8be8ad",
    brightYellow: "#f2d99a",
    brightBlue: light,
    brightMagenta: "#dda2ee",
    brightCyan: "#c8f4ff",
    brightWhite: "#ffffff",
  };
}

/** Copies the terminal's selection to the clipboard. */
export function copySelection(terminal: Terminal) {
  void navigator.clipboard?.writeText(terminal.getSelection()).catch(() => {});
}

/** Pastes the clipboard into the shell, as if typed. */
export function pasteClipboard(terminal: Terminal) {
  void navigator.clipboard?.readText().then((text) => text && terminal.paste(text), () => {});
}

export interface TerminalViewProps {
  profile: TerminalProfile;
  /** Starting folder (absolute) instead of the profile's. */
  cwd?: string | null;
  /** Its accessible name (the tab's or the panel's title). */
  label: string;
  role?: "tabpanel" | "region";
  /** Shown (an inactive one is hidden, its shell still running). */
  active: boolean;
  /** Takes the keyboard when it becomes active (jv_sh's tab in front). */
  autoFocus?: boolean;
  backend: TerminalBackend;
  onSession?: (session: number) => void;
  /** The title the shell asks for (OSC). */
  onTitle?: (title: string) => void;
  /** The shell ended by itself (an error code is also written on the screen). */
  onExit: (code: number | null) => void;
  /** Keys kept from the shell: return false for those (xterm's custom key handler). */
  shortcut?: (event: KeyboardEvent, terminal: Terminal) => boolean;
}

/**
 * An xterm sized to its box (absolutely placed: the parent is positioned), talking to its own
 * shell session. Unmounting ends the shell.
 */
export function TerminalView({ profile, cwd = null, label, role = "tabpanel", active, autoFocus = true, backend, onSession, onTitle, onExit, shortcut }: TerminalViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [session, setSession] = useState<number | null>(null);
  const handlers = useRef({ onSession, onTitle, onExit, shortcut });
  handlers.current = { onSession, onTitle, onExit, shortcut };

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const font = getComputedStyle(element).getPropertyValue("--font-mono").trim() || "Consolas, monospace";
    const terminal = new Terminal({
      fontFamily: font,
      fontSize: 13,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: readTheme(element),
    });
    const fitter = new FitAddon();
    terminal.loadAddon(fitter);
    terminal.open(element);
    fitter.fit();
    view.current = terminal;
    fit.current = fitter;

    let opened: TerminalSession | null = null;
    let disposed = false;
    // An agent runs in its own folder; a shell may be asked to start elsewhere (jv_ide).
    const agent = profile.agent;
    void openSession(backend, profile.id, terminal.cols, terminal.rows, agent ? profile.cwd : cwd, {
      output: (data) => !disposed && terminal.write(data),
      exit: (code) => {
        if (disposed) return;
        if (code) terminal.write(`\r\n\x1b[2m[processo encerrado: código ${code}]\x1b[0m\r\n`);
        handlers.current.onExit(code);
      },
    }, agent).then(
      (started) => {
        // StrictMode (dev) mounts twice: a shell that lost the race is closed at once.
        if (disposed) return started.close();
        opened = started;
        setSession(started.id);
        handlers.current.onSession?.(started.id);
      },
      (reason) => !disposed && terminal.write(`\x1b[31m${String(reason)}\x1b[0m\r\n`),
    );
    const input = terminal.onData((data) => opened && backend.write(opened.id, data));
    const title = terminal.onTitleChange((text) => handlers.current.onTitle?.(text));
    terminal.attachCustomKeyEventHandler((event) => handlers.current.shortcut?.(event, terminal) ?? true);

    // The window resizes (or maximises): the terminal refits, and the shell learns its new size.
    let timer = 0;
    let size = `${terminal.cols}x${terminal.rows}`;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!element.offsetParent) return;
        fitter.fit();
        const next = `${terminal.cols}x${terminal.rows}`;
        if (next !== size && opened) backend.resize(opened.id, terminal.cols, terminal.rows);
        size = next;
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);

    // A new theme or TUI accent (on the page, or on the window around it) recolours it.
    const recolor = new MutationObserver(() => (terminal.options.theme = readTheme(element)));
    recolor.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    const windowElement = element.closest("[data-window]");
    if (windowElement) recolor.observe(windowElement, { attributes: true, attributeFilter: ["style", "class"] });

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      recolor.disconnect();
      input.dispose();
      title.dispose();
      opened?.close();
      terminal.dispose();
      view.current = null;
    };
    // A tab keeps its profile: an agent and its folder never change under it.
  }, [backend, profile.id, cwd]);

  // In front, it gets its true size (hidden ones cannot measure) and the keyboard.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fit.current?.fit();
      if (autoFocus) view.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, autoFocus]);

  // Right click copies the selection, or pastes, as in Windows Terminal.
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const terminal = view.current;
    if (!terminal) return;
    if (terminal.hasSelection()) {
      copySelection(terminal);
      terminal.clearSelection();
    } else {
      pasteClipboard(terminal);
    }
  };

  return (
    <div
      ref={box}
      role={role}
      aria-label={label}
      data-terminal
      data-session={session ?? undefined}
      onContextMenu={onContextMenu}
      className={`absolute inset-0 py-1 pl-2 select-text ${active ? "" : "hidden"}`}
    />
  );
}
