import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { BvhWorld, ContactList, mergeCollisionGeometry } from './collision.js';
import { PLAYER_RADIUS } from './constants.js';
import { feetOnLeftFace, floorWorld, leftFaceNormal, rampWorld, sphereDistanceToLeftFace } from './testWorlds.js';

describe('BvhWorld.resolveCapsule', () => {
  it('reports nothing for a capsule standing clear of the floor', () => {
    const world = floorWorld(0);
    const feet = new Vector3(0, 1, 0);
    const contacts = new ContactList();
    expect(world.resolveCapsule(feet, contacts)).toBe(0);
    expect(feet.y).toBe(1);
  });

  it('pushes a capsule sunk into the floor back up with an upward normal', () => {
    const world = floorWorld(0);
    const feet = new Vector3(10, -5, 20);
    const contacts = new ContactList();
    expect(world.resolveCapsule(feet, contacts)).toBeGreaterThan(0);
    expect(feet.y).toBeCloseTo(0, 4);
    expect(feet.x).toBeCloseTo(10, 6);
    expect(contacts.normals[0]!.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('pushes a capsule out of a 60° ramp face along the face normal', () => {
    const spec = { length: 2000, height: 800, angleDeg: 60 };
    const world = rampWorld(spec);
    const n = leftFaceNormal(60);
    const feet = feetOnLeftFace(spec, 400, -1000).addScaledVector(n, -6); // 6 units deep
    const contacts = new ContactList();
    expect(world.resolveCapsule(feet, contacts)).toBeGreaterThan(0);
    expect(sphereDistanceToLeftFace(spec, feet)).toBeCloseTo(PLAYER_RADIUS, 3);
    expect(contacts.normals[0]!.distanceTo(n)).toBeLessThan(1e-6);
  });
});

describe('mergeCollisionGeometry', () => {
  it('bakes world transforms and skips meshes flagged noCollide', () => {
    const root = new Group();
    const solid = new Mesh(new BoxGeometry(200, 20, 200));
    solid.position.set(1000, -10, 0); // top face at y = 0, centred on x = 1000
    const ghost = new Mesh(new BoxGeometry(200, 20, 200));
    ghost.position.set(0, -10, 0);
    ghost.userData.noCollide = true;
    root.add(solid, ghost);
    root.position.y = 50; // parent transform must be applied too

    const world = new BvhWorld(mergeCollisionGeometry(root));
    const contacts = new ContactList();

    const onSolid = new Vector3(1000, 45, 0);
    expect(world.resolveCapsule(onSolid, contacts)).toBeGreaterThan(0);
    expect(onSolid.y).toBeCloseTo(50, 4);

    const onGhost = new Vector3(0, 45, 0);
    expect(world.resolveCapsule(onGhost, contacts)).toBe(0);
  });
});
