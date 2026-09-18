// The on-disk shapes both instruments write — stellata-perf/2 and
// stellata-survivors/1 — plus the adapter, scenario and per-mode records the
// runner, the tables and the baseline diff share. README.md § JSON output.

import type { GpuFrameMethod, PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { SurvivorReport } from '../../src/client/debug/survivor-counts';
import type { Backend, ScenarioName } from './scenarios';
import type { DwellSummary, PassCountsPerFrame, PassCountsSummary } from './dwell/dwell-pure';
import type { SweepFit, SweepPoint } from './sweep/sweep-pure';

/**
 * Removing a field or changing what one MEANS bumps the suffix; adding one
 * does not — unless a reader must ACT on the field's absence, which an
 * older file cannot distinguish from a value it never had. `recordCount`
 * is such a field: a comparison across two record sets is not a comparison,
 * so an unknown count has to refuse, and every file written before it
 * carried one would refuse anyway. `--baseline` refuses to compare across
 * two suffixes rather than mapping between them, so a bump is a decision to
 * abandon every recorded baseline — say so in the bead that makes it.
 */
export const PERF_SCHEMA = 'stellata-perf/2';

export class SchemaError extends Error {}

export interface WebGlProbe {
  readonly renderer: string;
  readonly vendor: string;
  readonly timerQuery: boolean;
}

export interface WebGpuProbe {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean;
  readonly timestampsAvailable: boolean | null;
}

export interface AdapterProbe {
  readonly webgl: WebGlProbe | null;
  readonly webgpu: WebGpuProbe | null;
}

/** Per-frame WebGPU API counts over the timed frames, and their summary.
 *  Null on a WebGL2 boot, and wherever the page had no GPUQueue to count
 *  on — `note` says which. */
export interface PassCountsRecord {
  readonly perFrame: PassCountsPerFrame;
  readonly summary: PassCountsSummary;
  readonly note: string;
}

export interface DwellRecord {
  /** Every sample, never just the summary. */
  readonly deltasMs: readonly number[];
  /** The WebGPU frame-sample stream, present only where it was subscribed
   *  and sound. `gpuNote` says why on every other path. */
  readonly gpuMs: readonly number[] | null;
  readonly gpuNote: string;
  readonly stats: DwellSummary;
  readonly gpuStats: DwellSummary | null;
  /** Optional: a file written before the compute pool was resolved carries
   *  no key, and a reader takes that as null rather than as a fault. */
  readonly computeMs?: readonly number[] | null;
  readonly computeStats?: DwellSummary | null;
  readonly limitMag: number;
  readonly dm: number;
  readonly readbackPerFrame: number;
  readonly passCounts: PassCountsRecord | null;
}

/** What `--roundtrip` did between the two dwells: the pass held off for
 *  `offFrames`, then re-enabled and left for `settleFrames` before the
 *  second dwell's own warmup. `idle` is the time-matched control. */
export interface RoundTripRecord {
  readonly pass: string;
  readonly offFrames: number;
  readonly settleFrames: number;
}

export interface SweepRecord {
  readonly points: readonly SweepPoint[];
  readonly fit: SweepFit;
  /** Spread of the two scale-1 medians — how far the instrument moved
   *  across the sweep, and the floor any slope claim sits on. */
  readonly bracketMs: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface ScenarioRecord {
  readonly name: ScenarioName;
  readonly blob: string;
  readonly backend: { readonly requested: Backend; readonly actual: Backend | null };
  readonly viewport: Viewport;
  readonly buffer: { readonly width: number; readonly height: number } | null;
  readonly bufferMpx: number | null;
  readonly mode: string;
  /** Star records the page loaded (`stellata.catalog.count`, off the binary
   *  header). The scene every star pass draws, so a row priced against a
   *  different count prices a different scene: absent, or more than
   *  `RECORD_COUNT_TOLERANCE` apart, refuses the comparison exactly as a
   *  resized buffer does. */
  readonly recordCount: number | null;
  /** 1-based place of this context in its run. The GPU's load history
   *  before a context moves its frame time on unchanged code (0.49 ms
   *  between 8th of 10 and 1st of 2), so two rows compare only at equal
   *  position; absent — a file written before the field existed — refuses
   *  like an absent record count. diff/README.md § The refusals. */
  readonly position: number | null;
  /** The clock the numbers came off. Never compare two of them. */
  readonly method: GpuFrameMethod | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settleMs: number | null;
  readonly idleRafMs: number | null;
  readonly differential: readonly PriceFrameRow[] | null;
  readonly dwell: DwellRecord | null;
  /** The second dwell of a `--roundtrip` run, after `roundtrip` was applied. */
  readonly dwellAfter: DwellRecord | null;
  readonly roundtrip: RoundTripRecord | null;
  readonly sweep: SweepRecord | null;
  readonly console: readonly string[];
  readonly pageErrors: readonly string[];
  /** A page error landed inside the measurement: the numbers priced a
   *  broken page, so they print but do not count. */
  readonly tainted: boolean;
  readonly failed: boolean;
  readonly failure: string | null;
}

/**
 * What tree was measured, and what a later reader can bound it against.
 * A pin is always taken on a branch, and a squash merge lands that tree
 * under a hash the branch tip never had — so the tip alone cannot answer
 * "how far has main moved since?", which is the question every
 * `--against-pin` header asks.
 */
export interface GitProvenance {
  readonly commit: string;
  readonly dirty: boolean;
  /** Merge base of `commit` with `origin/main` — the newest commit the
   *  measured tree shares with main, and so the one hash a later session can
   *  still diff against once the branch has squashed away. Null where
   *  `origin/main` or the merge base could not be read. */
  readonly mainCommit: string | null;
  /** Whether `commit` was itself an ancestor of `origin/main` when the run
   *  was taken. False for every run taken on an unlanded branch, which is
   *  most of them: it is not a fault, it is why `mainCommit` exists. */
  readonly mainReachable: boolean;
}

/** What both instruments record about the tree, the browser and the host
 *  they ran on. Everything a later reader needs to decide whether two files
 *  are each other's comparison, minus what only one instrument varies. */
export interface RunProvenance {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly url: string;
  readonly argv: readonly string[];
  readonly git: GitProvenance;
  readonly browser: {
    readonly name: string;
    readonly version: string;
    readonly channel: string;
    readonly headless: boolean;
    readonly args: readonly string[];
  };
  readonly gpu: AdapterProbe | null;
  readonly host: { readonly platform: string; readonly arch: string };
}

export interface PerfFile {
  readonly schema: typeof PERF_SCHEMA;
  readonly run: RunProvenance;
  readonly scenarios: readonly ScenarioRecord[];
}

/**
 * `pnpm run survivors`. A separate suffix rather than a mode of
 * stellata-perf/2: `assertPerfFile` judges the suffix by equality before
 * reading anything, so reusing it would offer the diff and the pin a file
 * with no `scenarios`, and bumping it would abandon every recorded baseline.
 */
export const SURVIVORS_SCHEMA = 'stellata-survivors/1';

export interface SurvivorsRecord extends SurvivorReport {
  readonly scenario: ScenarioName;
  /** The counts come off the last compaction dispatch, so a read taken
   *  before the gate went quiet belongs to a camera still arriving —
   *  README.md § Survivor counts. */
  readonly settleMs: number;
}

/**
 * The viewport belongs to the run rather than the record because every
 * vantage is visited at one size. It is in the block at all because the
 * frustum test produces these counts, so they move with viewport, field of
 * view and device pixel ratio the way a frame time moves with Mpx.
 */
export interface SurvivorsRunMeta extends RunProvenance {
  readonly viewport: Viewport;
}

export interface SurvivorsFile {
  readonly schema: typeof SURVIVORS_SCHEMA;
  readonly run: SurvivorsRunMeta;
  readonly rows: readonly SurvivorsRecord[];
}

/**
 * The schema string is checked
 * first and by equality: a file written under another suffix carries fields
 * that mean something else, and reading it under this one would produce a
 * diff table whose rows are quietly wrong.
 */
export function assertPerfFile(value: unknown, source: string): PerfFile {
  if (typeof value !== 'object' || value === null) {
    throw new SchemaError(`${source} is not a perf run (expected an object)`);
  }
  const schema = (value as { schema?: unknown }).schema;
  if (schema !== PERF_SCHEMA) {
    throw new SchemaError(
      `${source} carries schema ${JSON.stringify(schema)}, not '${PERF_SCHEMA}' — ` +
      'refusing to read it under that suffix rather than mapping fields whose meaning may have changed',
    );
  }
  const file = value as Partial<PerfFile>;
  if (typeof file.run !== 'object' || file.run === null) {
    throw new SchemaError(`${source} has no run block`);
  }
  if (!Array.isArray(file.scenarios)) {
    throw new SchemaError(`${source} has no scenarios array`);
  }
  return file as PerfFile;
}
