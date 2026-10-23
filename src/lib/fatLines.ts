import { AdditiveBlending } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

/**
 * Same depth cue as HoloLineMaterial: the half of the stroke behind the core centre
 * (in view space) is dimmed. Injected into three's LineMaterial shader.
 */
function injectBackFade(material: LineMaterial, backFade: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.holoBackFade = { value: backFade };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float holoBackFade;\nvarying float vHoloBack;")
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        vec3 holoCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float holoFacing = normalize(mvPosition.xyz - holoCenter).z;
        vHoloBack = mix(1.0 - holoBackFade, 1.0, smoothstep(-0.75, 0.45, holoFacing));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHoloBack;")
      .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb *= vHoloBack;\n#include <tonemapping_fragment>");
  };
  material.customProgramCacheKey = () => `holo-back-fade-${backFade}`;
}

/**
 * Screen-space wide lines (WebGL ignores `linewidth` on native lines).
 * Intensity is baked into the vertex RGB as grey — black is invisible under additive blending —
 * and the hue is the material color, which callers set every frame from the theme.
 */
export function createFatLines(positions: Float32Array, colors: Float32Array, width: number, backFade = 0.6) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);

  const material = new LineMaterial({
    vertexColors: true,
    linewidth: width,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    // Scene fog is black: under additive blending it further dims distant segments.
    fog: true,
  });
  if (backFade > 0) injectBackFade(material, backFade);

  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  return lines;
}
