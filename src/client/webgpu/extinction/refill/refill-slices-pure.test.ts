import { describe, expect, it } from 'vitest';
import {
  REFILL_SLICES, idleRefill, planFrame, planRefill, refillSliceLength, type RefillCursor,
} from './refill-slices-pure';

const COUNT = 100;
const SLICE = refillSliceLength(COUNT, 4);

/** Runs `frames` updates and returns, per slot, the frame it was last
 *  refilled on — -1 for a slot no dispatch reached. */
function coverage(wantedPerFrame: readonly boolean[], count = COUNT, slice = SLICE): number[] {
  const filled = new Array<number>(count).fill(-1);
  let cursor = idleRefill(count);
  for (const [frame, wanted] of wantedPerFrame.entries()) {
    const plan = planRefill(cursor, wanted, count, slice);
    if (plan.base !== null) {
      for (let i = plan.base; i < plan.base + plan.length; i++) filled[i] = frame;
    }
    cursor = plan.next;
  }
  return filled;
}

describe('refillSliceLength', () => {
  it('divides the catalogue into the slice count, last slice short', () => {
    expect(refillSliceLength(100, 4)).toBe(25);
    expect(refillSliceLength(101, 4)).toBe(26);
    expect(refillSliceLength(388_071, REFILL_SLICES)).toBe(97_018);
  });

  it('never returns zero, so a cursor cannot stall', () => {
    expect(refillSliceLength(0, 4)).toBe(1);
    expect(refillSliceLength(1, 4)).toBe(1);
    expect(refillSliceLength(3, 0)).toBe(3);
  });
});

describe('planRefill', () => {
  it('dispatches nothing while idle and unwanted', () => {
    const plan = planRefill(idleRefill(COUNT), false, COUNT, SLICE);
    expect(plan.base).toBeNull();
    expect(plan.length).toBe(0);
  });

  it('starts a cycle at slot 0 when a refill is wanted from idle', () => {
    const plan = planRefill(idleRefill(COUNT), true, COUNT, SLICE);
    expect(plan.base).toBe(0);
    expect(plan.length).toBe(SLICE);
  });

  it('runs the cycle out with no further request', () => {
    let cursor: RefillCursor = idleRefill(COUNT);
    const bases: (number | null)[] = [];
    for (let frame = 0; frame < 6; frame++) {
      const plan = planRefill(cursor, frame === 0, COUNT, SLICE);
      bases.push(plan.base);
      cursor = plan.next;
    }
    expect(bases).toEqual([0, 25, 50, 75, null, null]);
  });

  it('shortens the last slice rather than running past the catalogue', () => {
    let cursor: RefillCursor = idleRefill(101);
    const slice = refillSliceLength(101, 4);
    const spans: [number, number][] = [];
    for (let frame = 0; frame < 4; frame++) {
      const plan = planRefill(cursor, frame === 0, 101, slice);
      if (plan.base !== null) spans.push([plan.base, plan.length]);
      cursor = plan.next;
    }
    expect(spans).toEqual([[0, 26], [26, 26], [52, 26], [78, 23]]);
    expect(spans.reduce((n, [, len]) => n + len, 0)).toBe(101);
  });

  it('dispatches nothing when the catalogue is empty', () => {
    expect(planRefill(idleRefill(0), true, 0, 1).base).toBeNull();
  });
});

describe('planFrame', () => {
  it('sweeps the whole range when only the view moved and no cycle is running', () => {
    const plan = planFrame(idleRefill(COUNT), false, true, COUNT, SLICE);
    expect(plan.refill.base).toBeNull();
    expect(plan.sweep).toBe(true);
  });

  it('runs the slice, not a sweep, while a cycle is running or wanted', () => {
    expect(planFrame(idleRefill(COUNT), true, true, COUNT, SLICE).sweep).toBe(false);
    const mid: RefillCursor = { base: SLICE, pending: false };
    const plan = planFrame(mid, false, true, COUNT, SLICE);
    expect(plan.refill.base).toBe(SLICE);
    expect(plan.sweep).toBe(false);
  });

  it('dispatches nothing at a parked camera and a still view', () => {
    const plan = planFrame(idleRefill(COUNT), false, false, COUNT, SLICE);
    expect(plan.refill.base).toBeNull();
    expect(plan.sweep).toBe(false);
  });

  it('never sweeps an empty catalogue', () => {
    expect(planFrame(idleRefill(0), false, true, 0, 1).sweep).toBe(false);
  });
});

describe('a request never restarts a running cycle', () => {
  it('keeps advancing rather than returning to slot 0 every frame', () => {
    const filled = coverage(Array<boolean>(8).fill(true));
    expect(filled.every((frame) => frame >= 0)).toBe(true);
  });

  it('cycles one slice per frame while the request keeps firing', () => {
    const filled = coverage(Array<boolean>(8).fill(true));
    expect(filled[0]).toBe(4);
    expect(filled[25]).toBe(5);
    expect(filled[50]).toBe(6);
    expect(filled[75]).toBe(7);
  });
});

describe('every star is refilled within REFILL_SLICES frames of a request', () => {
  /** Per slot, the first frame at or after `from` on which it was refilled,
   *  or Infinity if none was. */
  function firstRefillFrom(wantedPerFrame: readonly boolean[], from: number): number[] {
    const first = new Array<number>(COUNT).fill(Infinity);
    let cursor = idleRefill(COUNT);
    for (const [frame, wanted] of wantedPerFrame.entries()) {
      const plan = planRefill(cursor, wanted, COUNT, SLICE);
      if (plan.base !== null && frame >= from) {
        for (let i = plan.base; i < plan.base + plan.length; i++) {
          first[i] = Math.min(first[i] ?? Infinity, frame);
        }
      }
      cursor = plan.next;
    }
    return first;
  }

  // The slowest slot lands on exactly the last frame of the bound, so this
  // pins the bound TIGHT: an over-eager wrap that re-covered slots the
  // request did not need would pass an inequality and fail this.
  it('holds wherever in the cycle the request lands, and is exact', () => {
    for (let requestFrame = 0; requestFrame < 2 * REFILL_SLICES; requestFrame++) {
      const wanted = Array<boolean>(requestFrame + 2 * REFILL_SLICES).fill(false);
      wanted[0] = true;
      wanted[requestFrame] = true;
      const first = firstRefillFrom(wanted, requestFrame);
      expect(Math.max(...first), `request on frame ${requestFrame}`)
        .toBe(requestFrame + REFILL_SLICES - 1);
    }
  });
});

describe('what a request costs in total', () => {
  // The wrap restarts at slot 0 and clears `pending`, so the cycle it starts
  // runs to the end rather than stopping where the request arrived —
  // README.md § The spike is the problem, not the total.
  it('charges a mid-cycle request the slices it owed plus a whole cycle', () => {
    const wanted = Array<boolean>(3 * REFILL_SLICES).fill(false);
    wanted[0] = true;
    wanted[1] = true;
    let cursor = idleRefill(COUNT);
    let slots = 0;
    for (const w of wanted) {
      const plan = planRefill(cursor, w, COUNT, SLICE);
      slots += plan.length;
      cursor = plan.next;
    }
    expect(slots).toBe(2 * COUNT);
  });

  it('charges a request from a parked cursor exactly one cycle', () => {
    const wanted = Array<boolean>(3 * REFILL_SLICES).fill(false);
    wanted[0] = true;
    let cursor = idleRefill(COUNT);
    let slots = 0;
    for (const w of wanted) {
      const plan = planRefill(cursor, w, COUNT, SLICE);
      slots += plan.length;
      cursor = plan.next;
    }
    expect(slots).toBe(COUNT);
  });
});
