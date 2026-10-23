/** Mirrors `THEMES` in src-tauri/src/settings.rs. "custom" is the blue palette rotated to `accentHue`. */
export type Theme = "blue" | "green" | "yellow" | "custom";
export type Preset = Exclude<Theme, "custom">;

type Token = "void" | "abyss" | "panel" | "cyan" | "holo" | "light" | "line" | "glow" | "text";
export type Palette = Record<Token, string>;

const TOKENS: Token[] = ["void", "abyss", "panel", "cyan", "holo", "light", "line", "glow", "text"];

/** Palette tokens per theme — the blue one is also the CSS default in src/styles/globals.css. */
export const PALETTES: Record<Preset, Palette> = {
  blue: {
    void: "#000508",
    abyss: "#021017",
    panel: "#00080C",
    cyan: "#00CAFD",
    holo: "#00E5FF",
    light: "#76F3FF",
    line: "#087B94",
    glow: "#B5FAFF",
    text: "#A8DBE5",
  },
  green: {
    void: "#000502",
    abyss: "#021408",
    panel: "#000A03",
    cyan: "#00C238",
    holo: "#00E83E",
    light: "#6CFF94",
    line: "#07802A",
    glow: "#BDFFCC",
    text: "#A6E3B4",
  },
  yellow: {
    void: "#050400",
    abyss: "#171202",
    panel: "#0C0900",
    cyan: "#E6AE00",
    holo: "#FFC800",
    light: "#FFE066",
    line: "#8A6A06",
    glow: "#FFF2B3",
    text: "#E3D7A6",
  },
};

/** OKLCH hue (degrees) of the blue accent: the default custom hue. Mirrors `DEFAULT_HUE` in settings.rs. */
export const DEFAULT_HUE = 224;

// --- sRGB ⇄ OKLCH, so a custom hue keeps the presets' perceived lightness and chroma ---

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

interface Lch {
  l: number;
  c: number;
  h: number;
}

function hexToOklch(hex: string): Lch {
  const r = toLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = toLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = toLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}

function oklabToLinear(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Lowers the chroma (by bisection) just enough for the colour to fit in sRGB. */
function oklchToHex({ l, c, h }: Lch): string {
  const radians = (h * Math.PI) / 180;
  const at = (chroma: number) => oklabToLinear(l, chroma * Math.cos(radians), chroma * Math.sin(radians));
  // The presets sit on the gamut edge (a channel at exactly 0), so allow a hair of rounding error.
  const fits = (rgb: number[]) => rgb.every((v) => v > -0.002 && v < 1.002);
  let rgb = at(c);
  if (!fits(rgb)) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (fits(at(mid))) low = mid;
      else high = mid;
    }
    rgb = at(low);
  }
  return `#${rgb
    .map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255)
      .toString(16)
      .padStart(2, "0"))
    .join("")}`;
}

const BLUE_LCH = Object.fromEntries(TOKENS.map((token) => [token, hexToOklch(PALETTES.blue[token])])) as Record<Token, Lch>;
const customCache = new Map<number, Palette>();

/** The blue palette with every token rotated so the accent sits at `hue` (same lightness and chroma). */
export function paletteFromHue(hue: number): Palette {
  const key = ((Math.round(hue) % 360) + 360) % 360;
  const cached = customCache.get(key);
  if (cached) return cached;
  const palette = {} as Palette;
  for (const token of TOKENS) {
    const { l, c, h } = BLUE_LCH[token];
    palette[token] = oklchToHex({ l, c, h: key + (h - BLUE_LCH.cyan.h) });
  }
  customCache.set(key, palette);
  return palette;
}

export function paletteFor(theme: Theme, hue: number): Palette {
  return theme === "custom" ? paletteFromHue(hue) : (PALETTES[theme] ?? PALETTES.blue);
}

let current: Palette = PALETTES.blue;
const listeners = new Set<(palette: Palette) => void>();

/** The palette `applyTheme` last switched to. */
export function currentPalette() {
  return current;
}

/** Follows every theme switch (the 3D hologram's colours, which load with it). */
export function onPalette(listener: (palette: Palette) => void) {
  listeners.add(listener);
}

/** Switches the interface (the `--color-hud-*` variables) and the hologram to a theme. */
export function applyTheme(theme: Theme, hue = DEFAULT_HUE) {
  current = paletteFor(theme, hue);
  const style = document.documentElement.style;
  for (const [token, hex] of Object.entries(current)) style.setProperty(`--color-hud-${token}`, hex);
  for (const listener of listeners) listener(current);
}
