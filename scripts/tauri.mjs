// Runs the Tauri CLI with the native build tools whisper-rs needs on Windows:
// - CMake (compiles whisper.cpp): from PATH, or the copy bundled with Visual Studio Build Tools;
// - libclang (bindgen generates the Windows bindings): from LIBCLANG_PATH or a standard LLVM install;
// - Vulkan SDK (GPU backend): from VULKAN_SDK, or the newest version under C:\VulkanSDK (a terminal
//   opened before the SDK was installed does not see the variable its installer sets).
// `dev` also reuses a Vite dev server that is already running instead of failing on the busy port.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function hasCmakeOnPath() {
  try {
    execFileSync("cmake", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findVisualStudioCmake() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) return null;
  try {
    const roots = execFileSync(vswhere, ["-products", "*", "-property", "installationPath"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    for (const root of roots) {
      const cmake = join(root, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe");
      if (existsSync(cmake)) return cmake;
    }
  } catch {
    // vswhere unavailable — fall through.
  }
  return null;
}

const env = { ...process.env };
if (process.platform === "win32" && !env.CMAKE && !hasCmakeOnPath()) {
  const cmake = findVisualStudioCmake();
  if (cmake) {
    env.CMAKE = cmake;
    // Windows names it "Path"; a copied env object keeps that exact casing.
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${dirname(cmake)};${env[pathKey] ?? ""}`;
  } else {
    console.warn("[jarvis] CMake not found: install it or add the 'C++ CMake tools' component of Visual Studio.");
  }
}

const llvmBin = join(process.env.ProgramFiles ?? "C:\\Program Files", "LLVM", "bin");
if (process.platform === "win32" && !env.LIBCLANG_PATH) {
  if (existsSync(join(llvmBin, "libclang.dll"))) env.LIBCLANG_PATH = llvmBin;
  else console.warn("[jarvis] libclang not found: install LLVM (winget install LLVM.LLVM) or set LIBCLANG_PATH.");
}

function findVulkanSdk() {
  const root = join(process.env.SystemDrive ?? "C:", "\\", "VulkanSDK");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((name) => existsSync(join(root, name, "Lib", "vulkan-1.lib")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.length ? join(root, versions.at(-1)) : null;
}

if (process.platform === "win32" && !env.VULKAN_SDK) {
  const sdk = findVulkanSdk();
  if (sdk) env.VULKAN_SDK = sdk;
}

/** `devUrl` in src-tauri/tauri.conf.json. */
const DEV_URL = "http://localhost:1420";

/** True when the JARVIS Vite dev server is already up (e.g. `npm run dev:web` in another terminal). */
async function isDevServerRunning() {
  try {
    const response = await fetch(DEV_URL, { signal: AbortSignal.timeout(1500) });
    return (await response.text()).includes("<title>JARVIS OS</title>");
  } catch {
    return false;
  }
}

const args = process.argv.slice(2);
// `tauri dev` starts its own Vite on the fixed port and aborts when the port is taken: reuse the running one.
if (args[0] === "dev" && (await isDevServerRunning())) {
  args.splice(1, 0, "--config", JSON.stringify({ build: { beforeDevCommand: "" } }));
  console.log(`[jarvis] Using the Vite dev server already running at ${DEV_URL}.`);
}

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
