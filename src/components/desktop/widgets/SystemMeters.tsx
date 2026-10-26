import { useSystemStats, type DiskUsage, type SystemStats, type Usage } from "../../../hooks/useSystemStats";
import { useStoredState } from "../../../lib/storage";
import { useWidgetMenu, WidgetMenu, type MenuSection } from "./WidgetMenu";

type MeterId = "cpu" | "gpu" | "disk" | "wlan" | "ram" | "memory";

/** The bars, in the widget's order, named as in the menu. */
const METERS: { id: MeterId; label: string }[] = [
  { id: "cpu", label: "CPU" },
  { id: "gpu", label: "GPU" },
  { id: "disk", label: "HDD" },
  { id: "wlan", label: "WLAN" },
  { id: "ram", label: "RAM" },
  { id: "memory", label: "Memória" },
];
const METER_IDS = METERS.map((meter) => meter.id);

const GB = 1024 ** 3;
/** From here a bar turns to the alert colour (for the Wi-Fi signal: from here down). */
const HIGH = 0.9;
const WEAK_SIGNAL = 0.25;

interface MeterPrefs {
  /** The bars shown, in the widget's order. */
  bars: MeterId[];
  /** The drive the HDD bar shows. */
  disk: string;
  /** The dimmed detail beside each name (GB, network, cores). */
  details: boolean;
}

const DEFAULT_METERS: MeterPrefs = { bars: METER_IDS, disk: "C:", details: true };

function parseMeters(raw: unknown): MeterPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { bars, disk, details } = raw as Record<string, unknown>;
  return {
    bars: Array.isArray(bars) ? METER_IDS.filter((id) => bars.includes(id)) : DEFAULT_METERS.bars,
    disk: typeof disk === "string" && /^[A-Z]:$/.test(disk) ? disk : DEFAULT_METERS.disk,
    details: typeof details === "boolean" ? details : DEFAULT_METERS.details,
  };
}

interface Reading {
  label: string;
  /** The progress bar's accessible name. */
  name: string;
  /** 0..1, null when the machine cannot tell. */
  value: number | null;
  detail: string;
  alert: boolean;
}

const share = (usage: Usage | null | undefined) => (usage && usage.total > 0 ? usage.used / usage.total : null);

function gigabytes(usage: Usage) {
  const format = (bytes: number) => (bytes / GB).toLocaleString("pt-BR", { maximumFractionDigits: usage.total >= 100 * GB ? 0 : 1 });
  return `${format(usage.used)} / ${format(usage.total)} GB`;
}

/** The drive the HDD bar shows: the chosen one, or the first when it is gone. */
const shownDisk = (disks: DiskUsage[], chosen: string) => disks.find((disk) => disk.name === chosen) ?? disks[0];

function read(id: MeterId, stats: SystemStats, disk: string): Reading {
  const busy = (value: number | null) => value !== null && value >= HIGH;
  switch (id) {
    case "cpu":
      return { label: "CPU", name: "Uso da CPU", value: stats.cpu, detail: `${navigator.hardwareConcurrency || "?"} núcleos`, alert: busy(stats.cpu) };
    case "gpu":
      return { label: "GPU", name: "Uso da GPU", value: stats.gpu, detail: stats.gpu === null ? "sem contadores" : "motor 3D", alert: busy(stats.gpu) };
    case "disk": {
      const drive = shownDisk(stats.disks, disk);
      const value = share(drive);
      return { label: `HDD ${drive?.name ?? ""}`.trim(), name: `Espaço usado em ${drive?.name ?? "disco"}`, value, detail: drive ? gigabytes(drive) : "nenhum disco", alert: busy(value) };
    }
    case "wlan": {
      const value = stats.wlan?.signal ?? null;
      return { label: "WLAN", name: "Sinal do Wi-Fi", value, detail: stats.wlan?.ssid || "desconectado", alert: value !== null && value <= WEAK_SIGNAL };
    }
    case "ram": {
      const value = share(stats.ram);
      return { label: "RAM", name: "Uso da RAM", value, detail: stats.ram ? gigabytes(stats.ram) : "indisponível", alert: busy(value) };
    }
    case "memory": {
      const value = share(stats.memory);
      return { label: "Memória", name: "Memória virtual em uso", value, detail: stats.memory ? `virtual · ${gigabytes(stats.memory)}` : "indisponível", alert: busy(value) };
    }
  }
}

/**
 * The system monitor, Rainmeter style: one thin bar per meter (CPU, GPU, HDD, WLAN, RAM,
 * virtual memory), its name underlined, a detail and the percentage. Right click (or the menu
 * key) picks the bars, the details and the HDD's drive.
 */
export function SystemMeters({ paused }: { paused: boolean }) {
  const status = useSystemStats(paused);
  const [prefs, setPrefs] = useStoredState("jarvis.meters", DEFAULT_METERS, parseMeters);
  const menu = useWidgetMenu();
  const disks = status.kind === "ready" ? status.stats.disks : [];
  const disk = shownDisk(disks, prefs.disk)?.name;

  const toggle = (id: MeterId) =>
    setPrefs((current) => {
      const bars = current.bars.includes(id) ? current.bars.filter((bar) => bar !== id) : [...current.bars, id];
      return { ...current, bars: METER_IDS.filter((meter) => bars.includes(meter)) };
    });
  const sections: MenuSection[] = [
    { title: "Barras", items: METERS.map((meter) => ({ kind: "check", label: meter.label, checked: prefs.bars.includes(meter.id), onSelect: () => toggle(meter.id) })) },
    { title: "Exibir", items: [{ kind: "check", label: "Detalhes", checked: prefs.details, onSelect: () => setPrefs((current) => ({ ...current, details: !current.details })) }] },
  ];
  if (disks.length > 1) {
    const items = disks.map((item) => ({
      kind: "radio" as const,
      label: item.name,
      checked: item.name === disk,
      detail: gigabytes(item),
      onSelect: () => setPrefs((current) => ({ ...current, disk: item.name })),
    }));
    sections.push({ title: "Disco do HDD", items });
  }

  return (
    <div
      tabIndex={0}
      onContextMenu={menu.open}
      className="h-full overflow-y-auto px-4 py-3 font-mono outline-none select-text focus-visible:ring-1 focus-visible:ring-hud-light/40 focus-visible:ring-inset"
    >
      {status.kind !== "ready" ? (
        <div className="flex h-full items-center text-[12px] text-hud-text/55">
          <span className="mr-2 text-hud-cyan">$</span>
          {status.kind === "loading" ? "Lendo o sistema…" : "Indisponível neste ambiente"}
        </div>
      ) : prefs.bars.length === 0 ? (
        <div className="flex h-full items-center text-[12px] text-hud-text/55">Nenhuma barra · botão direito para escolher</div>
      ) : (
        <div className="flex min-h-full flex-col justify-center gap-3">
          {prefs.bars.map((id) => (
            <MeterRow key={id} reading={read(id, status.stats, prefs.disk)} details={prefs.details} />
          ))}
        </div>
      )}
      <WidgetMenu menu={menu} label="Opções do widget Sistema" sections={sections} />
    </div>
  );
}

function MeterRow({ reading, details }: { reading: Reading; details: boolean }) {
  const percent = reading.value === null ? null : Math.round(reading.value * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="shrink-0 tracking-[0.16em] text-hud-text uppercase underline decoration-hud-text/40 underline-offset-4">{reading.label}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-hud-text/45">{details ? reading.detail : ""}</span>
        <span className={`shrink-0 tabular-nums ${reading.alert ? "text-hud-alert" : "text-hud-light"}`}>{percent === null ? "--" : `${percent}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-label={reading.name}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[3px] overflow-hidden bg-hud-text/12"
      >
        <div
          className={`h-full transition-[width] duration-700 ease-out ${
            reading.alert
              ? "bg-hud-alert shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-alert)_80%,transparent)]"
              : "bg-hud-light shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-holo)_80%,transparent)]"
          }`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}
