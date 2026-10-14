/**
 * The things you can hold (see game/heldItem.ts), built from three.js
 * primitives: no model files. Every model's origin is where the glove grips
 * it; it stands up along +Y and faces +Z (toward you). Sizes are roughly
 * metres. The knives are in knives.ts, the glove in hand.ts.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { HeldItemId } from '../game/heldItem.js';
import { KNIVES } from './knives.js';
import { canvasTexture, glossy, mesh, plush, seeded, slab, sphere, standard } from './modelKit.js';

export { disposeModel } from './modelKit.js';

/** A built item, with the parts the hand's motion drives. */
export interface ItemModel {
  root: THREE.Group;
  /** Turned about its Z by the pose's spin (a karambit round its ring), if it spins in the hand. */
  spinner: THREE.Group | null;
  /** Works a butterfly knife's handles for the pose's flip (0 open, π shut). */
  flip: ((phase: number) => void) | null;
  /** How thick its grip is (the fingers wrap round it), and how open the hand stays holding it. */
  gripRadius: number;
  restOpen: number;
}

/** A model that just sits in the hand. */
function held(root: THREE.Group, gripRadius: number, restOpen: number): ItemModel {
  return { root, spinner: null, flip: null, gripRadius, restOpen };
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
  const t = canvasTexture(128, 128, (ctx) => {
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
  });
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
  const rand = seeded(7);
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

const BUILDERS: Record<Exclude<HeldItemId, 'none'>, () => ItemModel> = {
  ...KNIVES,
  // Soft and chunky things: the teddy by a leg, the shark round its belly, the rest round the base.
  teddy: () => held(teddy(), 0.036, 0.05),
  shark: () => held(shark(), 0.032, 0.08),
  duck: () => held(duck(), 0.032, 0.1),
  icecream: () => held(icecream(), 0.014, 0.03),
  baguette: () => held(baguette(), 0.028, 0.03),
};

/** The model for an item, or null for an empty hand. */
export function buildItem(id: HeldItemId): ItemModel | null {
  if (id === 'none') return null;
  const model = BUILDERS[id]();
  model.root.name = `item:${id}`;
  return model;
}
