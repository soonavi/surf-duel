/**
 * A burst of glowing particles (checkpoints): one Points object reused for
 * every burst, so there's nothing to allocate mid-race.
 */
import * as THREE from 'three';

const COUNT = 90;
const LIFE_S = 0.9;

export class ParticleBurst {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(COUNT * 3);
  private readonly velocities = new Float32Array(COUNT * 3);
  private readonly material: THREE.PointsMaterial;
  private age = LIFE_S;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      size: 18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** Burst at `at`, carried along with `carry` (the rider's velocity) so it flies past with you. */
  fire(at: THREE.Vector3, carry: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < COUNT; i++) {
      // Random direction on a sphere, fast and a bit flattened.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const speed = 300 + Math.random() * 500;
      this.positions.set([at.x, at.y, at.z], i * 3);
      this.velocities.set([carry.x * 0.6 + r * Math.cos(a) * speed, carry.y * 0.6 + u * speed * 0.6, carry.z * 0.6 + r * Math.sin(a) * speed], i * 3);
    }
    this.material.color.set(color);
    this.age = 0;
    this.points.visible = true;
    this.points.geometry.attributes.position!.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.age >= LIFE_S) return;
    this.age += dt;
    if (this.age >= LIFE_S) {
      this.points.visible = false;
      return;
    }
    for (let i = 0; i < COUNT * 3; i++) this.positions[i] = this.positions[i]! + this.velocities[i]! * dt;
    this.material.opacity = 1 - this.age / LIFE_S;
    this.points.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
