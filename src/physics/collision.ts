import { Box3, BufferGeometry, Line3, Mesh, Vector3, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from './constants.js';

/**
 * Bake every mesh under `root` into one world-space, position-only geometry
 * for the BVH. Meshes with `userData.noCollide` are skipped.
 */
export function mergeCollisionGeometry(root: Object3D): BufferGeometry {
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || obj.userData.noCollide) return;
    const src = obj.geometry as BufferGeometry;
    const geo = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position') geo.deleteAttribute(name);
    }
    geo.clearGroups();
    geo.applyMatrix4(obj.matrixWorld);
    parts.push(geo);
  });
  if (parts.length === 0) throw new Error('mergeCollisionGeometry: nothing collidable under root');
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('mergeCollisionGeometry: geometries could not be merged');
  return merged;
}

/** Fixed-capacity list of contact normals, reused every tick to avoid allocation. */
export class ContactList {
  readonly normals: Vector3[];
  count = 0;

  constructor(readonly capacity = 32) {
    this.normals = Array.from({ length: capacity }, () => new Vector3());
  }

  clear(): void {
    this.count = 0;
  }

  add(n: Vector3): void {
    if (this.count >= this.capacity) return;
    this.normals[this.count++]!.copy(n);
  }
}

export interface CollisionWorld {
  /**
   * Push a capsule whose bottom is at `feet` out of all geometry. Mutates
   * `feet`; appends one unit normal per contact (pointing from the surface
   * toward the capsule). Returns the number of contacts found.
   */
  resolveCapsule(feet: Vector3, contacts: ContactList): number;
}

export const EMPTY_WORLD: CollisionWorld = {
  resolveCapsule: () => 0,
};

export interface CapsuleShape {
  radius: number;
  height: number;
}

/** Max push-out passes per call; each pass resolves the single deepest contact. */
const MAX_PASSES = 6;
/** Overlap smaller than this is treated as touching, not penetrating (absorbs float noise). */
const PENETRATION_EPSILON = 1e-4;

/**
 * Static course geometry in a BVH. Penetration is resolved by pushing the
 * capsule's core segment away from the overlapping triangle along the
 * closest-point direction — the face normal for face contacts, a rounded
 * normal on genuine edges.
 *
 * Contacts are resolved deepest-first, one per pass. Otherwise, crossing the
 * seam between two coplanar triangles can hit the neighbour's *edge* first,
 * producing a tilted normal that bleeds speed (Source's infamous "rampbug").
 * The triangle actually under the capsule is always the deepest, so it wins.
 *
 * The mover keeps each step under half a radius, so the segment never ends
 * up fully through a face.
 */
export class BvhWorld implements CollisionWorld {
  readonly bvh: MeshBVH;

  private readonly segment = new Line3();
  private readonly box = new Box3();
  private readonly triPoint = new Vector3();
  private readonly capPoint = new Vector3();
  private readonly bestDir = new Vector3();

  constructor(
    geometry: BufferGeometry,
    private readonly shape: CapsuleShape = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT },
  ) {
    this.bvh = new MeshBVH(geometry);
  }

  resolveCapsule(feet: Vector3, contacts: ContactList): number {
    const { radius, height } = this.shape;
    const { segment, box, triPoint, capPoint, bestDir } = this;
    segment.start.set(feet.x, feet.y + radius, feet.z);
    segment.end.set(feet.x, feet.y + height - radius, feet.z);

    let found = 0;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
      let bestDistance = radius - PENETRATION_EPSILON;
      let hit = false;

      this.bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(box),
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(segment, triPoint, capPoint);
          if (distance >= bestDistance) return false;
          bestDistance = distance;
          hit = true;
          if (distance > 1e-6) {
            bestDir.subVectors(capPoint, triPoint).divideScalar(distance);
          } else {
            tri.getNormal(bestDir); // Segment touching the face exactly: use the face normal.
          }
          return false;
        },
      });

      if (!hit) break;
      const depth = radius - bestDistance;
      segment.start.addScaledVector(bestDir, depth);
      segment.end.addScaledVector(bestDir, depth);
      contacts.add(bestDir);
      found++;
    }

    feet.set(segment.start.x, segment.start.y - radius, segment.start.z);
    return found;
  }
}
