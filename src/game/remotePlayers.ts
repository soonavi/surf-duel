/**
 * Draws the other players in a room as named, coloured ghosts, replayed from
 * their snapshot buffers a little in the past, and tracks their progress
 * along the course for live standings.
 */
import * as THREE from 'three';
import type { Room, RoomPlayer } from '../net/room.js';
import type { TrackPath } from '../course/path.js';
import { GhostView } from '../render/ghostView.js';

/** No new samples for this long while racing: show them as lagging. */
const STALE_MS = 3000;

export interface RemoteSample {
  id: string;
  pos: THREE.Vector3;
  yaw: number;
  /** 0..1 along the course. */
  progress: number;
  visible: boolean;
}

interface Remote {
  id: string;
  key: string;
  view: GhostView;
  hint: number;
  sample: RemoteSample;
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Create, rename or drop ghosts to match the room's players (everyone but me). */
  sync(players: readonly RoomPlayer[]): void {
    const wanted = new Set<string>();
    for (const p of players) {
      if (p.isMe) continue;
      wanted.add(p.id);
      const key = `${p.name}|${p.color}`;
      const existing = this.remotes.get(p.id);
      if (existing && existing.key === key) continue;
      existing?.view.dispose();
      const view = new GhostView(p.name, p.color);
      this.scene.add(view.group);
      this.remotes.set(p.id, {
        id: p.id,
        key,
        view,
        hint: existing?.hint ?? 0,
        sample: { id: p.id, pos: new THREE.Vector3(), yaw: 0, progress: 0, visible: false },
      });
    }
    for (const [id, r] of this.remotes) {
      if (!wanted.has(id)) {
        r.view.dispose();
        this.remotes.delete(id);
      }
    }
  }

  /**
   * Place every ghost at race time `raceTimeMs` (already delayed for
   * interpolation). Returns their samples for standings and spectating.
   */
  render(room: Room, raceTimeMs: number, camera: THREE.Vector3, path: TrackPath, racing: ReadonlySet<string>): RemoteSample[] {
    const out: RemoteSample[] = [];
    for (const r of this.remotes.values()) {
      const buffer = room.snapshots(r.id);
      const s = r.sample;
      const res = racing.has(r.id) && buffer ? buffer.sample(raceTimeMs, s.pos) : null;
      if (!res?.ok) {
        s.visible = false;
        r.view.hide();
        out.push(s);
        continue;
      }
      s.yaw = res.yaw;
      s.visible = true;
      const hit = path.locate(s.pos, r.hint);
      r.hint = hit.index;
      s.progress = hit.s / Math.max(1, path.length);
      r.view.update(s.pos, s.yaw, camera);
      out.push(s);
    }
    return out;
  }

  /** True if we've heard nothing from this racer for a while (lag or a hidden tab). */
  isStale(room: Room, id: string, raceTimeMs: number): boolean {
    const newest = room.snapshots(id)?.newestTime;
    return newest === null || newest === undefined || raceTimeMs - newest > STALE_MS;
  }

  sampleOf(id: string): RemoteSample | null {
    const r = this.remotes.get(id);
    return r?.sample.visible ? r.sample : null;
  }

  hideAll(): void {
    for (const r of this.remotes.values()) r.view.hide();
  }

  dispose(): void {
    for (const r of this.remotes.values()) r.view.dispose();
    this.remotes.clear();
  }
}
