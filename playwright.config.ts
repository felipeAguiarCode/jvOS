import { defineConfig } from "@playwright/test";

/** Try the real GPU in headless Edge; Chromium falls back to SwiftShader when unavailable. */
const GPU_ARGS = ["--enable-gpu", "--ignore-gpu-blocklist"];
/** Chromium's synthetic microphone (a periodic beep). */
const FAKE_MIC = "--use-fake-device-for-media-stream";

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results/artifacts",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    // Every test starts with the boot screen and the top bar turned off; boot.spec.ts plays a fresh
    // install and taskbar.spec.ts covers the bar.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:1420",
          localStorage: [
            { name: "jarvis.boot", value: '{"enabled":false,"sound":false}' },
            { name: "jarvis.settings", value: '{"taskbar":false}' },
          ],
        },
      ],
    },
    // Uses the Edge installed on Windows — no browser download needed.
    channel: "msedge",
    headless: true,
  },
  projects: [
    { name: "ui", testMatch: /(ui|settings|desktop|boot|search|tui|taskbar|dock|music|voicetab|shell|core)\.spec\.ts/, use: { launchOptions: { args: GPU_ARGS } } },
    {
      name: "voice",
      testMatch: /voice\.spec\.ts/,
      use: { launchOptions: { args: [...GPU_ARGS, FAKE_MIC, "--use-fake-ui-for-media-stream"] } },
    },
    {
      name: "voice-denied",
      testMatch: /voice-denied\.spec\.ts/,
      use: { launchOptions: { args: [...GPU_ARGS, FAKE_MIC, "--deny-permission-prompts"] } },
    },
  ],
  webServer: {
    command: "npm run dev:web",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
