import * as THREE from 'three';
import type { BuiltCourse } from '../course/builder';
import { createGridMaterial, createRampMaterial } from './materials';
import type { Theme } from './themes';

/** How far below the course's lowest point the decorative ground sits. */
const GROUND_DEPTH = 4000;
/** Big enough that fog always swallows the edge before you could see it. */
const GROUND_MARGIN = 250_000;

/**
 * The visible course: one merged mesh per material slot (a handful of draw
 * calls for the whole course), plus a themed backdrop far below.
 */
export class CourseView {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(built: BuiltCourse, theme: Theme) {
    this.group.name = 'course';
    const { visuals } = built;

    this.add(visuals.rampRight, createRampMaterial(theme.rampRight));
    this.add(visuals.rampLeft, createRampMaterial(theme.rampLeft));
    this.add(visuals.pads, createGridMaterial({ base: theme.pad.base, line: theme.pad.line, cell: 64 }));
    this.add(visuals.finish, createGridMaterial({ base: theme.finish.base, line: theme.finish.line, cell: 128 }));
    this.add(visuals.gates, new THREE.MeshBasicMaterial({ color: theme.accent }));
    this.add(
      visuals.boosters,
      new THREE.MeshBasicMaterial({ color: theme.booster, transparent: true, opacity: 0.9, depthWrite: false }),
    );

    if (theme.ground) {
      const b = built.bounds;
      const size = new THREE.Vector3();
      b.getSize(size);
      const extent = Math.max(size.x, size.z) + GROUND_MARGIN;
      const geo = new THREE.PlaneGeometry(extent, extent).rotateX(-Math.PI / 2);
      const center = new THREE.Vector3();
      b.getCenter(center);
      geo.translate(center.x, b.min.y - GROUND_DEPTH, center.z);
      this.add(geo, createGridMaterial({ base: theme.ground.base, line: theme.ground.line, cell: 512, lineWidth: 1 }));
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.disposables.push(geometry, material);
    if (!geometry.getAttribute('position')?.count) return;
    this.group.add(new THREE.Mesh(geometry, material));
  }
}
