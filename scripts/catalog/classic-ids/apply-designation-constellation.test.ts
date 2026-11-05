import { describe, expect, it } from 'vitest';

import { makeStar } from '../parse/star-fixture';
import { NO_DESIGNATION_CON } from './designation-constellation-pure';
import { applyDesignationConstellations } from './apply-designation-constellation';

describe('applyDesignationConstellations', () => {
  it('writes IV/27A\'s constellation sourced to IV/27A, and leaves a record it does not reach', () => {
    const reached = makeStar({ hd: 216956 });
    const unreached = makeStar({ hd: 1 });
    const counts = applyDesignationConstellations([reached, unreached], {
      desigCon: { byHd: new Map([[216956, 5]]), byHip: new Map() },
      crossIndexUnknownCst: 0,
    });
    expect(reached.desigCon).toEqual({ via: 'iv27a', index: 5 });
    expect(unreached.desigCon).toEqual(NO_DESIGNATION_CON);
    expect(counts.desigConFromCrossIndex).toBe(1);
  });
});
