import { describe, expect, it } from 'vitest';
import {
  REFILL_SLICES, idleRefill, planRefill, refillInFlight, refillQuarterOf, type RefillCursor,
} from './refill-slices-pure';

describe('the quarter partition', () => {
  it.each([1, 5, 100, 101, 4096])('is exactly `self %% REFILL_SLICES` at %i', (count) => {
    const classSize = (q: number) => Math.max(0, Math.floor((count - 1 - q) / REFILL_SLICES) + 1);
    const sizes = new Array<number>(REFILL_SLICES).fill(0);
    for (let star = 0; star < count; star++) sizes[refillQuarterOf(star)]++;
    expect(sizes).toEqual(Array.from({ length: REFILL_SLICES }, (_, q) => classSize(q)));
    expect(sizes.reduce((n, s) => n + s, 0)).toBe(count);
  });
});

describe('planRefill', () => {
  it('dispatches nothing while parked and unwanted, and stays parked', () => {
    const plan = planRefill(idleRefill(), false);
    expect(plan.dispatch).toBe(false);
    expect(plan.arm).toBe(false);
    expect(plan.next).toEqual(idleRefill());
    expect(refillInFlight(plan.next)).toBe(false);
  });

  // The compaction builds one class this frame; the march starts next
  // frame, since the prepass runs ahead of the compaction in the frame.
  it('a request arms the producer this frame and marches nothing yet', () => {
    const plan = planRefill(idleRefill(), true);
    expect(plan.arm).toBe(true);
    expect(plan.dispatch).toBe(false);
    expect(plan.next).toEqual({ owed: REFILL_SLICES - 1, quarter: 0, built: true });
    expect(refillInFlight(plan.next)).toBe(true);
  });

  // Built classes 0..3 on frames 0..3, marched one frame later each; the
  // arm drops on the frame the last class marches.
  it('builds one class an armed frame, marches it the next, every class once, and parks', () => {
    let cursor: RefillCursor = idleRefill();
    const marched: (number | null)[] = [];
    const built: (number | null)[] = [];
    for (let frame = 0; frame < REFILL_SLICES + 3; frame++) {
      const plan = planRefill(cursor, frame === 0);
      marched.push(plan.dispatch ? plan.quarter : null);
      built.push(plan.arm ? plan.next.quarter : null);
      cursor = plan.next;
    }
    expect(built).toEqual([0, 1, 2, 3, null, null, null]);
    expect(marched).toEqual([null, 0, 1, 2, 3, null, null]);
    expect(refillInFlight(cursor)).toBe(false);
  });

  it('a request landing mid-flight owes every class again', () => {
    let cursor: RefillCursor = idleRefill();
    const built: (number | null)[] = [];
    for (let frame = 0; frame < 2 * REFILL_SLICES + 2; frame++) {
      const plan = planRefill(cursor, frame === 0 || frame === 2);
      built.push(plan.arm ? plan.next.quarter : null);
      cursor = plan.next;
    }
    expect(built).toEqual([0, 1, 2, 3, 0, 1, null, null, null, null]);
  });

  it('the class advances only on a march, so the one built is the one marched next', () => {
    const parked = planRefill({ owed: 0, quarter: 2, built: false }, false);
    expect(parked.next.quarter).toBe(2);
    const armed = planRefill({ owed: 0, quarter: 2, built: false }, true);
    expect(armed.next.quarter).toBe(2);
    const marched = planRefill({ owed: 0, quarter: 3, built: true }, false);
    expect(marched.dispatch).toBe(true);
    expect(marched.quarter).toBe(3);
    expect(marched.next.quarter).toBe(0);
    expect(marched.arm).toBe(false);
  });
});

/** The producer and the consumer over a CPU catalogue: per frame the
 *  generation bumps on a request, the built class is marched at the current
 *  generation, then an armed compaction builds one class from the stars of
 *  that residue still stale. Returns, per star, the frames it was marched
 *  on, and the longest wait any star had from the request that made it stale
 *  to the march that stamped it. */
function simulate(count: number, wantedPerFrame: readonly boolean[]) {
  const stamps = new Array<number>(count).fill(0);
  const staleSince = new Array<number>(count).fill(0);
  let generation = 1;
  let cursor = idleRefill();
  let list: number[] = [];
  let listQuarter: number | null = null;
  const marchedOn: number[][] = Array.from({ length: count }, () => []);
  let longestWait = 0;
  for (const [frame, wanted] of wantedPerFrame.entries()) {
    if (wanted) {
      generation++;
      for (let star = 0; star < count; star++) {
        if (stamps[star] === generation - 1) staleSince[star] = frame;
      }
    }
    const plan = planRefill(cursor, wanted);
    if (plan.dispatch) {
      // The one region holds only the class built last frame, so the march
      // has to want exactly that one (README.md § One region).
      expect(listQuarter).toBe(plan.quarter);
      for (const star of list) {
        stamps[star] = generation;
        marchedOn[star].push(frame);
        longestWait = Math.max(longestWait, frame - staleSince[star]);
      }
    }
    if (plan.arm) {
      const q = plan.next.quarter;
      list = [];
      listQuarter = q;
      for (let star = 0; star < count; star++) {
        if (refillQuarterOf(star) === q && stamps[star] !== generation) list.push(star);
      }
    }
    cursor = plan.next;
  }
  return { marchedOn, longestWait, stale: stamps.filter((s) => s !== generation).length };
}

describe('every stale star is marched within REFILL_SLICES frames of the request', () => {
  const COUNT = 103;

  it('a lone request marches the whole stale set exactly once, the last class on the bound', () => {
    const wanted = Array<boolean>(3 * REFILL_SLICES).fill(false);
    wanted[0] = true;
    const { marchedOn, stale, longestWait } = simulate(COUNT, wanted);
    expect(stale).toBe(0);
    for (const frames of marchedOn) expect(frames).toHaveLength(1);
    expect(longestWait).toBe(REFILL_SLICES);
  });

  // A request every frame builds one class every frame, and a star's
  // residue never moves, so it is marched on exactly every fourth frame.
  it('under a request every frame no star waits more than REFILL_SLICES frames', () => {
    const frames = 4 * REFILL_SLICES;
    const { marchedOn, longestWait } = simulate(COUNT, Array<boolean>(frames).fill(true));
    expect(longestWait).toBeLessThanOrEqual(REFILL_SLICES);
    for (const f of marchedOn) {
      expect(f.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < f.length; i++) expect(f[i] - f[i - 1]).toBe(REFILL_SLICES);
    }
  });

  it('holds wherever in a flight a second request lands, and closes on settle', () => {
    for (let second = 1; second <= REFILL_SLICES + 1; second++) {
      const wanted = Array<boolean>(second + 2 * REFILL_SLICES + 1).fill(false);
      wanted[0] = true;
      wanted[second] = true;
      const { stale, longestWait } = simulate(COUNT, wanted);
      expect(stale, `second request on frame ${second}`).toBe(0);
      expect(longestWait, `second request on frame ${second}`).toBeLessThanOrEqual(REFILL_SLICES);
    }
  });
});
