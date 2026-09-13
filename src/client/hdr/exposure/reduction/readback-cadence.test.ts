import { describe, expect, it } from 'vitest';
import { ReadbackCadence } from './readback-cadence';

/** One dwell of `frames` frames: `landAfter` frames after a request goes
 *  out, the readback lands. Returns the requests issued. */
function requestsOver(cadence: ReadbackCadence, frames: number, landAfter: number): number {
  let inFlightSince: number | null = null;
  let issued = 0;
  for (let f = 0; f < frames; f++) {
    if (inFlightSince !== null && f - inFlightSince >= landAfter) inFlightSince = null;
    const due = cadence.dueThisFrame();
    if (inFlightSince !== null || !due) continue;
    issued += 1;
    inFlightSince = f;
    cadence.issued();
  }
  return issued;
}

describe('the emergent rate', () => {
  it('admits every frame, leaving the round trip to set the rate', () => {
    expect(requestsOver(new ReadbackCadence(), 240, 1)).toBe(240);
    expect(requestsOver(new ReadbackCadence(), 240, 4)).toBe(60);
  });
});

describe('a pinned cadence', () => {
  it('holds one request per `every` frames whatever the round trip is', () => {
    for (const landAfter of [1, 2, 3, 4]) {
      expect(requestsOver(Object.assign(new ReadbackCadence(), { every: 4 }), 240, landAfter))
        .toBe(60);
    }
  });

  it('caps the rate rather than raising it: a round trip past the cadence slips', () => {
    // Requested on frame 6, landing on frame 12, so the 8th and 12th slots
    // pass under a readback in flight and the period stretches to 6.
    expect(requestsOver(Object.assign(new ReadbackCadence(), { every: 4 }), 240, 6)).toBe(40);
  });

  it('counts rendered frames, not the frames a request could go out on', () => {
    const cadence = new ReadbackCadence();
    cadence.every = 3;
    expect([1, 2, 3, 4, 5, 6].map(() => {
      const due = cadence.dueThisFrame();
      if (due) cadence.issued();
      return due;
    })).toEqual([false, false, true, false, false, true]);
  });

  it('resets the count', () => {
    const cadence = new ReadbackCadence();
    cadence.every = 2;
    expect(cadence.dueThisFrame()).toBe(false);
    cadence.reset();
    expect(cadence.dueThisFrame()).toBe(false);
    expect(cadence.dueThisFrame()).toBe(true);
  });
});
