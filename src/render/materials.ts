import * as THREE from 'three';

export interface GridMaterialOptions {
  base: THREE.ColorRepresentation;
  line: THREE.ColorRepresentation;
  /** World units between minor grid lines; major lines every 4. */
  cell?: number;
  /** Line width in screen pixels (roughly). */
  lineWidth?: number;
}

/** Normalised direction the faux sun comes from. */
const LIGHT_DIR = new THREE.Vector3(0.35, 0.85, 0.4).normalize();

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uBase;
  uniform vec3 uLine;
  uniform vec3 uLightDir;
  uniform float uCell;
  uniform float uLineWidth;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  // Anti-aliased grid lines that fade out before they turn into moiré.
  float grid(vec2 p, float cell, float width) {
    vec2 coord = p / cell;
    vec2 d = fwidth(coord);
    vec2 g = abs(fract(coord - 0.5) - 0.5) / max(d, vec2(1e-5));
    float line = 1.0 - min(min(g.x, g.y) / width, 1.0);
    float fade = 1.0 - smoothstep(0.08, 0.35, max(d.x, d.y));
    return line * fade;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 an = abs(n);
    // Project the grid onto the plane the surface faces most.
    vec2 uv = (an.y >= an.x && an.y >= an.z) ? vWorldPos.xz : (an.x >= an.z ? vWorldPos.zy : vWorldPos.xy);
    float minor = grid(uv, uCell, uLineWidth);
    float major = grid(uv, uCell * 4.0, uLineWidth * 1.6);
    float light = 0.45 + 0.55 * max(dot(n, uLightDir), 0.0);
    vec3 col = uBase * light;
    col = mix(col, uLine, max(minor * 0.35, major * 0.85));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Flat-shaded surface with world-space grid lines, so speed is readable at a glance. */
export function createGridMaterial(opts: GridMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBase: { value: new THREE.Color(opts.base) },
        uLine: { value: new THREE.Color(opts.line) },
        uLightDir: { value: LIGHT_DIR.clone() },
        uCell: { value: opts.cell ?? 64 },
        uLineWidth: { value: opts.lineWidth ?? 1.2 },
      },
    ]),
    vertexShader,
    fragmentShader,
    fog: true,
  });
}

export interface SkyColors {
  zenith: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  nadir: THREE.ColorRepresentation;
}

/** Big inverted sphere with a vertical gradient. Follows the camera. */
export function createSky(radius: number, colors: SkyColors): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(colors.zenith) },
      uHorizon: { value: new THREE.Color(colors.horizon) },
      uNadir: { value: new THREE.Color(colors.nadir) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uNadir;
      varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;
        vec3 col = y > 0.0
          ? mix(uHorizon, uZenith, pow(y, 0.55))
          : mix(uHorizon, uNadir, pow(-y, 0.4));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
