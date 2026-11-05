import { test as base, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import type { WindowCommandEvent, WindowGroup } from "../../src/hooks/useVoiceAssistant";
import type { ShortcutEvent } from "../../src/lib/shortcuts";
import { desktopWith, NAME, SYSTEM } from "./fixtures";

// One demo = one silent 1920×1080 clip of the web build with the DEV fakes. The fixture moves the
// clock to the scene's time of day, seeds localStorage, installs the fakes, makes the hologram
// "listen" and "speak", and records with page.screencast once the desktop is up.

type CoreMode = "2d" | "3d" | "off";
type AssistantFake = { reply?: string; delayMs?: number; error?: string; files?: { path: string; content: string }[] };

export interface Scene {
  /** Local date and time the scene happens at, e.g. "2026-11-04T07:30". The clock keeps ticking from there. */
  at: string;
  core?: CoreMode;
  /** The BIOS boot screen (muted). The recording then starts on a black page, before it. */
  boot?: boolean;
  taskbar?: boolean;
  /** Merged into `jarvis.settings`. */
  settings?: Record<string, unknown>;
  /** Other `jarvis.*` keys, as values (stringified here). */
  storage?: Record<string, unknown>;
  /** Extra `window.__JARVIS_*__` fakes; the assistant, speech, system, battery and music ones are always on. */
  fakes?: Record<string, unknown>;
  assistant?: AssistantFake;
  /** Runs once the desktop is up, before the recording starts. */
  setup?: (demo: Demo) => Promise<void>;
}

/** Web-only notices that the desktop app never shows: hidden, or worded as the desktop app does. */
const HIDE = ["Reconhecimento de voz e abertura de programas funcionam no app desktop."];
const REPLACE: Record<string, string> = { "modo navegador · só visual": "Whisper Small" };

/** Runs in the page before any of its scripts, on every document. */
function prepare(p: { at: number; storage: Record<string, string>; fakes: Record<string, unknown>; system: typeof SYSTEM; hide: string[]; replace: Record<string, string> }) {
  // The scene's time of day: Date only, so requestAnimationFrame and performance.now stay real.
  const RealDate = Date;
  const offset = p.at - RealDate.now();
  function ShiftedDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return args.length ? new (RealDate as unknown as new (...a: unknown[]) => Date)(...args) : new RealDate(RealDate.now() + offset);
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => RealDate.now() + offset;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  (window as unknown as { Date: unknown }).Date = ShiftedDate;

  try {
    if (!sessionStorage.getItem("jarvis.demo")) {
      for (const [key, value] of Object.entries(p.storage)) localStorage.setItem(key, value);
      sessionStorage.setItem("jarvis.demo", "seeded");
    }
  } catch {
    // about:blank has no storage.
  }

  const w = window as unknown as Record<string, unknown>;
  Object.assign(w, p.fakes);

  // The meters breathe.
  const jitter = (value: number, spread: number) => Math.min(0.98, Math.max(0.02, value + (Math.random() - 0.5) * spread));
  const system = () => ({
    ...p.system,
    cpu: jitter(p.system.cpu, 0.16),
    gpu: jitter(p.system.gpu, 0.12),
    ram: { ...p.system.ram, used: p.system.ram.used * jitter(1, 0.04) },
  });
  w.__JARVIS_SYSTEM__ = system();
  setInterval(() => (w.__JARVIS_SYSTEM__ = system()), 1000);

  // A laptop on the charger.
  const battery = { level: 0.87, charging: true, chargingTime: 1800, dischargingTime: Infinity, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(Navigator.prototype, "getBattery", { configurable: true, value: () => Promise.resolve(battery) });

  // Every song resolves to a silent WAV (the recording has no sound anyway).
  let song: string | null = null;
  w.__JARVIS_MUSIC__ = {
    resolve: () => {
      if (song) return song;
      const rate = 8000;
      const size = rate * 240;
      const buffer = new ArrayBuffer(44 + size);
      const view = new DataView(buffer);
      const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      ascii(0, "RIFF");
      view.setUint32(4, 36 + size, true);
      ascii(8, "WAVE");
      ascii(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      ascii(36, "data");
      view.setUint32(40, size, true);
      new Uint8Array(buffer, 44).fill(128);
      return (song = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })));
    },
  };

  // The hologram listens while `__DEMO__.listening` is on, and speaks while JARVIS's words are on
  // screen (the TTS fake is silent, so nothing else would move it).
  const demo = { listening: false };
  w.__DEMO__ = demo;
  const start = performance.now();
  const drive = () => {
    const signals = (w.__JARVIS__ as { signals?: Record<string, number> & { spectrum: Float32Array } } | undefined)?.signals;
    if (signals) {
      if (demo.listening) {
        Object.assign(signals, { align: 1, voice: 0.8, level: 0.7, active: 1 });
      } else if (document.querySelector('[data-testid="jarvis-reply-words"]')) {
        const t = (performance.now() - start) / 1000;
        const syllables = Math.max(0, Math.sin(t * 2 * Math.PI * 4.2) * 0.6 + Math.sin(t * 2 * Math.PI * 1.3 + 1) * 0.4);
        const envelope = syllables ** 1.5;
        Object.assign(signals, { active: 1, voice: 0.35 + 0.55 * envelope, level: 0.25 + 0.6 * envelope, mid: 0.5 * envelope, bass: 0.3 * envelope, treble: 0.2 * envelope });
        for (let i = 0; i < signals.spectrum.length; i++) signals.spectrum[i] = envelope * Math.exp(-i / 9) * (0.8 + 0.2 * Math.sin(t * 9 + i));
      }
    }
    requestAnimationFrame(drive);
  };
  requestAnimationFrame(drive);

  // Web-only notices.
  const tidy = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? "";
      if (p.replace[text]) node.textContent = p.replace[text];
      else if (p.hide.includes(text) && node.parentElement) node.parentElement.style.display = "none";
    }
  };
  new MutationObserver((records) => records.forEach((record) => (record.type === "characterData" ? tidy(record.target.parentNode ?? record.target) : record.addedNodes.forEach(tidy)))).observe(document, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

export class Demo {
  constructor(
    readonly page: Page,
    private readonly video: string,
  ) {}

  private recording = false;

  /** Sets the scene up, loads the desktop and starts recording. */
  async start(scene: Scene) {
    const { page } = this;
    const storage: Record<string, unknown> = {
      "jarvis.boot": { enabled: !!scene.boot, sound: false },
      "jarvis.settings": { taskbar: scene.taskbar ?? true, assistantName: NAME, ...scene.settings },
      "jarvis.core": { mode: scene.core ?? "3d" },
      "jarvis.desktop": desktopWith(),
      ...scene.storage,
    };
    await page.addInitScript(prepare, {
      at: new Date(scene.at).getTime(),
      storage: Object.fromEntries(Object.entries(storage).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])),
      fakes: {
        __JARVIS_ASSISTANT__: scene.assistant ?? { reply: "Às suas ordens.", delayMs: 70 },
        __JARVIS_SPEECH__: { msPerWord: 330 },
        ...scene.fakes,
      },
      system: SYSTEM,
      hide: HIDE,
      replace: REPLACE,
    });

    if (scene.boot) {
      await page.setContent('<html><body style="margin:0;background:#000"></body></html>');
      await this.record();
      await page.goto("/?quality=high");
      return;
    }
    await page.goto("/?quality=high");
    await this.frames();
    await this.beat(1400); // the dock slides in
    if (scene.setup) await scene.setup(this);
    await this.record();
    await this.beat(800);
  }

  private async record() {
    await this.page.screencast.start({ path: this.video, size: { width: 1920, height: 1080 }, fps: 30, quality: 90 });
    await this.page.screencast.showActions({ cursor: "pointer", duration: 350, style: { title: "display: none" } });
    this.recording = true;
  }

  async stop() {
    if (!this.recording) return;
    this.recording = false;
    await this.page.screencast.stop();
  }

  /** The hologram has drawn `count` frames (it never draws with the core off or behind a maximised app). */
  frames(count = 30) {
    return this.page.waitForFunction((n) => (window.__JARVIS__?.signals.frames ?? 0) > n, count, { timeout: 90_000 });
  }

  beat(ms: number) {
    return this.page.waitForTimeout(ms);
  }

  /** Keys typed one by one, at a person's pace. */
  async type(text: string, delay = 75) {
    await this.page.keyboard.type(text, { delay });
  }

  async press(keys: string, pause = 450) {
    await this.page.keyboard.press(keys);
    await this.beat(pause);
  }

  /** Someone talks to JARVIS: the core listens, then the transcript materialises in it. */
  async heard(said: string, listen = 1500) {
    await this.page.evaluate(() => {
      (window as unknown as { __DEMO__: { listening: boolean } }).__DEMO__.listening = true;
      window.__JARVIS__!.signals.pulse = 1;
    });
    await this.beat(listen);
    await this.page.evaluate((text) => {
      (window as unknown as { __DEMO__: { listening: boolean } }).__DEMO__.listening = false;
      window.__JARVIS__!.hear(text);
    }, said);
    await this.beat(900);
  }

  /** A voice shortcut ("que horas são", "protocolo foco"…), as the engine would fire it. */
  async shortcut(said: string, action: string, text = "") {
    await this.heard(said);
    await this.page.evaluate((event) => window.__JARVIS__!.voiceShortcut(event as ShortcutEvent), { action, text, said });
  }

  /** "Abre o relógio" / "fecha a calculadora". */
  async window(said: string, event: WindowCommandEvent) {
    await this.heard(said);
    await this.page.evaluate((e) => window.__JARVIS__!.voiceWindow(e), event);
  }

  async closeGroup(said: string, group: WindowGroup) {
    await this.heard(said);
    await this.page.evaluate((g) => window.__JARVIS__!.voiceCloseGroup(g), group);
  }

  async music(said: string, event: Parameters<NonNullable<typeof window.__JARVIS__>["voiceMusic"]>[0]) {
    await this.heard(said);
    await this.page.evaluate((e) => window.__JARVIS__!.voiceMusic(e), event);
  }

  async pomodoro(said: string, action: Parameters<NonNullable<typeof window.__JARVIS__>["voicePomodoro"]>[0]) {
    await this.heard(said);
    await this.page.evaluate((a) => window.__JARVIS__!.voicePomodoro(a), action);
  }

  /** A question for Claude Code: the assistant fake streams `reply` (and writes `files`). */
  async ask(said: string, answer: AssistantFake, prompt?: { shortcut: string; text: string }) {
    await this.heard(said);
    await this.page.evaluate(
      ([fake, question, event]) => {
        window.__JARVIS_ASSISTANT__ = { delayMs: 70, ...fake };
        if (event) window.__JARVIS__!.voiceShortcut({ action: event.shortcut, text: event.text, said: question } as ShortcutEvent);
        else window.__JARVIS__!.ask(question);
      },
      [answer, said, prompt ?? null] as const,
    );
  }

  /** One of JARVIS's MCP tools, as Claude Code would call it. */
  action(tool: string, args: Record<string, unknown>) {
    return this.page.evaluate(([name, input]) => window.__JARVIS__!.action(name, input), [tool, args] as const);
  }

  /** JARVIS has finished talking (his words left the core). */
  async replied(timeout = 90_000) {
    await expect(this.page.getByTestId("jarvis-reply")).toBeVisible({ timeout: 10_000 });
    await expect(this.page.getByTestId("jarvis-reply")).toBeHidden({ timeout });
  }

  dialog(name: string) {
    return this.page.getByRole("dialog", { name, exact: true });
  }

  /** Opens a widget or an app from its dock launcher, with the pointer. */
  async open(name: string, group: "Widgets" | "Apps") {
    await this.page.getByRole("button", { name: group, exact: true }).click();
    const launcher = this.page.getByRole("dialog", { name: `Menu de ${group.toLowerCase()}` });
    await expect(launcher).toBeVisible();
    await this.beat(700);
    await launcher.getByRole("button", { name, exact: true }).click();
    const dialog = this.dialog(name);
    await expect(dialog).toBeVisible();
    await this.beat(900);
    return dialog;
  }

  /** Drags by (dx, dy) in small steps, so the move reads on video. */
  async drag(handle: Locator, dx: number, dy: number, steps = 30) {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 12);
    await this.page.mouse.move(x, y, { steps: 12 });
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y + dy, { steps });
    await this.beat(500);
    await this.page.mouse.up();
    await this.beat(500);
  }

  /** The pointer glides to the locator (the cursor overlay follows actions only). */
  async glide(target: Locator) {
    const box = (await target.boundingBox())!;
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
  }
}

export const test = base.extend<{ demo: Demo }>({
  demo: async ({ page }, use, testInfo) => {
    const name = path.basename(testInfo.file).replace(/\.demo\.ts$/, "");
    const demo = new Demo(page, path.join(testInfo.project.testDir, "out", "webm", `${name}.webm`));
    await use(demo);
    await demo.beat(1200);
    await demo.stop();
  },
});

export { expect };
