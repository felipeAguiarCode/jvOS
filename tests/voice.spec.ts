import { expect, test } from "@playwright/test";
import { DOCK_CLIP, DOCK_RESERVE, SCREENS, useToggleMode, voiceStatus, waitForFrames } from "./helpers";

/** The dock plus the recording strip on its left, at 1920×1080. */
const RECORDING_CLIP = { ...DOCK_CLIP, x: DOCK_CLIP.x - 200, width: DOCK_CLIP.width + 200 };

interface Probe {
  streams: MediaStream[];
  contexts: AudioContext[];
}

test("listens, reacts to audio and releases resources", async ({ page }) => {
  // Keep handles on the streams and audio contexts the app creates.
  await page.addInitScript(() => {
    const probe = { streams: [] as MediaStream[], contexts: [] as AudioContext[] };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      probe.streams.push(stream);
      return stream;
    };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
      }
    };
  });
  await useToggleMode(page);
  const probeCount = () =>
    page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.streams.length);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);
  expect(await voiceStatus(page)).toBe("idle");
  expect(await probeCount()).toBe(0); // never opened automatically

  const voice = page.getByRole("button", { name: /^Voice/ });
  await voice.click();
  await expect.poll(() => voiceStatus(page)).toBe("listening");

  let peak = { level: 0, bass: 0, mid: 0, treble: 0, voice: 0, spectrum: 0 };
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => {
          const { level, bass, mid, treble, voice, spectrum } = window.__JARVIS__!.signals;
          return { level, bass, mid, treble, voice, spectrum: Math.max(...spectrum) };
        });
        peak = {
          level: Math.max(peak.level, s.level),
          bass: Math.max(peak.bass, s.bass),
          mid: Math.max(peak.mid, s.mid),
          treble: Math.max(peak.treble, s.treble),
          voice: Math.max(peak.voice, s.voice),
          spectrum: Math.max(peak.spectrum, s.spectrum),
        };
        // The spectrum comes from the smoothed FFT, a few frames behind the level.
        return peak.level > 0.1 && peak.voice > 0.1 && peak.spectrum > 0.05;
      },
      { timeout: 20_000, intervals: [40] },
    )
    .toBe(true);
  console.log(`peaks with the fake microphone: ${JSON.stringify(peak)}`);
  await page.mouse.move(40, 40);
  await page.screenshot({ path: `${SCREENS}/voice-listening.png` });
  // No permanent "listening" text: once the pointer leaves, the screen holds no text at all.
  await expect.poll(() => page.evaluate(() => document.body.innerText.trim())).toBe("");

  await voice.click();
  await expect.poll(() => voiceStatus(page)).toBe("idle");
  const released = await page.evaluate(() => {
    const { streams, contexts } = (window as unknown as { __probe: Probe }).__probe;
    return {
      streams: streams.length,
      contexts: contexts.length,
      tracksEnded: streams.flatMap((s) => s.getTracks()).every((t) => t.readyState === "ended"),
      contextsClosed: contexts.every((c) => c.state === "closed"),
    };
  });
  expect(released).toEqual({ streams: 1, contexts: 1, tracksEnded: true, contextsClosed: true });

  // Silence → the hologram eases back to its resting motion.
  await expect
    .poll(() => page.evaluate(() => window.__JARVIS__?.signals.level ?? 1), { timeout: 5000 })
    .toBeLessThan(0.01);
});

test("a transcript materialises inside the core, then fades away", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);
  await page.mouse.move(40, 40);

  await page.evaluate(() => window.__JARVIS__!.hear("Hey Jarvis, abre o navegador"));
  const caption = page.locator("p", { hasText: "Hey Jarvis, abre o navegador" });
  await expect(caption).toBeVisible();

  // Centred on the core: middle of the area above the dock.
  const box = (await caption.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - (1080 - DOCK_RESERVE) / 2)).toBeLessThan(30);
  expect(box.width).toBeLessThan(400);

  // Words arrive one after another; once all are in, every word sits at high (but not full) opacity.
  await page.waitForTimeout(1200);
  const opacities = await caption.locator("span.inline-block").evaluateAll((spans) =>
    spans.map((span) => Number(getComputedStyle(span).opacity)),
  );
  expect(opacities).toHaveLength(5);
  for (const opacity of opacities) expect(opacity).toBeCloseTo(0.92, 2);
  await page.screenshot({ path: `${SCREENS}/voice-caption.png` });

  await expect(caption).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => document.body.innerText.trim())).toBe("");
});

test("push-to-talk (the default) listens only while Voice or M is held", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);

  const voice = page.getByRole("button", { name: /^Voice/ });
  await expect(voice).toHaveAccessibleName("Voice · segure para falar");
  await expect(voice).toHaveAttribute("aria-pressed", "false");

  await voice.hover();
  await page.mouse.down();
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  await expect(voice).toHaveAccessibleName("Voice · solte para parar");
  // WhatsApp-style strip: recording light, running clock, slide-to-cancel hint.
  const timer = page.getByRole("timer");
  await expect(timer).toBeVisible();
  await expect(timer).toContainText("Deslize para cancelar");
  await expect(timer).toContainText("0:01", { timeout: 3000 });
  await page.screenshot({ path: `${SCREENS}/voice-recording.png`, clip: RECORDING_CLIP });
  // Moving up and right off the button while holding keeps listening (pointer capture) until release.
  const box = (await voice.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y - 300, { steps: 5 });
  await page.waitForTimeout(300);
  expect(await voiceStatus(page)).toBe("listening");
  await page.mouse.up();
  await expect.poll(() => voiceStatus(page)).toBe("idle");
  await expect(timer).toBeHidden();

  // A quick click is a very short hold: it never leaves the microphone on, and explains how to talk.
  await voice.click();
  await expect(page.getByText("Segure para falar")).toBeVisible();
  await page.waitForTimeout(800);
  expect(await voiceStatus(page)).toBe("idle");

  await page.mouse.move(40, 40);
  await page.keyboard.down("m");
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await expect(timer).toBeVisible();
  await page.keyboard.up("m");
  await expect.poll(() => voiceStatus(page)).toBe("idle");
});

test("push-to-talk is cancelled by sliding left or by Esc", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);

  const voice = page.getByRole("button", { name: /^Voice/ });
  const box = (await voice.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await page.waitForTimeout(500);

  // Part of the way: the hint follows the pointer, still recording.
  await page.mouse.move(x - 70, y, { steps: 5 });
  await page.screenshot({ path: `${SCREENS}/voice-slide-to-cancel.png`, clip: RECORDING_CLIP });
  expect(await voiceStatus(page)).toBe("listening");
  // Far enough: cancelled before the button is even released.
  await page.mouse.move(x - 160, y, { steps: 5 });
  await expect.poll(() => voiceStatus(page)).toBe("idle");
  await expect(page.getByRole("timer")).toBeHidden();
  await expect(page.getByText("Gravação cancelada")).toBeVisible();
  await page.mouse.up();
  expect(await voiceStatus(page)).toBe("idle");

  // Holding M, Esc cancels.
  await page.mouse.move(40, 40);
  await page.waitForTimeout(3500); // the notice fades
  await page.keyboard.down("m");
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await expect.poll(() => voiceStatus(page)).toBe("idle");
  await expect(page.getByText("Gravação cancelada")).toBeVisible();
  await page.keyboard.up("m");
  expect(await voiceStatus(page)).toBe("idle");
});

test("particles and rings align on the core's equator while listening, then scatter", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?quality=high");
  await waitForFrames(page);
  const align = () => page.evaluate(() => window.__JARVIS__!.signals.align);

  // At rest they fly free: a second apart the frames differ.
  await page.mouse.move(40, 40);
  await page.waitForTimeout(1000);
  expect(await align()).toBe(0);
  await page.screenshot({ path: `${SCREENS}/hologram-wander-a.png` });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENS}/hologram-wander-b.png` });

  const voice = page.getByRole("button", { name: /^Voice/ });
  await voice.hover();
  await page.mouse.down();
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await expect.poll(align, { timeout: 5000 }).toBeGreaterThan(0.98);
  await page.screenshot({ path: `${SCREENS}/hologram-aligned.png` });

  await page.mouse.up();
  await expect.poll(() => voiceStatus(page)).toBe("idle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/hologram-scatter.png` });
  await expect.poll(align, { timeout: 6000 }).toBeLessThan(0.02);
});

test("keyboard shortcut M toggles the microphone", async ({ page }) => {
  await useToggleMode(page);
  await page.goto("/");
  await waitForFrames(page);
  await page.keyboard.press("m");
  await expect.poll(() => voiceStatus(page)).toBe("listening");
  await page.keyboard.press("m");
  await expect.poll(() => voiceStatus(page)).toBe("idle");
});
