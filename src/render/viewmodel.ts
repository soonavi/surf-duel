/**
 * The hand and what it holds, drawn over the course like a shooter's view
 * model: its own scene, camera and lights, rendered last on a fresh depth
 * buffer, so it never sinks into a ramp and keeps its size whatever your
 * field of view.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HELD_ITEMS, heldItem, type HeldItemId, type ItemKind, type ItemPose } from '../game/heldItem.js';
import { buildItem, disposeModel, type ItemModel } from './itemModels.js';
import { buildHand, type HandRig } from './hand.js';
import type { SceneView } from './scene.js';
import type { Theme } from './themes.js';

/** The view model's own vertical field of view: steady while the course's widens with speed. */
const VIEW_FOV = 55;
/** Where the grip rests: low on the right. */
const REST_POSITION = new THREE.Vector3(0.2, -0.135, -0.38);
/** How each kind of thing is held there (radians about x, y, z)... */
const REST_TURN: Record<ItemKind, [number, number, number]> = {
  // Blade up and edge forward, turned so you see its flat and your fingers round the grip, leaning in.
  knife: [-0.15, 0.7, 0.25],
  // Facing you, turned a little toward the middle.
  plush: [-0.08, -0.45, 0.08],
  // In profile, beak toward the middle.
  toy: [-0.05, 0.25, 0.05],
  food: [-0.18, 0.3, 0.22],
  none: [0, 0, 0],
};
/** Things held their own way. A baguette tips forward, out of your line of sight. */
const REST_TURN_FOR: Partial<Record<HeldItemId, [number, number, number]>> = {
  baguette: [-0.75, 0.3, -0.05],
};
/** Knives sit in the hand edge forward, their flats to the sides, as you'd really hold one. */
const TURN_IN_HAND: Record<ItemKind, number> = { knife: Math.PI / 2, plush: 0, toy: 0, food: 0, none: 0 };
/** ...and how big: chunky things smaller, so none of them hides the course. */
const REST_SCALE: Record<ItemKind, number> = { knife: 1, plush: 0.72, toy: 0.85, food: 0.85, none: 1 };

const ENVIRONMENT_INTENSITY = 0.45;
/** The elbow turns this much of the way with the wrist: a forearm turns less than a hand. */
const SLEEVE_FOLLOW = 0.45;
/** How far up the forearm the elbow is, from the sleeve's opening. */
const FOREARM_LENGTH = 0.3;

/** An angle as the equivalent one in [−π, π). */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

function addLights(scene: THREE.Scene): THREE.HemisphereLight {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x20202a, 0.9);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.6, 1, 0.9);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(1, 0.3, -0.8);
  scene.add(hemi, key, rim);
  return hemi;
}

export class Viewmodel {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.01, 5);
  /** Rest placement. Inside it the wrist carries the glove and the item; the sleeve runs from the glove's cuff to the elbow. */
  private readonly rig = new THREE.Group();
  private readonly sleeve = new THREE.Group();
  private readonly wrist = new THREE.Group();
  /** The item, squashed about the grip. */
  private readonly holder = new THREE.Group();
  private readonly hand: HandRig;
  private readonly hemi: THREE.HemisphereLight;
  private readonly environment: THREE.Texture;
  private model: ItemModel | null = null;
  private id: HeldItemId = 'none';
  private readonly cuffAt = new THREE.Vector3();
  private readonly elbowAt = new THREE.Vector3();
  private readonly elbowTurn = new THREE.Euler();

  constructor(private readonly view: SceneView) {
    const pmrem = new THREE.PMREMGenerator(view.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment;
    // Reflections enough to read as metal, not so much that a blade's colour washes out.
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    this.hemi = addLights(this.scene);
    this.hand = buildHand();
    this.sleeve.add(this.hand.sleeve);
    this.wrist.add(this.hand.group, this.holder);
    this.rig.position.copy(REST_POSITION);
    this.rig.add(this.sleeve, this.wrist);
    this.scene.add(this.rig);
  }

  setItem(id: HeldItemId): void {
    if (id === this.id) return;
    this.id = id;
    if (this.model) {
      this.holder.remove(this.model.root);
      disposeModel(this.model.root);
    }
    const kind = heldItem(id).kind;
    this.model = buildItem(id);
    if (this.model) {
      this.model.root.scale.setScalar(REST_SCALE[kind]);
      this.model.root.rotation.y = TURN_IN_HAND[kind];
      this.holder.add(this.model.root);
      this.hand.fit(this.model.gripRadius * REST_SCALE[kind]);
    }
    this.rig.rotation.set(...(REST_TURN_FOR[id] ?? REST_TURN[kind]));
  }

  /** Light it like the course: the sky's colour from above, the cuff in the left ramps' colour. */
  setTheme(theme: Theme): void {
    this.hemi.color.set(theme.sky.horizon).lerp(new THREE.Color(0xffffff), 0.55);
    this.hemi.groundColor.set(theme.sky.nadir);
    this.hand.cuff.color.set(theme.rampLeft.ui);
  }

  /** Draw the hand and what it holds over the frame just rendered. */
  render(pose: ItemPose): void {
    const model = this.model;
    if (!model) return;
    const size = this.view.renderer.getSize(new THREE.Vector2());
    const aspect = size.x / Math.max(1, size.y);
    if (Math.abs(this.camera.aspect - aspect) > 1e-6) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    this.wrist.position.set(pose.x, pose.y, pose.z);
    this.wrist.rotation.set(pose.rx, pose.ry, pose.rz);
    // The sleeve's opening stays round the glove's cuff, and the sleeve runs from there to an
    // elbow that turns only part of the way with the hand.
    this.wrist.updateMatrix();
    const cuff = this.cuffAt.copy(this.hand.wristPoint).applyMatrix4(this.wrist.matrix);
    this.elbowTurn.set(SLEEVE_FOLLOW * wrap(pose.rx), SLEEVE_FOLLOW * wrap(pose.ry), SLEEVE_FOLLOW * wrap(pose.rz));
    const elbow = this.elbowAt.copy(this.hand.wristPoint).addScaledVector(this.hand.forearm, FOREARM_LENGTH).applyEuler(this.elbowTurn).add(this.wrist.position);
    this.sleeve.position.copy(cuff);
    this.sleeve.quaternion.setFromUnitVectors(this.hand.forearm, elbow.sub(cuff).normalize());
    const s = pose.squash;
    this.holder.scale.set(1 + s / 2, 1 - s, 1 + s / 2);
    if (model.spinner) model.spinner.rotation.z = -pose.spin;
    model.flip?.(pose.flip);
    this.hand.pose(model.restOpen + pose.open);
    this.view.renderOverlay(this.scene, this.camera);
  }

  /**
   * A picture of every item, for the settings screen: each is drawn on the
   * game canvas's corner and copied out straight away (the next frame redraws
   * over it). `background` fills behind them.
   */
  pictures(size: number, background: string): Map<HeldItemId, string> {
    const renderer = this.view.renderer;
    const canvas = renderer.domElement;
    const out = new Map<HeldItemId, string>();
    const copy = document.createElement('canvas');
    copy.width = size;
    copy.height = size;
    const ctx = copy.getContext('2d');
    if (!ctx) return out;

    const scene = new THREE.Scene();
    scene.environment = this.environment;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const px = Math.round(size * renderer.getPixelRatio());
    renderer.setViewport(0, 0, size, size);
    renderer.setScissor(0, 0, size, size);
    renderer.setScissorTest(true);
    renderer.setClearColor(background, 1);

    for (const item of HELD_ITEMS) {
      const model = buildItem(item.id)?.root;
      if (!model) continue;
      // Knives lie diagonally to fill the square; everything else turns three-quarters to you.
      const turn = new THREE.Group();
      if (item.kind === 'knife') turn.rotation.set(0.25, 0.6, -0.75);
      else turn.rotation.set(0.15, item.kind === 'toy' ? 0.5 : -0.45, 0);
      turn.add(model);
      scene.add(turn);
      const bounds = new THREE.Box3().setFromObject(turn);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const distance = (sphere.radius * 1.08) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.copy(sphere.center).add(new THREE.Vector3(0, 0, distance));
      camera.lookAt(sphere.center);
      renderer.clear();
      renderer.render(scene, camera);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(canvas, 0, canvas.height - px, px, px, 0, 0, size, size);
      out.set(item.id, copy.toDataURL('image/png'));
      scene.remove(turn);
      disposeModel(model);
    }

    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.setClearColor(clearColor, clearAlpha);
    return out;
  }
}
