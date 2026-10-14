/**
 * Small helpers for the held items' models (render/itemModels.ts, knives.ts,
 * hand.ts): materials, primitives, and a blade builder. Sizes are roughly metres.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function standard(color: THREE.ColorRepresentation, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** Soft fabric: a sheen catches the light at the edges, like fuzz. */
export function plush(color: THREE.ColorRepresentation, sheen: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.5 });
}

/** Shiny plastic or candy. */
export function glossy(color: THREE.ColorRepresentation, roughness = 0.25): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 1, clearcoatRoughness: 0.15 });
}

export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

export function sphere(r: number, material: THREE.Material, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1]): THREE.Mesh {
  const m = mesh(new THREE.SphereGeometry(r, 24, 16), material, x, y, z);
  m.scale.set(...scale);
  return m;
}

/** A flat outline (in X/Y) extruded to `depth` along Z, centred on Z, with softened edges. */
export function slab(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** A cylinder whose axis runs along Z (a pin through a blade or a handle). */
export function pin(radius: number, length: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius, radius, length, 14).rotateX(Math.PI / 2) as THREE.CylinderGeometry;
}

/** A point on a cubic Bézier in 2D. */
export function bezier(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/**
 * A blade, from its outline: the spine and the cutting edge as functions of
 * t (0 at the heel, 1 at the tip, where they meet). Its cross-section is a
 * real knife's: flat sides from the spine, then a grind down to a sharp edge.
 * UVs run along the blade (u, heel to tip) and across it (v, spine to edge),
 * for a finish texture. Groups: 0 the flats and spine, 1 the grind.
 */
export function bladeGeometry(
  spine: (t: number) => [number, number],
  edge: (t: number) => [number, number],
  opts: { thickness: number; samples?: number; grind?: number },
): THREE.BufferGeometry {
  const n = opts.samples ?? 48;
  const grind = opts.grind ?? 0.42;
  const rows: { s: [number, number]; g: [number, number]; e: [number, number]; th: number; t: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = spine(t);
    const e = edge(t);
    const g: [number, number] = [s[0] + (e[0] - s[0]) * (1 - grind), s[1] + (e[1] - s[1]) * (1 - grind)];
    // Full thickness most of the way, thinning to nothing at the point.
    const th = opts.thickness * Math.min(1, (1 - t) * 5);
    rows.push({ s, g, e, th, t });
  }

  /** One smooth strip between two lines of the cross-section (each a function of the row). */
  const strip = (
    a: (r: (typeof rows)[number]) => [number, number, number],
    b: (r: (typeof rows)[number]) => [number, number, number],
    va: number,
    vb: number,
  ): THREE.BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    rows.forEach((r, i) => {
      pos.push(...a(r), ...b(r));
      uv.push(r.t, va, r.t, vb);
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  };
  const v = 1 - grind;
  const flats = [
    strip((r) => [r.s[0], r.s[1], r.th / 2], (r) => [r.g[0], r.g[1], r.th / 2], 0, v),
    strip((r) => [r.g[0], r.g[1], -r.th / 2], (r) => [r.s[0], r.s[1], -r.th / 2], v, 0),
    strip((r) => [r.s[0], r.s[1], -r.th / 2], (r) => [r.s[0], r.s[1], r.th / 2], 0, 0),
  ];
  const grinds = [
    strip((r) => [r.g[0], r.g[1], r.th / 2], (r) => [r.e[0], r.e[1], 0], v, 1),
    strip((r) => [r.e[0], r.e[1], 0], (r) => [r.g[0], r.g[1], -r.th / 2], 1, v),
  ];
  // Close the heel (it's usually hidden in a handle or guard, but a spin shows it).
  const h = rows[0]!;
  const heel = new THREE.BufferGeometry();
  heel.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([...[h.s[0], h.s[1], h.th / 2], ...[h.g[0], h.g[1], h.th / 2], ...[h.e[0], h.e[1], 0], ...[h.g[0], h.g[1], -h.th / 2], ...[h.s[0], h.s[1], -h.th / 2]], 3),
  );
  heel.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, v, 0, 1, 0, v, 0, 0], 2));
  heel.setIndex([0, 2, 1, 0, 4, 2, 4, 3, 2]);
  heel.computeVertexNormals();
  const merged = mergeGeometries([mergeGeometries([...flats, heel]), mergeGeometries(grinds)], true);
  return merged;
}

/** A canvas texture `w`×`h`, drawn by `draw`, in sRGB. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A tiny repeatable random sequence, so a model looks the same every time it's built. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Free a model's GPU resources (geometries, materials, textures). */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
      m.dispose();
    }
  });
}
