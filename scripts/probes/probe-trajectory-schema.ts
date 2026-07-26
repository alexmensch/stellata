// Wire contract for data/probes/{id}.json — shared by the emitter
// (fetch-probe-trajectories.ts) and the runtime loader.

/** Column order of every row in `ProbeTrajectoryFile.samples`. */
export const PROBE_SAMPLE_COLUMNS = ['jd', 'x', 'y', 'z', 'vx', 'vy', 'vz'] as const;

export const PROBE_SAMPLE_STRIDE = PROBE_SAMPLE_COLUMNS.length;

export type ProbeSampleRow = number[];

export type ProbeTrajectoryFile = {
  id: string;
  label: string;
  mission: string;
  horizonsId: string;
  launchUtc: string;
  /** `Date.parse(launchUtc)` — Unix **milliseconds**, not the Unix seconds
   *  the model clock `t` runs in. */
  launchUnixMs: number;
  lastContactUtc: string | null;
  lastContactUnixMs: number | null;
  /** Free-text provenance echoed from the HORIZONS response header. */
  source: {
    frame: string;
    center: string;
    units: string;
    targetBody: string;
    retrievedUtc: string;
  };
  /** Largest distance, AU, the sample grid's linear interpolation may sit
   *  from the real trajectory — the bound the non-uniform spacing was
   *  built to and measured against. */
  chordToleranceAu: number;
  columns: readonly string[];
  /** Ascending in `jd`, non-uniformly spaced; positions AU, velocities
   *  AU/day, both ICRS. */
  samples: ProbeSampleRow[];
};
