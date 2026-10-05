/**
 * The cover image (/?capture=cover): a rider mid-surf on Speed Demon, from
 * a low chase camera on the open side of the ramp, with a glowing trail.
 * coverShot() picks the moment from a real bot run (pure, so it's tested
 * and always the same shot); buildCoverRider() makes the three.js objects.
 */
import * as THREE from 'three';
import type { BuiltCourse } from '../course/builder.js';
import { SurfBot } from '../course/bot.js';
import { CourseRuntime, placeAtSpawn } from '../course/runtime.js';
import { forwardOf, rightOf } from '../course/layout.js';
import { BvhWorld } from '../physics/collision.js';
import { DEFAULT_PHYSICS, PLAYER_HEIGHT, PLAYER_RADIUS, TICK_DT, TICK_RATE } from '../physics/constants.js';
import { createPlayer, stepPlayer } from '../physics/player.js';

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 900;

export interface CoverShot {
  /** Feet position. */
  rider: THREE.Vector3;
  riderYaw: number;
  surfing: boolean;
  speed: number;
  /** The rider's last moments, oldest first, ending at the rider. */
  trail: THREE.Vector3[];
  camera: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  /** A slight tilt (radians) for drama. */
  roll: number;
}

const TRAIL_TICKS = 70;

export function coverShot(built: BuiltCourse): CoverShot {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, { hop: true });
  const player = createPlayer();
  runtime.reset();
  placeAtSpawn(player, built.spawn);
  runtime.afterRespawn(player);
  bot.resync(player);

  // Record the whole run, then take the fastest surfing moment in its middle stretch
  // (the start is slow and the end is the finish pad).
  const frames: { pos: THREE.Vector3; surfing: boolean; speed: number; yaw: number; normal: THREE.Vector3 }[] = [];
  for (let tick = 0; tick < 180 * TICK_RATE; tick++) {
    stepPlayer(player, bot.command(player), DEFAULT_PHYSICS, world, TICK_DT);
    frames.push({
      pos: player.pos.clone(),
      surfing: player.surfing,
      speed: Math.hypot(player.vel.x, player.vel.z),
      yaw: Math.atan2(-player.vel.x, -player.vel.z),
      normal: player.surfNormal.clone(),
    });
    const events = runtime.update(player);
    if (events.some((e) => e.type === 'finish')) break;
    if (events.some((e) => e.type === 'kill')) {
      placeAtSpawn(player, runtime.respawnPoint());
      runtime.afterRespawn(player);
      bot.resync(player);
    }
  }
  let pick = Math.floor(frames.length / 2);
  for (let i = Math.floor(frames.length * 0.3); i < frames.length * 0.75; i++) {
    if (frames[i]!.surfing && (!frames[pick]!.surfing || frames[i]!.speed > frames[pick]!.speed)) pick = i;
  }
  const best = frames[pick]!;
  const history = frames.map((f) => f.pos);

  const rider = best.pos.clone();
  const trail = history.slice(Math.max(0, pick - TRAIL_TICKS), pick + 1).filter((_, i, all) => i % 3 === 0 || i === all.length - 1);

  // Chase camera: behind, low, out on the open side of the ramp (where the face's normal points).
  const fwd = forwardOf(best.yaw, new THREE.Vector3());
  const right = rightOf(best.yaw, new THREE.Vector3());
  const open = Math.sign(best.normal.x * right.x + best.normal.z * right.z) || 1;
  const camera = rider.clone().addScaledVector(fwd, -300).addScaledVector(right, open * 190);
  camera.y += PLAYER_HEIGHT + 150;
  // Look past the rider and down the course, so the ramps ahead fill the frame instead of sky.
  const target = rider.clone().addScaledVector(fwd, 1500).addScaledVector(right, -open * 120);
  target.y -= 420;
  return { rider, riderYaw: best.yaw, surfing: best.surfing, speed: best.speed, trail, camera, target, fov: 80, roll: -open * 0.07 };
}

/** A solid, glowing rider leaning into the ramp, and a neon trail of where it has been. */
export function buildCoverRider(shot: CoverShot, color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.9, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 6, 16),
    new THREE.MeshBasicMaterial({ color }),
  );
  body.position.copy(shot.rider);
  body.position.y += PLAYER_HEIGHT / 2;
  body.rotation.set(0, shot.riderYaw, 0);
  group.add(body);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PLAYER_HEIGHT * 0.9, 24, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.position.copy(body.position);
  group.add(halo);

  if (shot.trail.length >= 2) {
    const points = shot.trail.map((p) => p.clone().setY(p.y + PLAYER_HEIGHT / 2));
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, points.length * 4, 9, 8, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(tube);
  }
  return group;
}

/** The title, pitch and a vignette for legibility, drawn on a COVER_WIDTH × COVER_HEIGHT 2D canvas. */
export function drawCoverTitle(g: CanvasRenderingContext2D): void {
  const w = COVER_WIDTH;
  const h = COVER_HEIGHT;
  g.clearRect(0, 0, w, h);
  const shade = g.createLinearGradient(0, h * 0.45, 0, h);
  shade.addColorStop(0, 'rgba(7, 5, 26, 0)');
  shade.addColorStop(1, 'rgba(7, 5, 26, 0.78)');
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);

  const x = 84;
  g.save();
  g.font = 'italic 900 168px system-ui, "Segoe UI", Roboto, sans-serif';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '10px';
  const ink = g.createLinearGradient(x, 0, x + 900, 0);
  ink.addColorStop(0, '#3ee6ff');
  ink.addColorStop(1, '#ff4fd8');
  g.shadowColor = 'rgba(255, 79, 216, 0.55)';
  g.shadowBlur = 40;
  g.fillStyle = ink;
  g.fillText('SURF DUEL', x, h - 150);
  g.restore();

  g.save();
  g.font = '600 40px system-ui, "Segoe UI", Roboto, sans-serif';
  g.fillStyle = 'rgba(243, 240, 255, 0.92)';
  g.shadowColor = 'rgba(0, 0, 0, 0.7)';
  g.shadowBlur = 12;
  g.fillText('Surf AI-built courses. Race your friends live.', x + 8, h - 88);
  g.restore();
}
