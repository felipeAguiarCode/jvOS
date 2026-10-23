import type { Page } from "@playwright/test";

export const SCREENS = "test-results/screens";
export const DOCK_RESERVE = 120;
/** Area around the dock, for close-up screenshots at 1920×1080. */
export const DOCK_CLIP = { x: 560, y: 900, width: 800, height: 180 };

export async function waitForFrames(page: Page, count = 45) {
  await page.waitForFunction((n) => (window.__JARVIS__?.signals.frames ?? 0) > n, count, { timeout: 90_000 });
}

/** Default settings, except the top bar (on by default), which would show in the visual checks. */
export const PLAIN_SETTINGS = JSON.stringify({ taskbar: false });

/** Push-to-talk is the default: the toggle tests switch to the "Hey Jarvis" mode first. */
export const useToggleMode = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("jarvis.settings", JSON.stringify({ activation: "wakeWord", taskbar: false })));

export const frames = (page: Page) => page.evaluate(() => window.__JARVIS__?.signals.frames ?? 0);
export const voiceStatus = (page: Page) => page.evaluate(() => window.__JARVIS__?.status);

/** Average color (0..255) of the lit hologram pixels above the dock, measured on a real screenshot. */
export async function hologramTint(page: Page) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ data, reserve }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, image.width, image.height - reserve);
      const sum = [0, 0, 0];
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 120) continue;
        for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
        lit++;
      }
      const [r, g, b] = sum.map((value) => Math.round(value / Math.max(1, lit)));
      return { r, g, b, lit };
    },
    { data: png, reserve: DOCK_RESERVE },
  );
}

/** Mean and peak brightness (0..255, brightest channel) of a screen region, measured on a real screenshot. */
export async function regionLevel(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      sum += value;
      max = Math.max(max, value);
    }
    return { mean: Math.round((sum / (pixels.length / 4)) * 10) / 10, max };
  }, png);
}

/** Bounding box (CSS px) of lit cyan pixels above the dock area, measured on a real screenshot. */
export async function measureHologram(page: Page) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ data, reserve }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
      const limit = image.height - reserve;
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      let lit = 0;
      for (let y = 0; y < limit; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          if (pixels[i + 1] + pixels[i + 2] < 150) continue; // cyan lines: green + blue
          lit++;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      return { top, bottom, left, right, litShare: lit / (image.width * image.height) };
    },
    { data: png, reserve: DOCK_RESERVE },
  );
}

/**
 * Stands in for yt-dlp in the browser (development only): every song resolves to a silent WAV
 * of `seconds`, generated in the page.
 */
export const standInMusic = (page: Page, seconds: number) =>
  page.evaluate((length) => {
    const rate = 8000;
    const size = Math.round(length * rate);
    const buffer = new ArrayBuffer(44 + size);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    ascii(0, "RIFF");
    view.setUint32(4, 36 + size, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    ascii(36, "data");
    view.setUint32(40, size, true);
    new Uint8Array(buffer, 44).fill(128); // silence
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    window.__JARVIS_MUSIC__ = { resolve: () => url };
  }, seconds);
