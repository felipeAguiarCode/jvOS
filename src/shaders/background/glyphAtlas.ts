import { CanvasTexture } from "three";

export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 8;
/** Narrow cells, like the rain's 14 × 18 px cells. */
const CELL_WIDTH = 48;
const CELL_HEIGHT = 64;

/** Half-width katakana, digits and a few symbols: 64 glyphs, one per atlas cell. */
const GLYPHS = "ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:=*+-<>";

/** Glyph sheet for the Matrix backdrop: white on black, mirrored like the film's rain. */
export function createGlyphAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * CELL_WIDTH;
  canvas.height = ATLAS_ROWS * CELL_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.font = `${Math.round(CELL_HEIGHT * 0.72)}px "MS Gothic", "Yu Gothic", "Meiryo", monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  Array.from(GLYPHS)
    .slice(0, ATLAS_COLUMNS * ATLAS_ROWS)
    .forEach((glyph, index) => {
      context.save();
      context.translate(((index % ATLAS_COLUMNS) + 0.5) * CELL_WIDTH, (Math.floor(index / ATLAS_COLUMNS) + 0.5) * CELL_HEIGHT);
      context.scale(-1, 1);
      context.fillText(glyph, 0, 0);
      context.restore();
    });

  return new CanvasTexture(canvas);
}
