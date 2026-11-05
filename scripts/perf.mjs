// Measures what the running JARVIS app costs (jarvis.exe plus every child: the WebView2 processes,
// claude.exe, terminals) over a time window, so optimisations are compared with numbers instead of
// impressions. Windows only.
//
//   npm run perf -- [--seconds 60] [--label "2d idle"] [--json out.json] [--pid 1234]
//   npm run perf -- --compare before.json after.json
//
// CPU comes from each process's kernel+user time; GPU from the raw "GPU Engine" running time (the
// same source as Task Manager, averaged exactly over the window); memory is private bytes at the
// end (WebView2 processes share pages, so working sets would be counted twice). The WMI raw classes
// are used because their names are not localised, unlike `Get-Counter` paths on a pt-BR Windows.
import { execFileSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const SNAPSHOT = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime,PrivatePageCount,WorkingSetSize,@{n='CommandLine';e={ if ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine) { $_.CommandLine -replace '[\\x00-\\x1f]', ' ' } }}
$g = Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.RunningTime -gt 0 } | Select-Object Name,RunningTime,Timestamp_Sys100NS
$m = Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUProcessMemory | Select-Object Name,DedicatedUsage,SharedUsage
$a = Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,DedicatedUsage
$e = Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine | Select-Object Name
@{ at = [DateTime]::UtcNow.Ticks; processes = @($p); engines = @($g); memory = @($m); adapters = @($a); engineNames = @($e | ForEach-Object { $_.Name }) } | ConvertTo-Json -Compress -Depth 3
`;

function parseArgs(argv) {
  const options = { seconds: 60, label: "", json: null, pid: null, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seconds") options.seconds = Number(argv[++i]);
    else if (arg === "--label") options.label = argv[++i] ?? "";
    else if (arg === "--json") options.json = argv[++i];
    else if (arg === "--pid") options.pid = Number(argv[++i]);
    else if (arg === "--compare") options.compare = [argv[++i], argv[++i]];
    else if (arg === "--help" || arg === "-h") {
      console.log("npm run perf -- [--seconds 60] [--label name] [--json out.json] [--pid N] | --compare a.json b.json");
      process.exit(0);
    }
  }
  if (!options.compare && !(options.seconds > 0)) throw new Error("--seconds must be a positive number");
  return options;
}

function snapshot() {
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", SNAPSHOT], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(out);
}

/** jarvis.exe (or `pid`) and all its descendants. */
function processTree(processes, pid) {
  const roots = pid ? processes.filter((p) => p.ProcessId === pid) : processes.filter((p) => p.Name?.toLowerCase() === "jarvis.exe");
  if (roots.length === 0) return null;
  const byParent = new Map();
  for (const p of processes) {
    if (!byParent.has(p.ParentProcessId)) byParent.set(p.ParentProcessId, []);
    byParent.get(p.ParentProcessId).push(p);
  }
  const tree = new Map();
  const queue = [...roots];
  while (queue.length) {
    const current = queue.shift();
    if (tree.has(current.ProcessId)) continue;
    tree.set(current.ProcessId, current);
    for (const child of byParent.get(current.ProcessId) ?? []) queue.push(child);
  }
  return tree;
}

/** A readable role: "jarvis", "webview2:renderer", "webview2:gpu-process", "claude", ... */
function role(p) {
  const name = (p.Name ?? "").toLowerCase().replace(/\.exe$/, "");
  if (name !== "msedgewebview2") return name;
  const type = /--type=([\w-]+)/.exec(p.CommandLine ?? "")?.[1];
  if (!type) return "webview2:browser";
  const sub = /--utility-sub-type=([\w.]+)/.exec(p.CommandLine ?? "")?.[1];
  return sub ? `webview2:${type}:${sub.split(".")[0]}` : `webview2:${type}`;
}

/** Labels each GPU adapter LUID: dedicated memory or an optical-flow engine → dGPU; video processing → iGPU. */
function adapterLabels(snap) {
  const labels = new Map();
  const engines = new Map();
  for (const name of snap.engineNames ?? []) {
    const match = /luid_(0x[0-9A-Fa-f]+_0x[0-9A-Fa-f]+)_phys_\d+_eng_\d+_engtype_(.*)$/.exec(name);
    if (!match) continue;
    if (!engines.has(match[1])) engines.set(match[1], new Set());
    engines.get(match[1]).add(match[2]);
  }
  for (const [luid, types] of engines) {
    const adapter = snap.adapters?.find((a) => a.Name?.includes(luid));
    const dedicated = Number(adapter?.DedicatedUsage ?? 0) > 0;
    const label = dedicated || [...types].some((t) => t.startsWith("OFA")) ? "dGPU" : types.has("VideoProcessing") ? "iGPU" : "other";
    labels.set(luid, `${label}(${luid.slice(-5)})`);
  }
  return labels;
}

/** GPU % per pid and adapter: per engine type, busy time / wall time; the busiest type wins (Task Manager rule). */
function gpuUsage(before, after, pids) {
  const start = new Map(before.engines.map((e) => [e.Name, e]));
  const busy = new Map(); // `${pid}|${luid}|${type}` → fraction
  for (const engine of after.engines) {
    const match = /^pid_(\d+)_luid_(0x[0-9A-Fa-f]+_0x[0-9A-Fa-f]+)_phys_\d+_eng_\d+_engtype_(.*)$/.exec(engine.Name);
    if (!match || !pids.has(Number(match[1]))) continue;
    const previous = start.get(engine.Name);
    const elapsed = Number(engine.Timestamp_Sys100NS) - Number(previous?.Timestamp_Sys100NS ?? before.at);
    if (elapsed <= 0) continue;
    const delta = Number(engine.RunningTime) - Number(previous?.RunningTime ?? 0);
    const key = `${match[1]}|${match[2]}|${match[3] || "?"}`;
    busy.set(key, (busy.get(key) ?? 0) + Math.max(0, delta) / elapsed);
  }
  const result = new Map(); // pid → Map(luid → percent)
  for (const [key, fraction] of busy) {
    const [pid, luid] = key.split("|");
    if (!result.has(Number(pid))) result.set(Number(pid), new Map());
    const perAdapter = result.get(Number(pid));
    perAdapter.set(luid, Math.max(perAdapter.get(luid) ?? 0, fraction * 100));
  }
  return result;
}

function gpuMemory(snap, pid) {
  let total = 0;
  for (const m of snap.memory ?? []) {
    if (m.Name?.startsWith(`pid_${pid}_`)) total += Number(m.DedicatedUsage ?? 0) + Number(m.SharedUsage ?? 0);
  }
  return total;
}

const mb = (bytes) => bytes / (1024 * 1024);
const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "-");

function measure(options) {
  const before = snapshot();
  const treeBefore = processTree(before.processes, options.pid);
  if (!treeBefore) throw new Error("jarvis.exe is not running (start it with `npm run dev`, or pass --pid)");
  console.log(`[perf] measuring ${treeBefore.size} processes for ${options.seconds} s…`);
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Start-Sleep -Seconds ${options.seconds}`], { windowsHide: true });
  const after = snapshot();
  const treeAfter = processTree(after.processes, options.pid) ?? new Map();

  const wallSeconds = (Number(after.at) - Number(before.at)) / 1e7;
  const cpus = availableParallelism();
  const labels = adapterLabels(after);
  const gpu = gpuUsage(before, after, new Set(treeAfter.keys()));

  const rows = [];
  for (const [pid, p] of treeAfter) {
    const start = treeBefore.get(pid);
    // A process born inside the window counts from zero.
    const cpuTime = (Number(p.KernelModeTime) + Number(p.UserModeTime) - (start ? Number(start.KernelModeTime) + Number(start.UserModeTime) : 0)) / 1e7;
    const gpuByAdapter = Object.fromEntries([...(gpu.get(pid) ?? new Map())].map(([luid, pct]) => [labels.get(luid) ?? luid, pct]));
    rows.push({
      pid,
      role: role(p),
      cpuMsPerSecond: (cpuTime * 1000) / wallSeconds,
      cpuPercent: (cpuTime / wallSeconds / cpus) * 100,
      privateMb: mb(Number(p.PrivatePageCount ?? 0)),
      workingSetMb: mb(Number(p.WorkingSetSize ?? 0)),
      gpuMemoryMb: mb(gpuMemory(after, pid)),
      gpu: gpuByAdapter,
    });
  }
  rows.sort((a, b) => b.cpuMsPerSecond - a.cpuMsPerSecond);

  const adapters = new Set(rows.flatMap((row) => Object.keys(row.gpu)));
  const total = {
    cpuMsPerSecond: rows.reduce((sum, row) => sum + row.cpuMsPerSecond, 0),
    cpuPercent: rows.reduce((sum, row) => sum + row.cpuPercent, 0),
    privateMb: rows.reduce((sum, row) => sum + row.privateMb, 0),
    gpuMemoryMb: rows.reduce((sum, row) => sum + row.gpuMemoryMb, 0),
    gpu: Object.fromEntries([...adapters].map((adapter) => [adapter, rows.reduce((sum, row) => sum + (row.gpu[adapter] ?? 0), 0)])),
  };
  return { label: options.label, at: new Date().toISOString(), seconds: wallSeconds, cpus, rows, total };
}

function print(result) {
  const adapters = Object.keys(result.total.gpu).sort();
  const header = ["role", "pid", "cpu ms/s", "cpu %", "private MB", "gpu mem MB", ...adapters.map((a) => `${a} %`)];
  const lines = result.rows.map((row) => [
    row.role,
    String(row.pid),
    fixed(row.cpuMsPerSecond),
    fixed(row.cpuPercent, 2),
    fixed(row.privateMb, 0),
    fixed(row.gpuMemoryMb, 0),
    ...adapters.map((a) => fixed(row.gpu[a] ?? 0)),
  ]);
  lines.push([
    "TOTAL",
    "",
    fixed(result.total.cpuMsPerSecond),
    fixed(result.total.cpuPercent, 2),
    fixed(result.total.privateMb, 0),
    fixed(result.total.gpuMemoryMb, 0),
    ...adapters.map((a) => fixed(result.total.gpu[a] ?? 0)),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((line) => line[i].length)));
  const format = (cells) => cells.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  console.log(`\n${result.label ? `[${result.label}] ` : ""}${fixed(result.seconds, 0)} s, ${result.cpus} logical CPUs`);
  console.log(format(header));
  for (const line of lines) console.log(format(line));
}

function compare([beforePath, afterPath]) {
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const delta = (a, b) => {
    const change = a ? ((b - a) / a) * 100 : 0;
    return `${fixed(a)} → ${fixed(b)} (${change > 0 ? "+" : ""}${fixed(change, 0)}%)`;
  };
  console.log(`${before.label || beforePath} → ${after.label || afterPath}`);
  console.log(`cpu ms/s     ${delta(before.total.cpuMsPerSecond, after.total.cpuMsPerSecond)}`);
  console.log(`private MB   ${delta(before.total.privateMb, after.total.privateMb)}`);
  console.log(`gpu mem MB   ${delta(before.total.gpuMemoryMb, after.total.gpuMemoryMb)}`);
  for (const adapter of new Set([...Object.keys(before.total.gpu), ...Object.keys(after.total.gpu)])) {
    console.log(`${adapter} %`.padEnd(13) + delta(before.total.gpu[adapter] ?? 0, after.total.gpu[adapter] ?? 0));
  }
}

const options = parseArgs(process.argv.slice(2));
if (process.platform !== "win32") throw new Error("scripts/perf.mjs measures Windows processes only");
if (options.compare) {
  compare(options.compare);
} else {
  const result = measure(options);
  print(result);
  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\n[perf] saved ${options.json}`);
  }
}
