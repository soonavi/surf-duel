/**
 * The knives, CS style: blades with a real grind and a painted finish (fade,
 * doppler, tiger tooth, crimson web), handles with their own detail. The
 * karambit spins round its ring and the butterfly knife's handles swing on
 * their pins (see `ItemModel` in itemModels.ts).
 *
 * Frame: the grip is the origin, the blade points up +Y with its edge toward
 * +X and its flats facing ±Z. Sizes are roughly metres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bezier, bladeGeometry, canvasTexture, mesh, pin, seeded, slab, sphere, standard } from './modelKit.js';
import type { ItemModel } from './itemModels.js';

const W = 512;
const H = 128;

/** Brushed lines along the blade, over whatever finish is underneath. */
function brush(ctx: CanvasRenderingContext2D, rand: () => number, alpha: number): void {
  for (let i = 0; i < 90; i++) {
    const y = rand() * H;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * rand()})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rand() * W * 0.3, y);
    ctx.lineTo(W * (0.6 + rand() * 0.4), y + (rand() - 0.5) * 2);
    ctx.stroke();
  }
}

/** Fade: gold at the heel, through pink, to violet at the tip. */
function fade(): THREE.Texture {
  return canvasTexture(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#f2c14a');
    g.addColorStop(0.3, '#ff7a9c');
    g.addColorStop(0.62, '#d44cff');
    g.addColorStop(1, '#6e57ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    brush(ctx, seeded(3), 0.12);
  });
}

/** Doppler: a dark, swirling galaxy of violets and blues. */
function doppler(): THREE.Texture {
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#0e0822';
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(11);
    const colors = ['#5a2cff', '#b04cff', '#2a6bff', '#ff4fd8', '#1b0d3d'];
    for (let i = 0; i < 70; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = 10 + rand() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, colors[i % colors.length]!);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.5})`;
      ctx.fillRect(rand() * W, rand() * H, 1.5, 1.5);
    }
  });
}

/** Tiger tooth: gold with wavy amber stripes across the blade. */
function tigerTooth(): THREE.Texture {
  return canvasTexture(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d98a1c');
    g.addColorStop(0.5, '#ffcf5a');
    g.addColorStop(1, '#ffe39a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(5);
    ctx.strokeStyle = 'rgba(176, 82, 8, 0.75)';
    for (let x = 6; x < W; x += 16 + rand() * 10) {
      ctx.lineWidth = 3 + rand() * 4;
      ctx.beginPath();
      for (let y = 0; y <= H; y += 8) {
        const px = x + Math.sin(y * 0.08 + x) * 5;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    brush(ctx, rand, 0.15);
  });
}

/** Crimson web: deep red, a black spider web over it, and a fuller groove along the spine. */
function crimsonWeb(): THREE.Texture {
  return canvasTexture(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#5c0a12');
    g.addColorStop(0.45, '#b3172a');
    g.addColorStop(1, '#d42a3c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const cx = W * 0.58;
    const cy = H * 0.55;
    const spokes = 14;
    ctx.strokeStyle = 'rgba(14, 2, 4, 0.9)';
    ctx.lineWidth = 2;
    const ends: [number, number][] = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ends.push([Math.cos(a), Math.sin(a)]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * W, cy + Math.sin(a) * W * 0.5);
      ctx.stroke();
    }
    for (let ring = 1; ring <= 8; ring++) {
      const r = ring * 34;
      ctx.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const [x0, y0] = ends[i % spokes]!;
        const [x1, y1] = ends[(i + 1) % spokes]!;
        const ax = cx + x0 * r;
        const ay = cy + y0 * r * 0.5;
        const bx = cx + x1 * r;
        const by = cy + y1 * r * 0.5;
        const mx = cx + ((x0 + x1) / 2) * r * 0.86;
        const my = cy + ((y0 + y1) / 2) * r * 0.43;
        if (i === 0) ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx, my, bx, by);
      }
      ctx.stroke();
    }
    // The fuller: a groove along the blade near the spine, shadowed above and lit below.
    ctx.fillStyle = 'rgba(20, 0, 4, 0.75)';
    ctx.fillRect(0, H * 0.2, W * 0.72, 6);
    ctx.fillStyle = 'rgba(255, 170, 170, 0.35)';
    ctx.fillRect(0, H * 0.2 + 6, W * 0.72, 2);
  });
}

/** A blade mesh: the finish on its flats, and the grind a touch brighter and smoother, like a honed edge. */
function blade(geometry: THREE.BufferGeometry, finish: THREE.Texture): THREE.Mesh {
  const flats = standard(0xffffff, 0.34, 0.6, { map: finish, side: THREE.DoubleSide });
  const grind = standard(0xffffff, 0.16, 0.85, { map: finish, side: THREE.DoubleSide, emissive: new THREE.Color(0x222222) });
  return mesh(geometry, [flats, grind]);
}

const steel = (): THREE.MeshStandardMaterial => standard('#c3c9d2', 0.24, 0.92);
const darkSteel = (): THREE.MeshStandardMaterial => standard('#4d535e', 0.32, 0.88);

/** Three rivets through a handle at these heights. */
function rivets(ys: number[], length: number, material: THREE.Material): THREE.Mesh[] {
  return ys.map((y) => mesh(pin(0.0028, length), material, 0, y, 0));
}

function karambit(): ItemModel {
  const root = new THREE.Group();
  const RING_Y = -0.083;
  // It twirls in the open hand, round the middle of its grip (round the ring, below the fist, the spin was out of sight).
  const spinner = new THREE.Group();
  root.add(spinner);
  const parts = spinner;

  // A claw: the spine sweeps up and over, the edge is the inside of the curve.
  const geo = bladeGeometry(
    (t) => bezier([-0.013, 0.058], [-0.024, 0.12], [0.03, 0.188], [0.106, 0.112], t),
    (t) => bezier([0.013, 0.058], [0.012, 0.11], [0.05, 0.15], [0.106, 0.112], t),
    { thickness: 0.0034 },
  );
  parts.add(blade(geo, fade()));

  // Handle: finger grooves along the front, G10 scales over a steel liner, three rivets.
  const handle = new THREE.Shape();
  handle.moveTo(-0.015, 0.06);
  handle.lineTo(-0.016, 0.02);
  handle.quadraticCurveTo(-0.021, -0.02, -0.013, -0.06);
  handle.lineTo(0.012, -0.062);
  handle.quadraticCurveTo(0.021, -0.046, 0.012, -0.032);
  handle.quadraticCurveTo(0.021, -0.018, 0.012, -0.005);
  handle.quadraticCurveTo(0.021, 0.008, 0.012, 0.021);
  handle.lineTo(0.015, 0.06);
  handle.lineTo(-0.015, 0.06);
  const liner = mesh(slab(handle, 0.008, 0.0015), steel());
  liner.scale.set(1.07, 1.03, 1);
  const scales = mesh(slab(handle, 0.019, 0.003), standard('#1d2a24', 0.55, 0.05));
  parts.add(liner, scales, ...rivets([0.04, 0, -0.04], 0.0235, steel()));
  parts.add(mesh(new THREE.TorusGeometry(0.021, 0.0065, 14, 36), steel(), 0, RING_Y, 0));
  parts.add(mesh(new RoundedBoxGeometry(0.031, 0.01, 0.024, 2, 0.003), steel(), 0, 0.058, 0));
  return { root, spinner, flip: null, gripRadius: 0.018, restOpen: 0 };
}

function butterfly(): ItemModel {
  const root = new THREE.Group();
  const PIVOT_Y = 0.058;
  const SIDE = 0.0043;

  /** A skeletonised handle, hanging down from its pin at the origin. */
  const handleShape = (): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-0.012, -0.122);
    s.lineTo(0.012, -0.122);
    s.lineTo(0.012, -0.004);
    s.quadraticCurveTo(0.012, 0.004, 0.004, 0.004);
    s.lineTo(-0.004, 0.004);
    s.quadraticCurveTo(-0.012, 0.004, -0.012, -0.004);
    s.lineTo(-0.012, -0.122);
    for (const y of [-0.102, -0.07, -0.038]) {
      const hole = new THREE.Path();
      hole.absellipse(0, y, 0.0055, 0.0125, 0, Math.PI * 2, false, 0);
      s.holes.push(hole);
    }
    return s;
  };
  const handleMaterial = standard('#a9b2c0', 0.28, 0.9);
  const brass = standard('#d6a646', 0.3, 0.9);

  // The handle in your hand.
  const safe = mesh(slab(handleShape(), 0.0045, 0.0012), handleMaterial, 0, PIVOT_Y, SIDE);
  root.add(safe);

  // The blade turns on its pin at the top of that handle; the other handle turns on the blade.
  const bladeNode = new THREE.Group();
  bladeNode.position.set(0, PIVOT_Y, 0);
  root.add(bladeNode);
  const geo = bladeGeometry(
    (t) => bezier([-0.011, 0.004], [-0.011, 0.07], [-0.01, 0.11], [0.0, 0.136], t),
    (t) => bezier([0.011, 0.004], [0.011, 0.065], [0.01, 0.105], [0.0, 0.136], t),
    { thickness: 0.003 },
  );
  bladeNode.add(blade(geo, doppler()));
  bladeNode.add(mesh(new RoundedBoxGeometry(0.024, 0.016, 0.0032, 2, 0.002), darkSteel(), 0, 0, 0));
  bladeNode.add(mesh(pin(0.0032, 0.016), brass, 0, 0, 0));

  const bite = new THREE.Group();
  bladeNode.add(bite);
  bite.add(mesh(slab(handleShape(), 0.0045, 0.0012), handleMaterial, 0, 0, -SIDE));
  // The latch at its far end.
  bite.add(mesh(new RoundedBoxGeometry(0.018, 0.01, 0.014, 2, 0.003), brass, 0, -0.124, 0));

  const flip = (phase: number): void => {
    // Shut at π: the blade folds down between the handles; the free handle swings twice as fast.
    bladeNode.rotation.z = -phase;
    bite.rotation.z = -phase;
  };
  flip(0);
  return { root, spinner: null, flip, gripRadius: 0.014, restOpen: 0 };
}

function bayonet(): ItemModel {
  const root = new THREE.Group();
  // An M9: a long clip point, with saw teeth along the spine.
  const y0 = 0.062;
  const length = 0.183;
  const tipX = -0.003;
  const yAt = (t: number): number => y0 + t * length;
  const teeth = (y: number): number => {
    if (y < 0.09 || y > 0.165) return 0;
    const f = ((y - 0.09) / 0.0075) % 1;
    return 0.004 * (1 - f);
  };
  const geo = bladeGeometry(
    (t) => {
      const y = yAt(t);
      if (y < 0.2) return [-0.016 - teeth(y), y];
      return [-0.016 + ((y - 0.2) / (y0 + length - 0.2)) * (tipX + 0.016), y];
    },
    (t) => {
      const y = yAt(t);
      if (y < 0.205) return [0.016, y];
      return [0.016 - (0.016 - tipX) * ((y - 0.205) / (y0 + length - 0.205)) ** 1.6, y];
    },
    { thickness: 0.0042, samples: 180 },
  );
  root.add(blade(geo, tigerTooth()));

  const rubber = standard('#1b1d22', 0.7);
  root.add(mesh(new THREE.CylinderGeometry(0.0158, 0.0168, 0.11, 24), rubber));
  for (let y = -0.044; y <= 0.045; y += 0.0125) root.add(mesh(new THREE.TorusGeometry(0.0165, 0.0021, 8, 28).rotateX(Math.PI / 2), rubber, 0, y, 0));
  const guardSteel = darkSteel();
  root.add(mesh(new RoundedBoxGeometry(0.062, 0.012, 0.024, 2, 0.004), guardSteel, -0.006, 0.057, 0));
  // The muzzle ring on the guard, and the pommel with its lug.
  root.add(mesh(new THREE.TorusGeometry(0.0115, 0.0034, 10, 28).rotateX(Math.PI / 2), guardSteel, -0.039, 0.057, 0));
  root.add(mesh(new RoundedBoxGeometry(0.036, 0.016, 0.03, 2, 0.005), guardSteel, 0, -0.062, 0));
  root.add(mesh(new RoundedBoxGeometry(0.012, 0.012, 0.012, 2, 0.003), guardSteel, 0.012, -0.072, 0));
  return { root, spinner: null, flip: null, gripRadius: 0.019, restOpen: 0 };
}

function bowie(): ItemModel {
  const root = new THREE.Group();
  // Broad, with the classic clipped point.
  const y0 = 0.058;
  const length = 0.165;
  const yAt = (t: number): number => y0 + t * length;
  const geo = bladeGeometry(
    (t) => {
      const y = yAt(t);
      return [y < 0.17 ? -0.019 : -0.019 + 0.025 * ((y - 0.17) / (y0 + length - 0.17)) ** 1.4, y];
    },
    (t) => {
      const y = yAt(t);
      return [y < 0.15 ? 0.023 : 0.023 - 0.017 * ((y - 0.15) / (y0 + length - 0.15)) ** 2.2, y];
    },
    { thickness: 0.0048, samples: 64 },
  );
  root.add(blade(geo, crimsonWeb()));

  const brass = standard('#cfa04a', 0.28, 0.92);
  root.add(mesh(new THREE.CapsuleGeometry(0.0085, 0.064, 6, 14).rotateZ(Math.PI / 2), brass, 0.001, 0.053, 0));
  // A stacked leather handle between brass spacers, and a brass pommel.
  const leathers = [standard('#7a4a2a', 0.65), standard('#5a3218', 0.7)];
  for (let i = 0; i < 9; i++) {
    const disc = mesh(new THREE.CylinderGeometry(0.0168, 0.0168, 0.0104, 22), leathers[i % 2]!, 0, 0.04 - i * 0.0106, 0);
    disc.scale.set(1, 1, 0.8);
    root.add(disc);
  }
  for (const y of [0.0465, -0.0525]) {
    const spacer = mesh(new THREE.CylinderGeometry(0.0172, 0.0172, 0.003, 22), brass, 0, y, 0);
    spacer.scale.set(1, 1, 0.8);
    root.add(spacer);
  }
  root.add(sphere(0.0175, brass, 0, -0.064, 0, [1.05, 0.7, 0.85]));
  return { root, spinner: null, flip: null, gripRadius: 0.018, restOpen: 0 };
}

export const KNIVES = { karambit, butterfly, bayonet, bowie } as const;
