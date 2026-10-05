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
  /** Gates and boosters, with their resting colours, for the beat pulse. */
  private readonly glowing: { material: THREE.MeshBasicMaterial; color: THREE.Color }[] = [];

  constructor(built: BuiltCourse, theme: Theme) {
    this.group.name = 'course';
    const { visuals } = built;

    this.add(visuals.rampRight, createRampMaterial(theme.rampRight));
    this.add(visuals.rampLeft, createRampMaterial(theme.rampLeft));
    this.add(visuals.pads, createGridMaterial({ base: theme.pad.base, line: theme.pad.line, cell: 64 }));
    this.add(visuals.finish, createGridMaterial({ base: theme.finish.base, line: theme.finish.line, cell: 128 }));
    const gates = new THREE.MeshBasicMaterial({ color: theme.accent });
    const boosters = new THREE.MeshBasicMaterial({ color: theme.booster, transparent: true, opacity: 0.9, depthWrite: false });
    this.add(visuals.gates, gates);
    this.add(visuals.boosters, boosters);
    for (const material of [gates, boosters]) this.glowing.push({ material, color: material.color.clone() });

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

  /** Gates and boosters brighten with the music's beat (0–1). */
  setPulse(pulse: number): void {
    for (const g of this.glowing) g.material.color.copy(g.color).multiplyScalar(1 + 0.6 * pulse);
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
