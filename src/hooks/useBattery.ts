import { useEffect, useState } from "react";

/** Battery Status API (not in lib.dom). */
interface BatteryManager extends EventTarget {
  charging: boolean;
  /** Seconds to full, Infinity when unknown or not charging. */
  chargingTime: number;
  /** Seconds to empty, Infinity when unknown or charging. */
  dischargingTime: number;
  /** 0..1 */
  level: number;
}

export type BatteryStatus =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; level: number; charging: boolean; chargingTime: number; dischargingTime: number };

export const LOW_BATTERY = 0.15;

/** A desktop without a battery reports exactly this. */
export const isPlugged = (status: BatteryStatus) =>
  status.kind === "ready" && status.charging && status.level >= 1 && status.chargingTime === 0;

/** The machine's battery, live (Battery Status API). */
export function useBattery(): BatteryStatus {
  const [status, setStatus] = useState<BatteryStatus>({ kind: "loading" });

  useEffect(() => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery;
    if (!getBattery) {
      setStatus({ kind: "unavailable" });
      return;
    }
    let battery: BatteryManager | null = null;
    let disposed = false;
    const read = () => {
      if (!battery || disposed) return;
      const { level, charging, chargingTime, dischargingTime } = battery;
      setStatus({ kind: "ready", level, charging, chargingTime, dischargingTime });
    };
    const events = ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"];
    getBattery
      .call(navigator)
      .then((manager) => {
        battery = manager;
        read();
        events.forEach((event) => manager.addEventListener(event, read));
      })
      .catch(() => !disposed && setStatus({ kind: "unavailable" }));
    return () => {
      disposed = true;
      events.forEach((event) => battery?.removeEventListener(event, read));
    };
  }, []);

  return status;
}
