/** Pixels kept clear at the bottom for the dock. */
export const DOCK_RESERVE = 120;
/** World-space diameter spanned by the outermost HUD arcs. */
export const COMPOSITION_DIAMETER = 6.3;
/** Share of the usable height (viewport minus dock) taken by the composition. */
const HEIGHT_FRACTION = 0.54;
/** Narrow windows are limited by width instead. */
const WIDTH_FRACTION = 0.62;
const MIN_USABLE = 240;

/** Diameter of the composition in CSS pixels; the core is centred in the area above the dock. */
export function compositionPixels(width: number, height: number) {
  return Math.min(Math.max(MIN_USABLE, height - DOCK_RESERVE) * HEIGHT_FRACTION, width * WIDTH_FRACTION);
}

/** The same diameter and core centre as CSS lengths, for DOM overlays placed on the hologram. */
export const COMPOSITION_CSS = `min(max(${MIN_USABLE}px, 100vh - ${DOCK_RESERVE}px) * ${HEIGHT_FRACTION}, ${WIDTH_FRACTION * 100}vw)`;
export const CORE_CENTER_Y_CSS = `calc((100vh - ${DOCK_RESERVE}px) / 2)`;
