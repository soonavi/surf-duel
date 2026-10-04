import * as THREE from 'three';
import { createGridMaterial } from '../render/materials';
import { rampPrismGeometry } from './geometry';

export interface TestLevel {
  group: THREE.Group;
  spawn: THREE.Vector3;
  /** Falling below this respawns the player. */
  killY: number;
}

interface RampPlacement {
  /** Centreline x. */
  x: number;
  /** Front edge z. The ramp runs toward −Z. */
  z: number;
  /** Peak height at the front edge. */
  peakY: number;
  length: number;
  height: number;
  angleDeg: number;
  /** Nose-down tilt along the length. */
  pitchDeg: number;
}

function ramp(mat: THREE.Material, p: RampPlacement): THREE.Mesh {
  const mesh = new THREE.Mesh(rampPrismGeometry(p.length, p.height, p.angleDeg), mat);
  mesh.rotation.x = -THREE.MathUtils.degToRad(p.pitchDeg);
  mesh.position.set(p.x, p.peakY - p.height, p.z);
  return mesh;
}

function platform(mat: THREE.Material, x: number, topY: number, z: number, w: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 64, d), mat);
  mesh.position.set(x, topY - 32, z);
  return mesh;
}

/**
 * Phase 1 playtest stage: drop off the start platform onto three alternating,
 * descending 60° ramps, then land on a finish pad. A big floor underneath
 * catches falls and doubles as a bunny-hop practice area. Replaced by the
 * course builder in Phase 2.
 */
export function buildTestLevel(): TestLevel {
  const group = new THREE.Group();
  group.name = 'test-level';

  const startMat = createGridMaterial({ base: '#1d1840', line: '#3ee6ff', cell: 32 });
  const rampMatA = createGridMaterial({ base: '#2a1f5c', line: '#ff4fd8', cell: 64 });
  const rampMatB = createGridMaterial({ base: '#1a2a5c', line: '#3ee6ff', cell: 64 });
  const finishMat = createGridMaterial({ base: '#3a2a10', line: '#ffd27a', cell: 64 });
  const floorMat = createGridMaterial({ base: '#0d0a24', line: '#5a3bb0', cell: 256, lineWidth: 1 });

  group.add(platform(startMat, 0, 0, 0, 512, 512));

  // Each ramp's face sits under where a player riding high on the previous one
  // comes off, so a decent run chains all three without air-steering.
  const common = { length: 5000, height: 1200, angleDeg: 60, pitchDeg: 8 };
  // Ramp 1 sits to the right: you land on its left face and hold D.
  group.add(ramp(rampMatA, { ...common, x: 220, z: -300, peakY: -120 }));
  // Ramp 2 sits to the left: land on its right face and hold A.
  group.add(ramp(rampMatB, { ...common, x: -180, z: -5800, peakY: -700 }));
  // Ramp 3 back to the right.
  group.add(ramp(rampMatA, { ...common, x: 180, z: -11300, peakY: -2050 }));

  group.add(platform(finishMat, 0, -3500, -17800, 2400, 2400));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120_000, 120_000), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -4200, -8000);
  group.add(floor);

  return { group, spawn: new THREE.Vector3(0, 0, 160), killY: -6000 };
}
