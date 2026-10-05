import { describe, expect, it } from 'vitest';
import { SUBMIT_LIMITS, handleSubmitRun, type RunRow, type RunStore, type StoreOutcome, type SubmitDeps, type SubmitLimits } from './submitRun';
import { buildCourse } from '../src/course/builder';
import { SHIPPED_COURSES } from '../src/course/courses';
import { courseKey } from '../src/course/courseKey';
import { simulateRun } from '../src/course/simulate';
import { GhostRecorder, encodeGhost } from '../src/game/ghost';

const PLAYER = '6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f';
const spec = (id: string) => SHIPPED_COURSES.find((c) => c.id === id)!.spec;

/** A real bot run on Easy Cruise, as the game would submit it. */
const built = buildCourse(spec('easy-cruise'));
const botRun = (() => {
  const recorder = new GhostRecorder();
  recorder.tick(0, built.spawn.pos, built.spawn.heading);
  const splits: (number | null)[] = Array.from({ length: built.checkpoints.length - 1 }, () => null);
  const result = simulateRun(built, { hop: false }, 300, 0, {
    onTick: (player, tick, cmd) => recorder.tick(tick, player.pos, cmd.yaw),
    onEvent: (event, tick) => {
      if (event.type === 'checkpoint' && splits[event.index - 1] === null) splits[event.index - 1] = tick * 10;
    },
  });
  if (!result.finished) throw new Error('bot did not finish');
  return { timeMs: Math.round(result.time * 1000), splits, ghost: recorder.data() };
})();
const goodBody = () => ({
  course: { kind: 'shipped', id: 'easy-cruise' },
  playerId: PLAYER,
  name: 'Wave Rider',
  timeMs: botRun.timeMs,
  splits: botRun.splits,
  ghost: encodeGhost(botRun.ghost),
});

/** Same rules as the submit_run SQL function, in memory. */
class FakeRunStore implements RunStore {
  rows: (RunRow & { id: string })[] = [];
  submissions: string[] = [];
  shared = new Map<string, unknown>();
  fail = false;
  lastLimits: SubmitLimits | null = null;
  async courseSpec(code: string): Promise<unknown | null> {
    if (this.fail) throw new Error('db down');
    return this.shared.get(code) ?? null;
  }
  async submit(row: RunRow, ipHash: string, limits: SubmitLimits): Promise<StoreOutcome> {
    if (this.fail) throw new Error('db down');
    this.lastLimits = limits;
    if (this.submissions.length >= limits.globalPerDay) return { status: 'global-day' };
    if (this.submissions.filter((h) => h === ipHash).length >= limits.perIpWindow) return { status: 'ip-window' };
    this.submissions.push(ipHash);
    let mine = this.rows.find((r) => r.courseKey === row.courseKey && r.playerId === row.playerId);
    if (!mine) {
      mine = { ...row, id: `run-${this.rows.length + 1}` };
      this.rows.push(mine);
    } else {
      mine.playerName = row.playerName;
      if (row.timeMs < mine.timeMs) Object.assign(mine, { timeMs: row.timeMs, splits: row.splits, ghost: row.ghost, assist: row.assist });
    }
    const board = this.rows.filter((r) => r.courseKey === row.courseKey);
    return {
      status: mine.timeMs === row.timeMs ? 'ok' : 'kept',
      runId: mine.id,
      place: 1 + board.filter((r) => r.timeMs < mine.timeMs).length,
      total: board.length,
      bestMs: mine.timeMs,
    };
  }
}

function setup() {
  const store = new FakeRunStore();
  const deps: SubmitDeps = { store, hashIp: (ip) => `h:${ip}` };
  return { store, deps };
}

describe('handleSubmitRun: accepted runs', () => {
  it('checks a real run and stores it under the course key the server works out itself', async () => {
    const { store, deps } = setup();
    const res = await handleSubmitRun(goodBody(), '1.2.3.4', deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, improved: true, place: 1, total: 1, bestMs: botRun.timeMs, name: 'Wave Rider' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      courseKey: courseKey(built.course),
      courseRef: 'shipped:easy-cruise',
      playerId: PLAYER,
      playerName: 'Wave Rider',
      timeMs: botRun.timeMs,
      splits: botRun.splits,
      ghost: goodBody().ghost,
    });
  });

  it('keeps your best: a slower run only updates your name', async () => {
    const { store, deps } = setup();
    await handleSubmitRun(goodBody(), '1.2.3.4', deps);
    store.rows[0]!.timeMs -= 1000; // pretend an earlier run was faster
    const res = await handleSubmitRun({ ...goodBody(), name: 'New Name' }, '1.2.3.4', deps);
    expect(res.body).toMatchObject({ ok: true, improved: false, bestMs: botRun.timeMs - 1000, name: 'New Name' });
    expect(store.rows[0]!.playerName).toBe('New Name');
  });

  it('records whether assist mode was on (unassisted when the client does not say)', async () => {
    const { store, deps } = setup();
    await handleSubmitRun(goodBody(), '1.2.3.4', deps);
    expect(store.rows[0]!.assist).toBe(false);
    await handleSubmitRun({ ...goodBody(), playerId: '7f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f', assist: true }, '1.2.3.4', deps);
    expect(store.rows[1]!.assist).toBe(true);
    expect((await handleSubmitRun({ ...goodBody(), assist: 'yes' }, '1.2.3.4', deps)).status).toBe(400);
  });

  it('loads shared (AI) courses by share code', async () => {
    const { store, deps } = setup();
    store.shared.set('K7M2QX', spec('easy-cruise'));
    const res = await handleSubmitRun({ ...goodBody(), course: { kind: 'code', code: 'k7m2qx' } }, '1.2.3.4', deps);
    expect(res.status).toBe(200);
    expect(store.rows[0]!.courseRef).toBe('code:K7M2QX');
  });

  it('cleans the name, and replaces one other players should not see', async () => {
    const { store, deps } = setup();
    await handleSubmitRun({ ...goodBody(), name: '  Big   Wave Rider Extraordinaire ' }, '1.2.3.4', deps);
    expect(store.rows[0]!.playerName).toBe('Big Wave Rider E');
    for (const name of ['sh1t lord', 'visit evil.com', '‮​']) {
      const res = await handleSubmitRun({ ...goodBody(), name }, '1.2.3.4', deps);
      expect(res.body, name).toMatchObject({ ok: true, name: 'Surfer' });
    }
  });
});

describe('handleSubmitRun: refused runs', () => {
  it('needs a well-formed body', async () => {
    const { store, deps } = setup();
    const good = goodBody();
    for (const body of [
      null,
      {},
      { ...good, playerId: 'not-a-uuid' },
      { ...good, timeMs: 12.5 },
      { ...good, timeMs: -1 },
      { ...good, splits: 'x' },
      { ...good, ghost: 'A'.repeat(200_001) },
      { ...good, name: 'x'.repeat(100) },
      { ...good, course: { kind: 'random', seed: 1 } },
      { ...good, course: { kind: 'code', code: 'nope!' } },
    ]) {
      const res = await handleSubmitRun(body, '1.2.3.4', deps);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(store.rows).toEqual([]);
  });

  it('says when the course does not exist', async () => {
    const { deps } = setup();
    expect((await handleSubmitRun({ ...goodBody(), course: { kind: 'shipped', id: 'nope' } }, '1.2.3.4', deps)).status).toBe(404);
    expect((await handleSubmitRun({ ...goodBody(), course: { kind: 'code', code: 'ABCDEF' } }, '1.2.3.4', deps)).status).toBe(404);
  });

  it('refuses an implausible run and says why (nothing is stored)', async () => {
    const { store, deps } = setup();
    const res = await handleSubmitRun({ ...goodBody(), timeMs: Math.round(botRun.timeMs / 2) }, '1.2.3.4', deps);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ ok: false, reason: 'implausible' });
    expect(store.rows).toEqual([]);
  });

  it('refuses a ghost that does not decode, or belongs to another course', async () => {
    const { deps } = setup();
    expect((await handleSubmitRun({ ...goodBody(), ghost: 'not*base64' }, '1.2.3.4', deps)).status).toBe(422);
    const other = await handleSubmitRun({ ...goodBody(), course: { kind: 'shipped', id: 'speed-demon' } }, '1.2.3.4', deps);
    expect(other.status).toBe(422);
  });

  it('rate-limits per player IP and in total, using the database', async () => {
    const { store, deps } = setup();
    for (let i = 0; i < SUBMIT_LIMITS.perIpWindow; i++) expect((await handleSubmitRun(goodBody(), '1.2.3.4', deps)).status).toBe(200);
    const res = await handleSubmitRun(goodBody(), '1.2.3.4', deps);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect((await handleSubmitRun(goodBody(), '5.6.7.8', deps)).status).toBe(200);
    expect(store.lastLimits).toEqual({ windowMs: SUBMIT_LIMITS.windowMs, perIpWindow: SUBMIT_LIMITS.perIpWindow, globalPerDay: SUBMIT_LIMITS.globalPerDay });
  });

  it('is unavailable without a database, or when it is down', async () => {
    const { store, deps } = setup();
    expect((await handleSubmitRun(goodBody(), '1.2.3.4', { ...deps, store: null })).status).toBe(503);
    store.fail = true;
    expect((await handleSubmitRun(goodBody(), '1.2.3.4', deps)).status).toBe(503);
  });
});
