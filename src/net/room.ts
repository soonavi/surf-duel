/**
 * A multiplayer room over a RoomTransport.
 *
 * - Presence carries each player's profile and status. The host (the
 *   longest-standing member) also publishes the room state in its presence,
 *   so late joiners get it straight away and it survives the host leaving:
 *   whoever is promoted re-publishes the last state they saw.
 * - Broadcast carries batched 20 Hz movement samples, clock-sync pings and
 *   finish notices.
 * - Times on the wire are race time (ms since the shared GO), so playback
 *   needs no clock sync. Only the GO itself is announced in host time, and
 *   ClockSync converts it.
 */
import type { Vector3 } from 'three';
import { ClockSync } from './clock.js';
import { SnapshotBuffer } from './interpolation.js';
import {
  EVENTS,
  Finish,
  PROTOCOL_VERSION,
  Ping,
  PlayerMeta,
  Pong,
  SAMPLE_STRIDE,
  StateBatch,
  type CourseRef,
  type PlayerStatus,
  type RaceResult,
  type RoomState,
} from './protocol.js';
import { batchInterval, generateRoomCode, hostOf, normalizeRoomCode, orderMembers, overCapacity, pickColor, sanitizeName } from './roomLogic.js';
import type { PresenceEntry, RoomTransport, TransportStatus } from './transport.js';

export type RoomJoinErrorKind = 'invalid-code' | 'not-found' | 'full' | 'connection';

export class RoomJoinError extends Error {
  constructor(
    readonly kind: RoomJoinErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'RoomJoinError';
  }
}

export interface RoomProfile {
  id: string;
  name: string;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  ready: boolean;
  status: PlayerStatus;
  result: RaceResult | null;
  isHost: boolean;
  isMe: boolean;
}

export interface RoomOptions {
  transport: RoomTransport;
  now?: () => number;
  /** Realtime messages per second this room may use (shared project quota). */
  budget?: number;
  rng?: () => number;
  /**
   * How long to wait, after our own presence shows up, for the rest of the
   * room to appear. Supabase delivers existing members ~1 s after us.
   */
  joinSettleMs?: number;
}

export const DEFAULT_BUDGET = 300;
const PING_COUNT = 4;
const PING_SPACING_MS = 200;
/** Extra playback delay on top of the batch interval, to absorb network jitter. */
const JITTER_MS = 120;
/** After the last racer finishes, give results a moment before reopening the lobby. */
const ALL_DONE_GRACE_MS = 2500;
/** Racers still going this long after the first finish are marked DNF. */
const DNF_TIMEOUT_MS = 60_000;
/** Hard cap on a race, in case nobody ever finishes. */
const MAX_RACE_MS = 10 * 60_000;
const CREATE_ATTEMPTS = 5;
/** Joining: wait this long for an existing room to show itself before calling it not found. */
const DEFAULT_JOIN_SETTLE_MS = 3000;
/** Join stamp while still joining: sorts after every real member. */
const JOINING = Number.MAX_SAFE_INTEGER;

const roomTopic = (code: string): string => `surfduel:${code}`;

function makeRaceId(rng: () => number): string {
  return Math.floor(rng() * 2 ** 52).toString(36);
}

export class Room {
  /** Fired when players, statuses or the room state change. */
  onChange: (() => void) | null = null;
  /** Fired once per player per race when they finish. */
  onFinish: ((player: RoomPlayer, result: RaceResult) => void) | null = null;
  onPlayerLeft: ((player: RoomPlayer) => void) | null = null;
  onConnection: ((status: TransportStatus) => void) | null = null;

  readonly clock = new ClockSync();
  players: RoomPlayer[] = [];
  hostId: string | null = null;

  private meta: PlayerMeta;
  private members = new Map<string, PlayerMeta>();
  private known: RoomState;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly budget: number;
  private readonly buffers = new Map<string, SnapshotBuffer>();
  private readonly announced = new Set<string>();
  private pending: number[] = [];
  private pendingRace: string | null = null;
  private lastSend = 0;
  private pingsLeft = 0;
  private nextPingAt = 0;
  private pingNonce = 0;
  private allDoneSince: number | null = null;
  private firstFinishAt: number | null = null;
  private closed = false;
  private presenceSeen: (() => void) | null = null;
  private othersSeen: (() => void) | null = null;
  private readonly joinSettleMs: number;

  private constructor(
    private readonly transport: RoomTransport,
    readonly code: string,
    private readonly me: RoomProfile,
    opts: RoomOptions,
    initial: RoomState,
  ) {
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.budget = opts.budget ?? DEFAULT_BUDGET;
    this.joinSettleMs = opts.joinSettleMs ?? DEFAULT_JOIN_SETTLE_MS;
    this.known = initial;
    this.meta = {
      v: PROTOCOL_VERSION,
      name: sanitizeName(me.name),
      color: '#3ee6ff',
      joinedAt: this.now(),
      ready: false,
      status: 'lobby',
      result: null,
      room: null,
    };
  }

  // --- joining -----------------------------------------------------------------

  /** Create a new room hosting `course`. Retries if the random code is taken. */
  static async create(opts: RoomOptions, profile: RoomProfile, course: { course: CourseRef; courseKey: string }): Promise<Room> {
    const rng = opts.rng ?? Math.random;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      const code = generateRoomCode(rng);
      const initial: RoomState = { phase: 'lobby', raceId: null, course: course.course, courseKey: course.courseKey, startAt: null, seq: 1 };
      const room = new Room(opts.transport, code, profile, opts, initial);
      // A brand-new code is almost never in use; a shorter settle keeps "Create room" snappy.
      await room.connect(Math.min(room.joinSettleMs, 1200), false);
      if (room.members.size === 1) {
        room.publish();
        return room;
      }
      await room.leave(); // code collision: someone's already here
    }
    throw new RoomJoinError('connection', 'Could not find a free room code. Please try again.');
  }

  static async join(opts: RoomOptions, rawCode: string, profile: RoomProfile): Promise<Room> {
    const code = normalizeRoomCode(rawCode);
    if (!code) throw new RoomJoinError('invalid-code', 'Room codes are 4 letters (no I or O).');
    const placeholder: RoomState = { phase: 'lobby', raceId: null, course: { kind: 'shipped', id: 'tutorial' }, courseKey: '', startAt: null, seq: 0 };
    const room = new Room(opts.transport, code, profile, opts, placeholder);
    await room.connect(room.joinSettleMs, true);
    if (room.members.size <= 1) {
      await room.leave();
      throw new RoomJoinError('not-found', `No room with code ${code} — it may have closed.`);
    }
    if (overCapacity(room.memberList(), room.me.id)) {
      await room.leave();
      throw new RoomJoinError('full', `Room ${code} is full.`);
    }
    room.startPings();
    return room;
  }

  /**
   * @param settleMs how long to wait for an existing room to show itself
   * @param joining true when joining someone else's room (vs creating one)
   */
  private async connect(settleMs: number, joining: boolean): Promise<void> {
    try {
      await this.transport.connect(roomTopic(this.code), this.me.id, {
        onPresence: (entries) => this.handlePresence(entries),
        onBroadcast: (event, payload) => this.handleBroadcast(event, payload),
        onStatus: (status) => this.onConnection?.(status),
      });
      const seen = new Promise<void>((resolve) => (this.presenceSeen = resolve));
      // A joiner appears as "joining" (sorted after everyone) until it has seen
      // who's here, then claims a join stamp later than every existing
      // member's — so join order, and so who's host, never depends on whose
      // clock runs slow. A creator has nobody to sort against: it uses its clock.
      this.meta.joinedAt = joining ? JOINING : this.now();
      await this.transport.track(this.meta);
      await seen;
      // Our own presence can arrive well before everyone else's: give the room
      // a moment to show itself (returning as soon as anyone does).
      if (this.members.size <= 1) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.othersSeen = null;
            resolve();
          }, settleMs);
          this.othersSeen = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      const others = this.memberList().filter((m) => m.id !== this.me.id);
      if (joining) {
        const latest = Math.max(0, ...others.map((m) => m.joinedAt).filter((t) => t !== JOINING));
        this.meta.joinedAt = Math.max(this.now(), latest + 1);
      }
      this.meta.color = pickColor(others.map((m) => m.color));
      await this.transport.track(this.meta);
    } catch (err) {
      if (err instanceof RoomJoinError) throw err;
      throw new RoomJoinError('connection', err instanceof Error ? err.message : 'Could not reach the room server.');
    }
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.disconnect();
  }

  // --- derived state -------------------------------------------------------------

  get myId(): string {
    return this.me.id;
  }

  get isHost(): boolean {
    return this.hostId === this.me.id;
  }

  get state(): RoomState {
    return this.known;
  }

  /** GO in our clock, or null outside a race. */
  localStartAt(): number | null {
    return this.known.startAt === null ? null : this.isHost ? this.known.startAt : this.clock.hostToLocal(this.known.startAt);
  }

  /** How far in the past to replay remote players so a batch has always arrived. */
  get interpDelayMs(): number {
    return batchInterval(this.players.length, this.budget) * 1000 + JITTER_MS;
  }

  snapshots(id: string): SnapshotBuffer | undefined {
    return this.buffers.get(id);
  }

  private memberList(): { id: string; joinedAt: number; color: string }[] {
    return [...this.members].map(([id, m]) => ({ id, joinedAt: m.joinedAt, color: m.color }));
  }

  // --- my presence ---------------------------------------------------------------

  setName(name: string): void {
    this.meta.name = sanitizeName(name, this.meta.name);
    this.publish();
  }

  setReady(ready: boolean): void {
    this.meta.ready = ready;
    this.publish();
  }

  setStatus(status: PlayerStatus): void {
    if (this.meta.status === status) return;
    this.meta.status = status;
    if (status === 'racing') {
      this.meta.result = null;
      this.meta.ready = false; // ready is per race
    }
    this.publish();
  }

  reportFinish(result: RaceResult): void {
    this.meta.status = 'finished';
    this.meta.result = result;
    this.meta.ready = false;
    this.publish();
    this.transport.send(EVENTS.finish, { id: this.me.id, result });
    this.announceFinish(this.me.id, result);
  }

  // --- host actions --------------------------------------------------------------

  setCourse(course: CourseRef, courseKey: string): void {
    if (!this.isHost) return;
    this.setState({ ...this.known, course, courseKey });
  }

  /** Announce a race starting `delayMs` from now. Returns the new state. */
  startRace(delayMs = 4500): RoomState {
    if (!this.isHost) return this.known;
    this.firstFinishAt = null;
    this.allDoneSince = null;
    this.setState({ ...this.known, phase: 'racing', raceId: makeRaceId(this.rng), startAt: this.now() + delayMs });
    return this.known;
  }

  endRace(): void {
    if (!this.isHost || this.known.phase !== 'racing') return;
    this.setState({ ...this.known, phase: 'lobby', startAt: null });
  }

  private setState(next: RoomState): void {
    this.known = { ...next, seq: this.known.seq + 1 };
    this.publish();
    this.onChange?.();
  }

  private publish(): void {
    if (this.closed) return;
    this.meta.room = this.isHost ? this.known : null;
    void this.transport.track({ ...this.meta });
  }

  // --- movement streaming --------------------------------------------------------

  /** Queue one 20 Hz sample of our movement (race time `t` ms). Sent in batches by update(). */
  queueSample(raceId: string, t: number, pos: Vector3, vel: Vector3, yaw: number): void {
    if (this.pendingRace !== raceId) {
      this.pending = [];
      this.pendingRace = raceId;
    }
    this.pending.push(
      Math.round(t),
      Math.round(pos.x),
      Math.round(pos.y),
      Math.round(pos.z),
      Math.round(vel.x),
      Math.round(vel.y),
      Math.round(vel.z),
      Math.round(yaw * 1000),
    );
    if (this.pending.length >= SAMPLE_STRIDE * 40) this.flush();
  }

  private flush(): void {
    if (this.pending.length === 0 || !this.pendingRace) return;
    this.transport.send(EVENTS.state, { id: this.me.id, r: this.pendingRace, s: this.pending });
    this.pending = [];
    this.lastSend = this.now();
  }

  /** Drive timers: batched sends, clock-sync pings, host race bookkeeping. Call every frame. */
  update(): void {
    if (this.closed) return;
    const now = this.now();
    if (this.pending.length > 0 && now - this.lastSend >= batchInterval(this.players.length, this.budget) * 1000) this.flush();

    if (this.pingsLeft > 0 && now >= this.nextPingAt && this.hostId && !this.isHost) {
      this.pingsLeft--;
      this.nextPingAt = now + PING_SPACING_MS;
      this.transport.send(EVENTS.ping, { id: this.me.id, n: ++this.pingNonce, t0: now });
    }

    if (this.isHost && this.known.phase === 'racing') this.hostRaceDuty(now);
  }

  private startPings(): void {
    this.clock.reset();
    this.pingsLeft = PING_COUNT;
    this.nextPingAt = this.now();
  }

  private hostRaceDuty(now: number): void {
    const raceId = this.known.raceId;
    const racers = this.players.filter((p) => p.status === 'racing' || (p.status === 'finished' && p.result?.raceId === raceId));
    const finished = racers.filter((p) => p.result?.raceId === raceId);
    if (finished.length > 0 && this.firstFinishAt === null) this.firstFinishAt = now;
    const startedAt = this.known.startAt ?? now;

    const allDone = finished.length === racers.length && now >= startedAt;
    if (allDone) this.allDoneSince ??= now;
    else this.allDoneSince = null;

    const timedOut = this.firstFinishAt !== null && now - this.firstFinishAt > DNF_TIMEOUT_MS;
    if ((this.allDoneSince !== null && now - this.allDoneSince > ALL_DONE_GRACE_MS) || timedOut || now - startedAt > MAX_RACE_MS) {
      this.endRace();
    }
  }

  // --- incoming --------------------------------------------------------------------

  private handlePresence(entries: PresenceEntry[]): void {
    const next = new Map<string, PlayerMeta>();
    for (const { key, meta } of entries) {
      const parsed = PlayerMeta.safeParse(meta);
      if (parsed.success && parsed.data.v === PROTOCOL_VERSION && key.length <= 64) next.set(key, parsed.data);
    }
    const before = this.players;
    this.members = next;
    const previousHost = this.hostId;
    this.hostId = hostOf(this.memberList());

    // Room state: take the host's copy unless ours is newer (e.g. we were just promoted).
    const hostMeta = this.hostId ? next.get(this.hostId) : undefined;
    if (hostMeta?.room && (hostMeta.room.seq >= this.known.seq || this.hostId !== previousHost)) {
      if (hostMeta.room.raceId !== this.known.raceId) this.buffers.clear();
      this.known = hostMeta.room;
    }

    this.players = orderMembers(this.memberList()).map(({ id }) => {
      const m = next.get(id)!;
      return {
        id,
        name: sanitizeName(m.name),
        color: m.color,
        joinedAt: m.joinedAt,
        ready: m.ready,
        status: m.status,
        result: m.result,
        isHost: id === this.hostId,
        isMe: id === this.me.id,
      };
    });

    if (previousHost !== null && this.hostId !== previousHost) {
      if (this.isHost) this.setState(this.known); // promoted: re-publish what we know
      else this.startPings(); // new host, new clock to sync with
    }

    for (const p of before) {
      if (!next.has(p.id)) {
        this.onPlayerLeft?.(p);
        this.buffers.delete(p.id);
      }
    }
    for (const p of this.players) if (p.result) this.announceFinish(p.id, p.result);

    if (next.has(this.me.id) && this.presenceSeen) {
      const resolve = this.presenceSeen;
      this.presenceSeen = null;
      resolve();
    }
    if (this.othersSeen && [...next.keys()].some((k) => k !== this.me.id)) {
      const resolve = this.othersSeen;
      this.othersSeen = null;
      resolve();
    }
    this.onChange?.();
  }

  private handleBroadcast(event: string, payload: unknown): void {
    if (this.closed) return;
    switch (event) {
      case EVENTS.state: {
        const parsed = StateBatch.safeParse(payload);
        if (!parsed.success || parsed.data.r !== this.known.raceId || parsed.data.id === this.me.id) return;
        let buffer = this.buffers.get(parsed.data.id);
        if (!buffer) this.buffers.set(parsed.data.id, (buffer = new SnapshotBuffer()));
        const s = parsed.data.s;
        for (let i = 0; i < s.length; i += SAMPLE_STRIDE) {
          buffer.push({ t: s[i]!, x: s[i + 1]!, y: s[i + 2]!, z: s[i + 3]!, vx: s[i + 4]!, vy: s[i + 5]!, vz: s[i + 6]!, yaw: s[i + 7]! / 1000 });
        }
        return;
      }
      case EVENTS.ping: {
        const parsed = Ping.safeParse(payload);
        if (parsed.success && this.isHost) {
          this.transport.send(EVENTS.pong, { to: parsed.data.id, n: parsed.data.n, t0: parsed.data.t0, t1: this.now() });
        }
        return;
      }
      case EVENTS.pong: {
        const parsed = Pong.safeParse(payload);
        if (parsed.success && parsed.data.to === this.me.id) this.clock.addSample(parsed.data.t0, parsed.data.t1, this.now());
        return;
      }
      case EVENTS.finish: {
        const parsed = Finish.safeParse(payload);
        if (parsed.success) this.announceFinish(parsed.data.id, parsed.data.result);
        return;
      }
    }
  }

  private announceFinish(id: string, result: RaceResult): void {
    if (result.raceId !== this.known.raceId) return;
    const key = `${id}:${result.raceId}`;
    if (this.announced.has(key)) return;
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    this.announced.add(key);
    this.onFinish?.(player, result);
  }
}
