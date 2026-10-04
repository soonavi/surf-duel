import * as THREE from 'three';
import { createGridMaterial } from '../render/materials';
import { rampPrismGeometry } from './geometry';

export interface TestLevel {
  group: THREE.Group;
  spawn: THREE.Vector3;
}

/**
 * Phase 0/1 sandbox: a start platform, one long 60° test ramp below and ahead
 * of it, and a far-below floor for scale. Replaced by the course builder in Phase 2.
 */
export function buildTestLevel(): TestLevel {
  const group = new THREE.Group();
  group.name = 'test-level';

  const platformMat = createGridMaterial({ base: '#1d1840', line: '#3ee6ff', cell: 32 });
  const rampMat = createGridMaterial({ base: '#2a1f5c', line: '#ff4fd8', cell: 64 });
  const floorMat = createGridMaterial({ base: '#0d0a24', line: '#5a3bb0', cell: 256, lineWidth: 1 });

  // Start platform: top surface at y = 0.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(512, 64, 512), platformMat);
  platform.position.set(0, -32, 0);
  group.add(platform);

  // Test ramp: peak 320 units below the platform, starting just past its edge.
  const ramp = new THREE.Mesh(rampPrismGeometry(6000, 700, 60), rampMat);
  ramp.position.set(0, -1020, -400);
  group.add(ramp);

  // Reference floor far below.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120_000, 120_000), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -2500, -3000);
  group.add(floor);

  return { group, spawn: new THREE.Vector3(0, 0, 160) };
}
