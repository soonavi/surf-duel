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

/**
 * One cross-section of a loft: its centre, which way is across it and which
 * way is up through it, and its half-sizes (up and down can differ, so a
 * palm can be domed on the back and flatter underneath).
 */
export interface LoftRing {
  at: THREE.Vector3;
  across: THREE.Vector3;
  up: THREE.Vector3;
  width: number;
  top: number;
  bottom: number;
}

/** Catmull–Rom through four values. */
function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t2 * t);
}

/**
 * A smooth tube through `rings` (a curve through their centres, sizes eased
 * between them), with rounded caps `caps[0]` and `caps[1]` long at its ends
 * (0 leaves an end open). Cross-sections are superellipses: `squareness` 2 is
 * an ellipse, more is squarer. UVs run round it (u) and along it (v).
 */
export function loft(rings: LoftRing[], opts: { caps?: [number, number]; around?: number; steps?: number; squareness?: number } = {}): THREE.BufferGeometry {
  const around = opts.around ?? 24;
  const steps = opts.steps ?? 6;
  const exponent = 2 / (opts.squareness ?? 2.2);
  const [capStart, capEnd] = opts.caps ?? [0, 0];
  const n = rings.length;
  const ring = (i: number) => rings[Math.max(0, Math.min(n - 1, i))]!;
  const vec = (i: number, k: 'at' | 'across' | 'up', t: number, out: THREE.Vector3) =>
    out.set(
      catmull(ring(i - 1)[k].x, ring(i)[k].x, ring(i + 1)[k].x, ring(i + 2)[k].x, t),
      catmull(ring(i - 1)[k].y, ring(i)[k].y, ring(i + 1)[k].y, ring(i + 2)[k].y, t),
      catmull(ring(i - 1)[k].z, ring(i)[k].z, ring(i + 1)[k].z, ring(i + 2)[k].z, t),
    );
  const num = (i: number, k: 'width' | 'top' | 'bottom', t: number) => catmull(ring(i - 1)[k], ring(i)[k], ring(i + 1)[k], ring(i + 2)[k], t);

  // The sections along it: eased between the rings, then shrinking round each cap.
  type Row = { at: THREE.Vector3; across: THREE.Vector3; up: THREE.Vector3; width: number; top: number; bottom: number };
  const rows: Row[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < steps || (i === n - 2 && s === steps); s++) {
      const t = s / steps;
      const up = vec(i, 'up', t, new THREE.Vector3()).normalize();
      const across = vec(i, 'across', t, new THREE.Vector3());
      across.addScaledVector(up, -across.dot(up)).normalize();
      rows.push({ at: vec(i, 'at', t, new THREE.Vector3()), across, up, width: num(i, 'width', t), top: num(i, 'top', t), bottom: num(i, 'bottom', t) });
    }
  }
  const capRows = (end: Row, next: Row, length: number): Row[] => {
    if (length <= 0) return [];
    const out = end.at.clone().sub(next.at).normalize();
    const caps: Row[] = [];
    for (let j = 1; j <= 5; j++) {
      const b = (j / 5) * (Math.PI / 2);
      const c = j === 5 ? 0 : Math.cos(b);
      caps.push({ ...end, at: end.at.clone().addScaledVector(out, Math.sin(b) * length), width: end.width * c, top: end.top * c, bottom: end.bottom * c });
    }
    return caps;
  };
  const all = [...capRows(rows[0]!, rows[1]!, capStart).reverse(), ...rows, ...capRows(rows[rows.length - 1]!, rows[rows.length - 2]!, capEnd)];

  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  // Wind the faces outward whichever way round the rings' axes are.
  const along = rows[rows.length - 1]!.at.clone().sub(rows[0]!.at);
  const flip = p.crossVectors(rows[0]!.across, rows[0]!.up).dot(along) > 0;
  all.forEach((r, row) => {
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = r.width * Math.sign(c) * Math.abs(c) ** exponent;
      const y = (s >= 0 ? r.top : r.bottom) * Math.sign(s) * Math.abs(s) ** exponent;
      p.copy(r.at).addScaledVector(r.across, x).addScaledVector(r.up, y);
      pos.push(p.x, p.y, p.z);
      uv.push(k / around, row / (all.length - 1));
      if (row > 0 && k > 0) {
        const a0 = (row - 1) * (around + 1) + k - 1;
        const b0 = row * (around + 1) + k - 1;
        if (flip) index.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
        else index.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Smooth across the seam where each ring closes, and point the caps' tips straight out.
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  const m = new THREE.Vector3();
  for (let row = 0; row < all.length; row++) {
    const first = row * (around + 1);
    const last = first + around;
    m.fromBufferAttribute(normals, first).add(p.fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, m.x, m.y, m.z);
    normals.setXYZ(last, m.x, m.y, m.z);
  }
  const tip = (row: number, from: number) => {
    m.copy(all[row]!.at).sub(all[from]!.at).normalize();
    for (let k = 0; k <= around; k++) normals.setXYZ(row * (around + 1) + k, m.x, m.y, m.z);
  };
  if (capStart > 0) tip(0, 1);
  if (capEnd > 0) tip(all.length - 1, all.length - 2);
  return geo;
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
