import { Color } from "three";
import { currentPalette, onPalette } from "./theme";

const palette = currentPalette();

/**
 * Linear-space colors for the 3D hologram's shaders (THREE.Color converts sRGB hex). Materials
 * hold these instances by reference, so a theme switch recolours the whole hologram in place.
 * Apart from theme.ts so that three.js only loads with the 3D core.
 */
export const colors = {
  void: new Color(palette.void),
  cyan: new Color(palette.cyan),
  holo: new Color(palette.holo),
  light: new Color(palette.light),
  line: new Color(palette.line),
  glow: new Color(palette.glow),
  abyss: new Color(palette.abyss),
};

onPalette((next) => {
  for (const [token, color] of Object.entries(colors)) color.set(next[token as keyof typeof colors]);
});
