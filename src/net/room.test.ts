import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MemoryHub } from './memoryTransport.js';
import { Room, RoomJoinError, type RoomOptions } from './room.js';
import { MAX_PLAYERS } from './roomLogic.js';
import type { CourseRef } from './protocol.js';
import { createRng } from '../util/rng.js';

const COURSE: { course: CourseRef; courseKey: string } = { course: { kind: 'shipped', id: 'tutorial' }, courseKey: 'c3-abc' };

/** A shared fake clock; each client may run fast or slow by `skew` ms. */
class Clock {
  t = 1_000_000;
  at(skew = 0): () => number {
    return () => this.t + skew;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

function setup(existingMembersDelayMs = 0) {
  const hub = new MemoryHub(existingMembersDelayMs);
  const clock = new Clock();
  let seed = 1;
  const opts = (skew = 0): RoomOptions => ({
    transport: hub.transport(),
    now: clock.at(skew),
    budget: 80,
    rng: createRng(seed++),
    joinSettleMs: 150,
  });
  return { hub, clock, opts };
}

const expectJoinError = async (p: Promise<unknown>, kind: string): Promise<void> => {
  await expect(p).rejects.toBeInstanceOf(RoomJoinError);
  await p.catch((e: RoomJoinError) => expect(e.kind).toBe(kind));
};

/** Let both rooms run their timers (pings, batches) for `ms`. */
function run(clock: Clock, rooms: Room[], ms: number, step = 10): void {
  for (let t = 0; t < ms; t += step) {
    clock.advance(step);
    for (const r of rooms) r.update();
  }
}

describe('Room', () => {
  it('creates a room with a fresh code that someone else can join', async () => {
    const { opts } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    expect(host.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    const guest = await Room.join(opts(), host.code.toLowerCase(), { id: 'g', name: '  Gus  ' });

    for (const r of [host, guest]) {
      expect(r.players.map((p) => p.name)).toEqual(['Hana', 'Gus']);
      expect(r.hostId).toBe('h');
    }
    expect(host.isHost).toBe(true);
    expect(guest.isHost).toBe(false);
    expect(new Set(guest.players.map((p) => p.color)).size).toBe(2);
    expect(guest.state.course).toEqual(COURSE.course);
  });

  it('waits for the rest of the room when it arrives after our own presence (as on Supabase)', async () => {
    const { opts } = setup(60);
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const guest = await Room.join(opts(), host.code, { id: 'g', name: 'Gus' });
    expect(guest.players.map((p) => p.id)).toEqual(['h', 'g']);
    expect(guest.hostId).toBe('h');
    expect(guest.players[1]!.color).not.toBe(guest.players[0]!.color);
  });

  it('rejects malformed codes and codes nobody is using', async () => {
    const { opts } = setup();
    await expectJoinError(Room.join(opts(), 'AB1', { id: 'x', name: 'X' }), 'invalid-code');
    await expectJoinError(Room.join(opts(), 'ZZZZ', { id: 'x', name: 'X' }), 'not-found');
  });

  it(`turns away player ${MAX_PLAYERS + 1}`, async () => {
    const { opts, hub } = setup();
    const host = await Room.create(opts(), { id: 'p0', name: 'P0' }, COURSE);
    for (let i = 1; i < MAX_PLAYERS; i++) await Room.join(opts(), host.code, { id: `p${i}`, name: `P${i}` });
    await expectJoinError(Room.join(opts(), host.code, { id: 'late', name: 'Late' }), 'full');
    expect(hub.members(`surfduel:${host.code}`)).toBe(MAX_PLAYERS);
  });

  it('promotes the next player when the host leaves, keeping the room state', async () => {
    const { opts } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const a = await Room.join(opts(), host.code, { id: 'a', name: 'Ann' });
    const b = await Room.join(opts(), host.code, { id: 'b', name: 'Bo' });
    host.setCourse({ kind: 'random', seed: 77 }, 'c3-random');
    await host.leave();
    for (const r of [a, b]) {
      expect(r.hostId).toBe('a');
      expect(r.state.course).toEqual({ kind: 'random', seed: 77 });
    }
    expect(a.isHost).toBe(true);
    // The new host can run the room.
    a.setCourse({ kind: 'shipped', id: 'speed-demon' }, 'c3-sd');
    expect(b.state.course).toEqual({ kind: 'shipped', id: 'speed-demon' });
  });

  it('starts a race for everyone at the same moment, despite skewed clocks', async () => {
    const { opts, clock } = setup();
    const host = await Room.create(opts(0), { id: 'h', name: 'Hana' }, COURSE);
    const guest = await Room.join(opts(-7000), host.code, { id: 'g', name: 'Gus' }); // guest's clock 7 s behind
    run(clock, [host, guest], 600); // ping exchanges
    expect(guest.clock.offset).toBeCloseTo(7000, 0);

    const state = host.startRace(4000);
    expect(state.phase).toBe('racing');
    expect(guest.state.raceId).toBe(state.raceId);
    // Both agree GO is 4 s from now, each on their own clock.
    expect(host.localStartAt()! - clock.at(0)()).toBeCloseTo(4000, 0);
    expect(guest.localStartAt()! - clock.at(-7000)()).toBeCloseTo(4000, 0);
  });

  it('streams 20 Hz samples, batching more as the room grows', async () => {
    const { opts, clock, hub } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const guest = await Room.join(opts(), host.code, { id: 'g', name: 'Gus' });
    const { raceId } = host.startRace(0);
    const pos = new Vector3();
    const vel = new Vector3(1000, 0, 0);
    for (let t = 0; t <= 1000; t += 50) {
      pos.set(t, 0, 0);
      host.queueSample(raceId!, t, pos, vel, 0);
      run(clock, [host, guest], 50);
    }
    const out = new Vector3();
    guest.snapshots('h')!.sample(500, out);
    expect(out.x).toBeCloseTo(500, 0);
    const twoPlayerSends = hub.sent.filter(([, e]) => e === 'st').length;
    expect(twoPlayerSends).toBeGreaterThanOrEqual(18); // ~one message per sample

    // Six more players: same samples, far fewer messages.
    for (let i = 0; i < 6; i++) await Room.join(opts(), host.code, { id: `x${i}`, name: `X${i}` });
    hub.sent.length = 0;
    for (let t = 1050; t <= 2050; t += 50) {
      host.queueSample(raceId!, t, pos.set(t, 0, 0), vel, 0);
      run(clock, [host, guest], 50);
    }
    expect(hub.sent.filter(([, e]) => e === 'st').length).toBeLessThan(twoPlayerSends / 4);
    guest.snapshots('h')!.sample(1800, out);
    expect(out.x).toBeCloseTo(1800, 0);
  });

  it('tells everyone when a player finishes, once', async () => {
    const { opts } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const guest = await Room.join(opts(), host.code, { id: 'g', name: 'Gus' });
    const feed: string[] = [];
    host.onFinish = (p, r) => feed.push(`${p.name} ${r.timeMs}`);
    const { raceId } = host.startRace(0);
    guest.setStatus('racing');
    guest.reportFinish({ raceId: raceId!, timeMs: 62_480, splits: [20_000] });
    expect(feed).toEqual(['Gus 62480']);
    expect(host.players.find((p) => p.id === 'g')?.result?.timeMs).toBe(62_480);
  });

  it('host returns the room to the lobby once every racer is done', async () => {
    const { opts, clock } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const guest = await Room.join(opts(), host.code, { id: 'g', name: 'Gus' });
    const { raceId } = host.startRace(0);
    host.setStatus('racing');
    guest.setStatus('racing');
    host.reportFinish({ raceId: raceId!, timeMs: 30_000, splits: [] });
    run(clock, [host, guest], 5000);
    expect(guest.state.phase).toBe('racing'); // guest still going
    guest.reportFinish({ raceId: raceId!, timeMs: 31_000, splits: [] });
    run(clock, [host, guest], 5000);
    expect(guest.state.phase).toBe('lobby');
  });

  it('lets a late joiner see the race already under way', async () => {
    const { opts } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    host.startRace(0);
    const late = await Room.join(opts(), host.code, { id: 'l', name: 'Lou' });
    expect(late.state.phase).toBe('racing');
  });

  it('ignores garbage on the wire', async () => {
    const { opts, hub } = setup();
    const host = await Room.create(opts(), { id: 'h', name: 'Hana' }, COURSE);
    const evil = hub.transport();
    await evil.connect(`surfduel:${host.code}`, 'evil', { onPresence() {}, onBroadcast() {}, onStatus() {} });
    await evil.track({ v: 1, name: 5, color: 'red' });
    evil.send('st', { id: 'evil', r: 'x', s: [1, 2, 3] });
    evil.send('fin', { nope: true });
    evil.send('ping', 'not an object' as unknown as object);
    expect(host.players.map((p) => p.id)).toEqual(['h']);
  });
});
