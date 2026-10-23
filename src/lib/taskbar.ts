import { useStoredState } from "./storage";

/** Which modules the top bar shows (`jarvis.taskbar`); turning the bar itself on or off is a setting. */
export interface TaskbarModules {
  /** One icon per open window. */
  windows: boolean;
  voice: boolean;
  /** The focused window's name, in the middle. */
  title: boolean;
  pomodoro: boolean;
  /** What jv_T4p3 is playing. */
  music: boolean;
  battery: boolean;
  quality: boolean;
  /** Weekday, day and month before the time. */
  date: boolean;
  clock: boolean;
}

export const TASKBAR_MODULES: { key: keyof TaskbarModules; label: string; hint: string }[] = [
  { key: "windows", label: "Janelas abertas", hint: "Um ícone por janela aberta; o da janela em foco, aceso" },
  { key: "voice", label: "Status da voz", hint: "O microfone, aceso quando escuta; clicar liga ou desliga" },
  { key: "title", label: "Título da janela", hint: "O nome da janela em foco, no meio da barra" },
  { key: "pomodoro", label: "Pomodoro", hint: "Tempo restante quando há uma fase em andamento" },
  { key: "music", label: "Música", hint: "A música que o jv_T4p3 toca; clicar pausa ou retoma" },
  { key: "battery", label: "Bateria", hint: "Carga e se está na tomada" },
  { key: "quality", label: "Qualidade gráfica", hint: "Perfil atual; clicar alterna" },
  { key: "date", label: "Data", hint: "Dia da semana, dia e mês antes da hora" },
  { key: "clock", label: "Hora", hint: "Clicar abre o widget Relógio" },
];

/** Minimal by default: what is happening now (open windows, timer, music, battery, the time). */
const DEFAULT_MODULES: TaskbarModules = {
  windows: true,
  voice: true,
  title: true,
  pomodoro: true,
  music: true,
  battery: true,
  quality: false,
  date: false,
  clock: true,
};

function parseModules(raw: unknown): TaskbarModules | null {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as Partial<Record<keyof TaskbarModules, unknown>>;
  const modules = { ...DEFAULT_MODULES };
  for (const key of Object.keys(DEFAULT_MODULES) as (keyof TaskbarModules)[]) {
    if (typeof stored[key] === "boolean") modules[key] = stored[key] as boolean;
  }
  return modules;
}

export function useTaskbarModules() {
  const [modules, setModules] = useStoredState("jarvis.taskbar", DEFAULT_MODULES, parseModules);
  return [modules, setModules] as const;
}
