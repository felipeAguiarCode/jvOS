import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Shown on the boot screen; npm sets it for every `npm run` script.
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },

  build: {
    // WebView2 (and the Edge the tests use) is an evergreen Chromium: no down-levelling of
    // modern syntax, so smaller, faster code.
    target: "chrome120",
    // The largest chunk is the 3D hologram's (three.js, ~1 MB, loaded only with the 3D core);
    // anything bigger than that is a regression worth a warning.
    chunkSizeWarningLimit: 1100,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and Cargo's build folder (`t/`, see
      //    src-tauri/.cargo/config.toml)
      ignored: ["**/src-tauri/**", "**/t/**"],
    },
  },
}));
