import * as THREE from 'three';
import { createSky, type SkyColors } from './materials';

const CAMERA_NEAR = 4;
const CAMERA_FAR = 100_000;
const SKY_RADIUS = 80_000;
/** Cap on device pixel ratio; high-DPI laptops on integrated GPUs choke above this. */
const MAX_PIXEL_RATIO = 1.5;

/** Default "neon" palette until course themes land in Phase 2. */
export const DEFAULT_SKY: SkyColors = {
  zenith: '#07051a',
  horizon: '#3b1a6b',
  nadir: '#0a0418',
};

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly sky: THREE.Mesh;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    this.camera.rotation.order = 'YXZ';

    this.sky = createSky(SKY_RADIUS, DEFAULT_SKY);
    this.scene.add(this.sky);
    this.scene.background = new THREE.Color(DEFAULT_SKY.horizon);
    this.scene.fog = new THREE.Fog(DEFAULT_SKY.horizon, 5_000, 32_000);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
