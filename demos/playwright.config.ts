import { defineConfig } from "@playwright/test";

/**
 * Demo videos (see .specs/arch/testing.md › "Vídeos de demonstração"). Each `*.demo.ts` records one
 * silent 1920×1080 clip with page.screencast in web mode, the backends replaced by the DEV fakes.
 * Run them with `npm run demo`, which also encodes the MP4s.
 */

/** Real GPU for the hologram; no throttling when the window is covered or in the background. */
const ARGS = [
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
  "--disable-features=CalculateNativeWinOcclusion",
  "--window-size=1920,1080",
];

export default defineConfig({
  testDir: ".",
  outputDir: "out/.playwright",
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    channel: "msedge",
    // Headed: headless Edge falls back to SwiftShader, and the 3D core drops to a few frames a second.
    headless: process.env.DEMO_HEADLESS === "1",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    storageState: { cookies: [], origins: [] },
    launchOptions: { args: ARGS },
  },
  projects: [
    // Opens every lazy app once, unrecorded, so Vite has compiled their chunks before the takes.
    { name: "warmup", testMatch: /warmup\.setup\.ts/ },
    { name: "demos", testMatch: /\.demo\.ts$/, dependencies: ["warmup"] },
  ],
  webServer: {
    command: "npm run dev:web",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
