import { AdditiveBlending, ShaderMaterial, type Texture } from "three";
import { colors } from "../../lib/sceneColors";
import { sharedUniforms } from "../hologram/sharedUniforms";
import { backdropVertexShader, createScreenUniforms } from "./backdrop";
import { ATLAS_COLUMNS, ATLAS_ROWS } from "./glyphAtlas";

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uVoice;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform vec3 uHeadColor;

  const float COLUMNS = ${ATLAS_COLUMNS.toFixed(1)};
  const float ROWS = ${ATLAS_ROWS.toFixed(1)};
  /** Cell size in CSS pixels. */
  const vec2 CELL = vec2(14.0, 18.0);

  float hash(vec2 p) {
    vec3 q = fract(p.xyx * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  /** One stream falling down a column: x = trail brightness (1 at the head), y = 1 on the head cell. */
  vec2 stream(float column, float row, float rows, float seed) {
    float speed = mix(4.0, 13.0, hash(vec2(column, seed)));
    float trail = mix(7.0, 26.0, hash(vec2(column, seed + 1.0)));
    // Visible rows, the trail leaving the screen, then a random pause.
    float period = rows + trail + rows * hash(vec2(column, seed + 2.0));
    float head = floor(mod(uTime * speed + period * hash(vec2(column, seed + 3.0)), period));
    float behind = head - row;
    if (behind < 0.0 || behind >= trail) return vec2(0.0);
    return vec2(pow(1.0 - behind / trail, 1.6), step(behind, 0.5));
  }

  void main() {
    // Row 0 at the top of the screen: the rain falls downward.
    vec2 cellPos = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / (CELL * uPixelRatio);
    vec2 cell = floor(cellPos);
    vec2 local = cellPos - cell;
    float rows = ceil(uResolution.y / (CELL.y * uPixelRatio));

    vec2 first = stream(cell.x, cell.y, rows, 0.0);
    vec2 second = stream(cell.x, cell.y, rows, 17.0) * vec2(0.6, 1.0);
    float trail = max(first.x, second.x);
    float head = max(first.y, second.y);

    // Each cell swaps its glyph at its own pace.
    float swaps = floor(uTime * mix(0.3, 2.5, hash(cell + 0.37)) + hash(cell) * 8.0);
    float glyph = floor(hash(cell + swaps * 1.618) * COLUMNS * ROWS);
    vec2 atlasCell = vec2(mod(glyph, COLUMNS), floor(glyph / COLUMNS));
    // The canvas is flipped on upload: its top row is at v = 1.
    vec2 uv = vec2((atlasCell.x + local.x) / COLUMNS, 1.0 - (atlasCell.y + local.y) / ROWS);
    // Derivatives of the continuous coordinates, so the mip level doesn't jump where cells meet.
    vec2 flow = vec2(cellPos.x / COLUMNS, -cellPos.y / ROWS);
    float ink = textureGrad(uAtlas, uv, dFdx(flow), dFdy(flow)).r;

    // The rain thins out behind the hologram.
    float core = mix(0.3, 1.0, smoothstep(0.2, 0.7, length((gl_FragCoord.xy - uCenter) / uScale)));
    vec3 body = mix(uColor, uHotColor, trail * trail) * trail * 0.5 * (1.0 + uVoice * 0.5);
    vec3 color = mix(body, uHeadColor * 0.6, head) * ink * core;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** "Matrix": columns of glyphs raining down in the theme color. */
export function createMatrixMaterial(atlas: Texture) {
  return new ShaderMaterial({
    uniforms: {
      ...createScreenUniforms(),
      uTime: sharedUniforms.uTime,
      uVoice: sharedUniforms.uVoice,
      uAtlas: { value: atlas },
      uColor: { value: colors.line },
      uHotColor: { value: colors.holo },
      uHeadColor: { value: colors.glow },
    },
    vertexShader: backdropVertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
