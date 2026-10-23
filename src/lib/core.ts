import { useStoredState } from "./storage";

/**
 * How the core at the centre of the screen is drawn: the WebGL hologram, light vector rings,
 * or nothing at all. Set in the advanced menu, to trade the look for memory.
 */
export type CoreMode = "3d" | "2d" | "off";

export interface CorePrefs {
  mode: CoreMode;
}

const DEFAULT_CORE: CorePrefs = { mode: "3d" };

export const CORE_MODES: { value: CoreMode; label: string; hint: string }[] = [
  {
    value: "3d",
    label: "Holograma 3D",
    hint: "O holograma completo, desenhado pela placa de vídeo (WebGL, bloom, partículas). É o que mais usa memória.",
  },
  {
    value: "2d",
    label: "Anéis 2D",
    hint: "Os anéis do holograma em vetor, girando e reagindo à voz, sem WebGL: bem menos memória e processamento.",
  },
  {
    value: "off",
    label: "Desligado",
    hint: "Nada no centro da tela, nem a captura de áudio do visual: o mínimo de memória. A voz continua funcionando.",
  },
];
const MODES = CORE_MODES.map((mode) => mode.value);

function parseCore(raw: unknown): CorePrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode } = raw as Record<string, unknown>;
  return { mode: MODES.includes(mode as CoreMode) ? (mode as CoreMode) : DEFAULT_CORE.mode };
}

/** Stored in `jarvis.core`. */
export function useCorePrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.core", DEFAULT_CORE, parseCore);
  return [prefs, setPrefs] as const;
}
