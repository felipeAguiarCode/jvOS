// Records the demo videos and encodes them: `npm run demo [-- <filter>...]`.
// 1. Playwright records each demos/*.demo.ts to demos/out/webm/<name>.webm (silent VP9, 1920×1080).
// 2. ffmpeg turns every take of this run into demos/out/mp4/<name>.mp4 (H.264, plays everywhere).
// 3. All the MP4s are joined, in order, into demos/out/mp4/00-um-dia-com-o-jarvis.mp4.
// `--encode-only` skips step 1 and re-encodes every WebM.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const out = path.join(here, "out");
const webm = path.join(out, "webm");
const mp4 = path.join(out, "mp4");
const TOUR = "00-um-dia-com-o-jarvis.mp4";

const args = process.argv.slice(2);
const encodeOnly = args.includes("--encode-only");
const filters = args.filter((arg) => !arg.startsWith("--"));

/** ffmpeg on the PATH, or where `winget install Gyan.FFmpeg.Essentials` puts it. */
function findFfmpeg() {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore", shell: true }).status === 0) return "ffmpeg";
  const packages = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (!existsSync(packages)) return null;
  for (const dir of readdirSync(packages).filter((name) => name.startsWith("Gyan.FFmpeg"))) {
    for (const build of readdirSync(path.join(packages, dir))) {
      const exe = path.join(packages, dir, build, "bin", "ffmpeg.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/** Playwright records with its own ffmpeg build. */
function hasPlaywrightFfmpeg() {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  return existsSync(browsers) && readdirSync(browsers).some((name) => name.startsWith("ffmpeg-"));
}

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error("ffmpeg não encontrado. Instale com: winget install Gyan.FFmpeg.Essentials");
  process.exit(1);
}
if (!encodeOnly && !hasPlaywrightFfmpeg()) {
  console.error("O ffmpeg do Playwright não está instalado. Rode: npx playwright install ffmpeg");
  process.exit(1);
}

const started = Date.now();
if (!encodeOnly) {
  const result = spawnSync("npx", ["playwright", "test", "-c", "demos/playwright.config.ts", ...filters], { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) console.error("\nAlgumas gravações falharam; os vídeos que terminaram serão convertidos.");
}

mkdirSync(mp4, { recursive: true });
const takes = existsSync(webm)
  ? readdirSync(webm)
      .filter((name) => name.endsWith(".webm"))
      .filter((name) => encodeOnly || statSync(path.join(webm, name)).mtimeMs >= started)
      .sort()
  : [];

for (const name of takes) {
  const target = path.join(mp4, name.replace(/\.webm$/, ".mp4"));
  console.log(`MP4  ${path.relative(root, target)}`);
  const result = spawnSync(
    ffmpeg,
    ["-y", "-loglevel", "error", "-i", path.join(webm, name), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", target],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exitCode = 1;
}

// The whole day, in order.
const clips = readdirSync(mp4).filter((name) => name.endsWith(".mp4") && name !== TOUR).sort();
if (takes.length && clips.length > 1) {
  const list = path.join(out, "tour.txt");
  writeFileSync(list, clips.map((name) => `file '${path.join(mp4, name).replace(/\\/g, "/")}'`).join("\n"));
  console.log(`Tour ${path.relative(root, path.join(mp4, TOUR))} (${clips.length} vídeos)`);
  spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", path.join(mp4, TOUR)], { stdio: "inherit" });
}
