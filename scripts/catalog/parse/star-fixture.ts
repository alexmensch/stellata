// Default-valued Star factory for catalog-pipeline tests.

import { NO_CONSTELLATION_INDEX } from '../catalog-pure';
import type { Star } from './stars-parse';

export function makeStar(overrides: Partial<Star> = {}): Star {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    absmag: 0,
    ci: 0,
    spectClass: 0,
    lumClass: 0,
    physicalRadius: 1,
    conIndex: NO_CONSTELLATION_INDEX,
    desigConIndex: NO_CONSTELLATION_INDEX,
    flags: 0,
    proper: null,
    iauName: null,
    eponym: null,
    bayer: null,
    bayerSup: null,
    bayerComponent: null,
    gould: null,
    gouldHalf: null,
    aliases: [],
    hip: null,
    hd: null,
    hr: null,
    hdAlt: [],
    hrAlt: [],
    flam: null,
    gl: null,
    tyc: null,
    gaiaSourceId: null,
    spectDisplay: null,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    varType: 0,
    gcvsName: null,
    athygDist: null,
    athygDistSrc: null,
    distVia: 'bailer_jones',
    // The production majority (310,939 of 313,257), so a test whose star must
    // read as a system blend has to opt into a printed tier explicitly.
    vVia: 'gaia_riello',
    syntheticId: null,
    ...overrides,
  };
}
