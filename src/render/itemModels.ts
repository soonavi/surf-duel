/**
 * The things you can hold (see game/heldItem.ts), built from three.js
 * primitives: no model files. Every model's origin is where the glove grips
 * it; it stands up along +Y, faces +Z (toward you), and a blade's edge points
 * along +X. Sizes are roughly metres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { HeldItemId } from '../game/heldItem.js';

type Builder = () => THREE.Group;

function standard(color: THREE.ColorRepresentation, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** Soft fabric: a sheen catches the light at the edges, like fuzz. */
function plush(color: THREE.ColorRepresentation, sheen: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.5 });
}

/** Shiny plastic or candy. */
function glossy(color: THREE.ColorRepresentation, roughness = 0.25): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 1, clearcoatRoughness: 0.15 });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

function sphere(r: number, material: THREE.Material, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1]): THREE.Mesh {
  const m = mesh(new THREE.SphereGeometry(r, 24, 16), material, x, y, z);
  m.scale.set(...scale);
  return m;
}

/** A flat outline (in X/Y) extruded to `depth` along Z, centred on Z, with softened edges. */
function slab(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** Colour a geometry's vertices along an axis (from `a0` to `a1`) through the given colours, for a blade finish. */
function paint(g: THREE.BufferGeometry, axis: 'x' | 'y', a0: number, a1: number, colors: THREE.ColorRepresentation[]): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const at = (i: number): number => (axis === 'x' ? pos.getX(i) : pos.getY(i));
  const out = new Float32Array(pos.count * 3);
  const stops = colors.map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (at(i) - a0) / (a1 - a0))) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    c.copy(stops[k]!).lerp(stops[k + 1]!, t - k);
    out.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Brushed steel coloured by the blade's vertex colours. */
function bladeMaterial(): THREE.MeshStandardMaterial {
  return standard(0xffffff, 0.38, 0.55, { vertexColors: true });
}

// ---------------------------------------------------------------------------
// Knives

function karambit(): THREE.Group {
  const g = new THREE.Group();
  // A claw: the spine bulges up and over, the edge is the inside of the curve.
  const blade = new THREE.Shape();
  blade.moveTo(-0.013, 0.058);
  blade.bezierCurveTo(-0.022, 0.12, 0.03, 0.185, 0.105, 0.112);
  blade.bezierCurveTo(0.06, 0.13, 0.02, 0.105, 0.013, 0.058);
  blade.lineTo(-0.013, 0.058);
  // The fade: gold at the base, through violet, to pink at the tip.
  g.add(mesh(paint(slab(blade, 0.003, 0.0018), 'x', -0.01, 0.1, ['#ffd25a', '#9b5cff', '#ff4fa3']), bladeMaterial()));

  const handle = new THREE.Shape();
  handle.moveTo(-0.015, 0.06);
  handle.quadraticCurveTo(-0.021, 0, -0.012, -0.058);
  handle.lineTo(0.015, -0.058);
  handle.quadraticCurveTo(0.008, 0, 0.015, 0.06);
  handle.lineTo(-0.015, 0.06);
  const grip = standard('#1b1f2a', 0.6);
  g.add(mesh(slab(handle, 0.02, 0.004), grip));
  // The finger ring at the end, and a steel bolster where the blade meets the handle.
  const ring = mesh(new THREE.TorusGeometry(0.021, 0.0065, 12, 32), standard('#c9ced6', 0.25, 0.9), 0, -0.083, 0);
  g.add(ring);
  g.add(mesh(new RoundedBoxGeometry(0.032, 0.01, 0.024, 2, 0.003), standard('#c9ced6', 0.25, 0.9), 0, 0.058, 0));
  return g;
}

function butterfly(): THREE.Group {
  const g = new THREE.Group();
  // Spear point.
  const blade = new THREE.Shape();
  blade.moveTo(-0.011, 0.062);
  blade.lineTo(-0.011, 0.15);
  blade.quadraticCurveTo(-0.008, 0.172, 0.001, 0.19);
  blade.quadraticCurveTo(0.01, 0.17, 0.011, 0.14);
  blade.lineTo(0.011, 0.062);
  blade.lineTo(-0.011, 0.062);
  // Doppler: deep blue, violet, black.
  g.add(mesh(paint(slab(blade, 0.003, 0.0016), 'y', 0.065, 0.19, ['#2b1b6e', '#7a3cff', '#1a0b2e', '#4f7dff']), bladeMaterial()));

  // Two skeleton handles sandwich the tang.
  const half = new THREE.Shape();
  half.moveTo(-0.012, -0.065);
  half.lineTo(0.012, -0.065);
  half.lineTo(0.012, 0.062);
  half.lineTo(-0.012, 0.062);
  half.lineTo(-0.012, -0.065);
  for (const y of [-0.045, -0.012, 0.021]) {
    const hole = new THREE.Path();
    hole.absellipse(0, y + 0.012, 0.0055, 0.013, 0, Math.PI * 2, false, 0);
    half.holes.push(hole);
  }
  const steel = standard('#9aa3b2', 0.3, 0.9);
  const handleGeo = slab(half, 0.004, 0.0012);
  g.add(mesh(handleGeo, steel, 0, 0, 0.0055), mesh(handleGeo.clone(), steel, 0, 0, -0.0055));
  // Pivot pins and the latch.
  const pin = new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 12).rotateX(Math.PI / 2);
  const brass = standard('#d6a646', 0.3, 0.9);
  g.add(mesh(pin, brass, -0.006, 0.055, 0), mesh(pin.clone(), brass, 0.006, 0.055, 0));
  g.add(mesh(new RoundedBoxGeometry(0.02, 0.012, 0.016, 2, 0.003), brass, 0, -0.07, 0));
  return g;
}

function bayonet(): THREE.Group {
  const g = new THREE.Group();
  // A long clip point with saw teeth along the spine.
  const blade = new THREE.Shape();
  blade.moveTo(0.015, 0.062);
  blade.lineTo(0.015, 0.2);
  blade.quadraticCurveTo(0.012, 0.225, -0.002, 0.245);
  blade.lineTo(-0.014, 0.205);
  blade.lineTo(-0.015, 0.175);
  for (let y = 0.17; y > 0.095; y -= 0.01) {
    blade.lineTo(-0.019, y - 0.004);
    blade.lineTo(-0.015, y - 0.01);
  }
  blade.lineTo(-0.015, 0.062);
  blade.lineTo(0.015, 0.062);
  // Tiger tooth: warm gold.
  g.add(mesh(paint(slab(blade, 0.0035, 0.0016), 'y', 0.06, 0.245, ['#b8741a', '#ffcf5a', '#e08a1e', '#ffe08a']), bladeMaterial()));

  const black = standard('#1d2026', 0.55);
  // Grooved rubber grip, then a guard with a muzzle ring.
  g.add(mesh(new THREE.CylinderGeometry(0.0155, 0.0165, 0.11, 20), black, 0, 0, 0));
  for (let y = -0.04; y <= 0.041; y += 0.016) g.add(mesh(new THREE.TorusGeometry(0.0163, 0.0022, 8, 24).rotateX(Math.PI / 2), black, 0, y, 0));
  const steel = standard('#59606d', 0.35, 0.85);
  g.add(mesh(new RoundedBoxGeometry(0.06, 0.012, 0.022, 2, 0.003), steel, -0.006, 0.058, 0));
  g.add(mesh(new THREE.TorusGeometry(0.011, 0.0035, 10, 24), steel, -0.04, 0.058, 0));
  g.add(mesh(new RoundedBoxGeometry(0.034, 0.016, 0.03, 2, 0.004), steel, 0, -0.062, 0));
  return g;
}

function bowie(): THREE.Group {
  const g = new THREE.Group();
  // Broad, with the classic clipped point.
  const blade = new THREE.Shape();
  blade.moveTo(0.022, 0.06);
  blade.lineTo(0.024, 0.16);
  blade.quadraticCurveTo(0.02, 0.2, 0.0, 0.222);
  blade.quadraticCurveTo(-0.008, 0.2, -0.018, 0.185);
  blade.lineTo(-0.02, 0.06);
  blade.lineTo(0.022, 0.06);
  // Crimson.
  g.add(mesh(paint(slab(blade, 0.004, 0.0018), 'y', 0.06, 0.222, ['#5a0b10', '#c8202c', '#7a0f18', '#e8424d']), bladeMaterial()));

  const brass = standard('#cfa04a', 0.3, 0.9);
  g.add(mesh(new THREE.CapsuleGeometry(0.009, 0.06, 6, 12).rotateZ(Math.PI / 2), brass, 0, 0.056, 0));
  // Wooden handle, brass pommel.
  const wood = standard('#6b3d1f', 0.6);
  const handle = mesh(new THREE.CapsuleGeometry(0.017, 0.08, 8, 16), wood, 0, -0.005, 0);
  handle.scale.set(1, 1, 0.75);
  g.add(handle);
  g.add(sphere(0.016, brass, 0, -0.06, 0, [1.1, 0.8, 0.9]));
  return g;
}

// ---------------------------------------------------------------------------
// Fun things

function teddy(): THREE.Group {
  const g = new THREE.Group();
  const fur = plush('#a8703f', '#f2c894');
  const light = plush('#e6c296', '#fff0d8');
  const dark = glossy('#1a1210', 0.2);
  g.add(sphere(0.07, fur, 0, 0.085, 0, [1, 1.12, 0.9]));
  g.add(sphere(0.04, light, 0, 0.075, 0.045, [1, 1.1, 0.5])); // belly
  g.add(sphere(0.058, fur, 0, 0.19, 0.01));
  for (const s of [-1, 1]) {
    g.add(sphere(0.022, fur, s * 0.043, 0.235, 0));
    g.add(sphere(0.013, light, s * 0.043, 0.235, 0.012, [1, 1, 0.5]));
    g.add(sphere(0.0075, dark, s * 0.021, 0.205, 0.059)); // eyes
    const arm = mesh(new THREE.CapsuleGeometry(0.019, 0.05, 6, 12), fur, s * 0.066, 0.1, 0.015);
    arm.rotation.z = s * 0.7;
    arm.rotation.x = -0.4;
    g.add(arm);
    g.add(sphere(0.026, fur, s * 0.04, 0.02, 0.03, [1, 0.8, 1.2])); // feet
    g.add(sphere(0.014, light, s * 0.04, 0.02, 0.058, [1, 1, 0.4])); // paw pads
  }
  g.add(sphere(0.025, light, 0, 0.176, 0.056, [1.1, 0.85, 0.8])); // muzzle
  g.add(sphere(0.009, dark, 0, 0.184, 0.076, [1.3, 1, 1])); // nose
  // A red bow tie.
  const red = plush('#d8243a', '#ff8a96');
  for (const s of [-1, 1]) {
    const wing = mesh(new THREE.ConeGeometry(0.014, 0.026, 12).rotateZ((s * Math.PI) / 2), red, -s * 0.014, 0.145, 0.05);
    g.add(wing);
  }
  g.add(sphere(0.007, red, 0, 0.145, 0.052));
  return g;
}

function shark(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.SphereGeometry(0.055, 32, 20);
  body.scale(2.3, 1, 1);
  // Blue on top, white underneath.
  const pos = body.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#5f8fbf');
  const belly = new THREE.Color('#f4f1ea');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(belly).lerp(top, Math.min(1, Math.max(0, (pos.getY(i) + 0.012) / 0.02)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const fabric = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#d6e8ff'), sheenRoughness: 0.5 });
  g.add(mesh(body, fabric, 0, 0.07, 0));

  const blue = plush('#5f8fbf', '#d6e8ff');
  const fin = (w: number, h: number): THREE.ExtrudeGeometry => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.quadraticCurveTo(-w / 4, h * 0.7, w / 3, h);
    s.quadraticCurveTo(w / 6, h * 0.4, w / 2, 0);
    s.lineTo(-w / 2, 0);
    return slab(s, 0.012, 0.005);
  };
  g.add(mesh(fin(0.06, 0.05), blue, 0.01, 0.118, 0)); // dorsal
  const tailUp = mesh(fin(0.05, 0.055), blue, 0.122, 0.075, 0);
  tailUp.rotation.z = -0.9;
  const tailDown = mesh(fin(0.04, 0.04), blue, 0.12, 0.068, 0);
  tailDown.rotation.z = -2.3;
  g.add(tailUp, tailDown);
  for (const s of [-1, 1]) {
    const side = mesh(fin(0.04, 0.045), blue, -0.02, 0.05, s * 0.045);
    side.rotation.set(s * 1.2, 0, -0.5);
    g.add(side);
  }
  const dark = glossy('#111', 0.2);
  g.add(sphere(0.0075, dark, -0.085, 0.08, 0.035), sphere(0.0075, dark, -0.085, 0.08, -0.035));
  // A little smile.
  const mouth = mesh(new THREE.TorusGeometry(0.02, 0.0028, 8, 20, Math.PI * 0.8), standard('#3a2430', 0.8), -0.095, 0.062, 0.022);
  mouth.rotation.set(0, -0.6, Math.PI * 1.1);
  g.add(mouth);
  return g;
}

function duck(): THREE.Group {
  const g = new THREE.Group();
  const yellow = glossy('#ffd21f');
  const orange = glossy('#ff8a1a');
  const dark = glossy('#111', 0.15);
  g.add(sphere(0.06, yellow, 0, 0.05, 0, [1.25, 0.82, 1]));
  g.add(sphere(0.043, yellow, -0.035, 0.115, 0));
  // Beak, eyes, wings, and a little upturned tail.
  g.add(sphere(0.022, orange, -0.08, 0.108, 0, [1.4, 0.5, 1]));
  for (const s of [-1, 1]) {
    g.add(sphere(0.0075, dark, -0.06, 0.13, s * 0.028));
    g.add(sphere(0.006, glossy('#fff', 0.1), -0.064, 0.133, s * 0.03, [0.6, 0.6, 0.6]));
    g.add(sphere(0.03, yellow, 0.012, 0.06, s * 0.05, [1.3, 0.7, 0.45]));
  }
  const tail = mesh(new THREE.ConeGeometry(0.022, 0.04, 16), yellow, 0.075, 0.085, 0);
  tail.rotation.z = -0.9;
  g.add(tail);
  return g;
}

/** A waffle pattern for the cone. */
function waffleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#d9a35f';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#a8692c';
    ctx.lineWidth = 7;
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

function icecream(): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.ConeGeometry(0.04, 0.14, 32, 1, true).rotateX(Math.PI);
  g.add(mesh(cone, standard('#ffffff', 0.8, 0, { map: waffleTexture(), side: THREE.DoubleSide }), 0, 0.03, 0));
  const strawberry = glossy('#ff8fb4', 0.45);
  const mint = glossy('#a8f0cf', 0.45);
  g.add(sphere(0.045, strawberry, 0, 0.11, 0));
  g.add(mesh(new THREE.TorusGeometry(0.039, 0.011, 10, 28).rotateX(Math.PI / 2), strawberry, 0, 0.098, 0));
  g.add(sphere(0.04, mint, 0, 0.172, 0));
  g.add(mesh(new THREE.TorusGeometry(0.034, 0.01, 10, 28).rotateX(Math.PI / 2), mint, 0, 0.16, 0));
  // Sprinkles over the top scoop, always in the same places.
  const colors = ['#ff4f6d', '#ffd23f', '#4fd1ff', '#ffffff', '#9b6bff'];
  let seed = 7;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sprinkle = new THREE.CapsuleGeometry(0.0022, 0.008, 3, 6);
  for (let i = 0; i < 28; i++) {
    const u = rand() * Math.PI * 2;
    const v = rand() * 1.1;
    const n = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    const s = mesh(sprinkle, glossy(colors[i % colors.length]!, 0.3), n.x * 0.04, 0.172 + n.y * 0.04, n.z * 0.04);
    s.lookAt(s.position.clone().add(n));
    s.rotateZ(rand() * Math.PI);
    s.rotateX(Math.PI / 2);
    g.add(s);
  }
  // A cherry on top.
  g.add(sphere(0.013, glossy('#d0102a', 0.15), 0, 0.222, 0));
  const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.232, 0), new THREE.Vector3(0.004, 0.25, 0), new THREE.Vector3(0.014, 0.258, 0)), 8, 0.0015, 6);
  g.add(mesh(stem, standard('#4a7a2a', 0.7)));
  return g;
}

function baguette(): THREE.Group {
  const g = new THREE.Group();
  const crust = standard('#cf9147', 0.75);
  const loaf = mesh(new THREE.CapsuleGeometry(0.028, 0.29, 10, 20), crust, 0, 0.12, 0);
  loaf.scale.set(1, 1, 0.82);
  g.add(loaf);
  // Pale slashes along the top.
  const crumb = standard('#f2dcae', 0.9);
  for (let i = 0; i < 4; i++) {
    const cut = mesh(new RoundedBoxGeometry(0.045, 0.01, 0.01, 2, 0.004), crumb, 0, 0.035 + i * 0.062, 0.022);
    cut.rotation.z = 0.6;
    g.add(cut);
  }
  return g;
}

const BUILDERS: Record<Exclude<HeldItemId, 'none'>, Builder> = {
  karambit,
  butterfly,
  bayonet,
  bowie,
  teddy,
  shark,
  duck,
  icecream,
  baguette,
};

/** The model for an item, or null for an empty hand. */
export function buildItem(id: HeldItemId): THREE.Group | null {
  if (id === 'none') return null;
  const g = BUILDERS[id]();
  g.name = `item:${id}`;
  return g;
}

/**
 * A gloved fist round the origin and the sleeve it comes out of (down and back
 * toward the corner of the view). The cuff takes the course's colour.
 */
export function buildHand(): { group: THREE.Group; cuff: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const glove = standard('#2a2e37', 0.7);
  const fist = mesh(new RoundedBoxGeometry(0.058, 0.07, 0.06, 3, 0.02), glove, 0.004, 0, 0.002);
  g.add(fist);
  // Knuckles in a row across the front of the fist, and a thumb wrapped over.
  for (let i = 0; i < 4; i++) g.add(sphere(0.0115, glove, -0.026, 0.024 - i * 0.016, 0.012, [0.9, 0.85, 1.1]));
  const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.03, 4, 10), glove, -0.016, 0.026, 0.026);
  thumb.rotation.set(0.3, 0, 1.2);
  g.add(thumb);
  const sleeve = standard('#323848', 0.85);
  const arm = mesh(new THREE.CylinderGeometry(0.034, 0.046, 0.34, 20), sleeve, 0.03, -0.19, 0.09);
  arm.rotation.set(-0.5, 0, 0.25);
  g.add(arm);
  const cuff = standard('#3ee6ff', 0.5, 0.1);
  const band = mesh(new THREE.CylinderGeometry(0.036, 0.037, 0.022, 20), cuff, 0.012, -0.045, 0.024);
  band.rotation.copy(arm.rotation);
  g.add(band);
  return { group: g, cuff };
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
