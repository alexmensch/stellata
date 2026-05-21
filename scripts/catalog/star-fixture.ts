// Default-valued Star factory for catalog-pipeline tests.

import type { Star } from './stars-parse';

export function makeStar(overrides: Partial<Star> = {}): Star {
  return {
    x: 0,
    y: 0,
    z: 0,
    absmag: 0,
    ci: 0,
    spectClass: 0,
    lumClass: 0,
    physicalRadius: 1,
    conIndex: 255,
    flags: 0,
    proper: null,
    bayer: null,
    hip: null,
    hd: null,
    hr: null,
    flam: null,
    gl: null,
    gaiaSourceId: null,
    spectDisplay: null,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    athygDist: null,
    athygDistSrc: null,
    ...overrides,
  };
}
