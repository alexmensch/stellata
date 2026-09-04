// The on-disk shape of a perf run — schema stellata-perf/1. Owns the
// adapter, scenario and per-mode records, so the runner, the tables and
// the baseline diff all read one set of types. README.md § JSON output.

import type { GpuFrameMethod, PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { Backend, ScenarioName } from './scenarios';
import type { DwellSummary } from './dwell-pure';
import type { SweepFit, SweepPoint } from './sweep-pure';

/**
 * Removing a field or changing what one MEANS bumps the suffix; adding one
 * does not. `--baseline` refuses to compare across two suffixes rather
 * than mapping between them, so a bump is a decision to abandon every
 * recorded baseline — say so in the bead that makes it.
 */
export const PERF_SCHEMA = 'stellata-perf/1';

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

export interface DwellRecord {
  /** Every sample, never just the summary: a re-analysis with a different
   *  estimator has to be possible from the file alone. */
  readonly deltasMs: readonly number[];
  /** The WebGPU frame-sample stream, present only where it was subscribed
   *  and sound. `gpuNote` says why on every other path. */
  readonly gpuMs: readonly number[] | null;
  readonly gpuNote: string;
  readonly stats: DwellSummary;
  readonly gpuStats: DwellSummary | null;
  readonly limitMag: number;
  readonly dm: number;
  readonly readbackPerFrame: number;
}

export interface SweepRecord {
  readonly points: readonly SweepPoint[];
  readonly fit: SweepFit;
  /** Spread of the two scale-1 medians — how far the instrument moved
   *  across the sweep, and the floor any slope claim sits on. */
  readonly bracketMs: number;
}

export interface ScenarioRecord {
  readonly name: ScenarioName;
  readonly blob: string;
  readonly backend: { readonly requested: Backend; readonly actual: Backend | null };
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly buffer: { readonly width: number; readonly height: number } | null;
  readonly bufferMpx: number | null;
  readonly mode: string;
  /** The clock the numbers came off. Never compare two of them. */
  readonly method: GpuFrameMethod | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settleMs: number | null;
  readonly idleRafMs: number | null;
  readonly differential: readonly PriceFrameRow[] | null;
  readonly dwell: DwellRecord | null;
  readonly sweep: SweepRecord | null;
  readonly console: readonly string[];
  readonly pageErrors: readonly string[];
  /** A page error landed inside the measurement: the numbers priced a
   *  broken page, so they print but do not count. */
  readonly tainted: boolean;
  readonly failed: boolean;
  readonly failure: string | null;
}

export interface PerfRunMeta {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly url: string;
  readonly argv: readonly string[];
  readonly git: { readonly commit: string; readonly dirty: boolean };
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
  readonly run: PerfRunMeta;
  readonly scenarios: readonly ScenarioRecord[];
}

/**
 * Parse a file as a perf run, or throw. The schema string is checked
 * first and by equality: a file written by a future suffix carries fields
 * that mean something else, and reading it as v1 would produce a diff
 * table whose rows are quietly wrong.
 */
export function assertPerfFile(value: unknown, source: string): PerfFile {
  if (typeof value !== 'object' || value === null) {
    throw new SchemaError(`${source} is not a perf run (expected an object)`);
  }
  const schema = (value as { schema?: unknown }).schema;
  if (schema !== PERF_SCHEMA) {
    throw new SchemaError(
      `${source} carries schema ${JSON.stringify(schema)}, not '${PERF_SCHEMA}' — ` +
      'refusing to read it as v1 rather than mapping fields whose meaning may have changed',
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
