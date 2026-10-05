import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../physics/constants.js';

/** Ghosts closer than this to the camera are hidden so they don't fill the screen. */
const NEAR_HIDE = 90;

function labelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(96, 24, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * A translucent runner: capsule body with a nose showing which way it looks,
 * and a name tag. No collision — purely visual. Reused for multiplayer later.
 */
export class GhostView {
  readonly group = new THREE.Group();
  private readonly body: THREE.Group;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(label: string, color: string) {
    const bodyMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false });
    const noseMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
    this.materials.push(bodyMat, noseMat);

    const capsule = new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 4, 12);
    const nose = new THREE.ConeGeometry(7, 22, 10).rotateX(-Math.PI / 2).translate(0, 22, -PLAYER_RADIUS - 8);
    this.geometries.push(capsule, nose);

    this.body = new THREE.Group();
    const capsuleMesh = new THREE.Mesh(capsule, bodyMat);
    capsuleMesh.position.y = PLAYER_HEIGHT / 2;
    this.body.add(capsuleMesh, new THREE.Mesh(nose, noseMat).translateY(PLAYER_HEIGHT / 2));

    const tag = labelSprite(label, color);
    tag.position.y = PLAYER_HEIGHT + 34;
    this.materials.push(tag.material);
    this.group.add(this.body, tag);
    this.group.visible = false;
  }

  /** Place at a feet position and yaw; hidden when right on top of the camera. */
  update(feet: THREE.Vector3, yaw: number, camera: THREE.Vector3): void {
    this.group.position.copy(feet);
    this.body.rotation.y = yaw;
    this.group.visible = feet.distanceToSquared(camera) > NEAR_HIDE * NEAR_HIDE;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.materials) {
      if (m instanceof THREE.SpriteMaterial) m.map?.dispose();
      m.dispose();
    }
    for (const g of this.geometries) g.dispose();
  }
}
