import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Bytes in use out of a total. */
export interface Usage {
  used: number;
  total: number;
}

export interface DiskUsage extends Usage {
  /** "C:" */
  name: string;
}

/** One reading of the Rust meters (`system_stats`); a meter the machine cannot report is null. */
export interface SystemStats {
  /** 0..1 */
  cpu: number | null;
  /** 3D engine utilisation, 0..1. */
  gpu: number | null;
  ram: Usage | null;
  /** Committed memory (RAM + page file) against the commit limit. */
  memory: Usage | null;
  disks: DiskUsage[];
  /** Signal quality 0..1; null without Wi-Fi. */
  wlan: { signal: number; ssid: string } | null;
  /** Network throughput in bytes per second; null on the first reading. */
  net?: { down: number; up: number } | null;
}

export type SystemStatus = { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; stats: SystemStats };

declare global {
  interface Window {
    /** Development only: stands in for the Rust meters in a browser (the Playwright checks). */
    __JARVIS_SYSTEM__?: SystemStats;
  }
}

const POLL_MS = 2000;

let status: SystemStatus = { kind: "loading" };
const listeners = new Set<() => void>();
let timer = 0;

function publish(next: SystemStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

async function poll() {
  if (import.meta.env.DEV && window.__JARVIS_SYSTEM__) return publish({ kind: "ready", stats: window.__JARVIS_SYSTEM__ });
  if (!isTauri()) return publish({ kind: "unavailable" });
  try {
    publish({ kind: "ready", stats: await invoke<SystemStats>("system_stats") });
  } catch {
    publish({ kind: "unavailable" });
  }
}

/** One poll for every meter on screen; it stops when the last one closes or pauses. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    timer = window.setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.clearInterval(timer);
  };
}

const idle = () => () => undefined;
const snapshot = () => status;

/** The system meters, read every 2 s while a meter widget is on screen; paused, the last reading stays. */
export function useSystemStats(paused: boolean): SystemStatus {
  return useSyncExternalStore(paused ? idle : subscribe, snapshot);
}
