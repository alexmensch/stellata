import { describe, expect, it } from 'vitest';

import { NO_DESIGNATION_CON } from './designation-constellation-pure';
import { designationConstellation } from './apply-designation-constellation';

describe('designationConstellation', () => {
  it('answers IV/27A\'s constellation sourced to IV/27A, and none for a record it does not reach', () => {
    const index = { byHd: new Map([[216956, 5]]), byHip: new Map() };
    expect(designationConstellation(index, { hd: 216956, hip: null })).toEqual({ via: 'iv27a', index: 5 });
    expect(designationConstellation(index, { hd: 1, hip: null })).toEqual(NO_DESIGNATION_CON);
  });
});
