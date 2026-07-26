// Wire contract for data/ephemerides/{planet}.json — shared by the emitter
// (fetch-planet-elements.ts) and the runtime table in
// src/client/solar-system/ephemerides/element-table.ts.

/** Column order of every row in `PlanetElementTableFile.samples`:
 *  `a` in AU, the four dimensionless equinoctial components, and the mean
 *  longitude λ in degrees. Angles are folded into the equinoctial pairs and λ
 *  runs unwrapped precisely so linear interpolation between adjacent samples
 *  never crosses a branch cut — see
 *  `src/client/solar-system/ephemerides/equinoctial-pure.ts`. */
export const ELEMENT_COLUMNS = ['a', 'h', 'k', 'p', 'q', 'lambda'] as const;

export const ELEMENT_STRIDE = ELEMENT_COLUMNS.length;

export type PlanetElementTableFile = {
  id: string;
  horizonsId: string;
  /** Julian Date **TDB** of `samples[0]`. */
  jd0: number;
  /** Uniform spacing in days: `samples[i]` is at `jd0 + i * stepDays`, so no
   *  row carries an epoch and the runtime indexes by arithmetic. */
  stepDays: number;
  /** Free-text provenance echoed from the HORIZONS response header. */
  source: {
    frame: string;
    center: string;
    units: string;
    outputType: string;
    targetBody: string;
    retrievedUtc: string;
  };
  /** Largest distance, AU, that reconstructing a position from linearly
   *  interpolated elements may sit from Horizons — the bound `stepDays` was
   *  chosen to hold, measured at epochs off the sample grid. */
  positionToleranceAu: number;
  columns: readonly string[];
  samples: number[][];
};
