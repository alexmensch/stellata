// Horizons VECTORS queries for a set of epochs: URL shape, retry, and the
// per-request row-count checks. Parsing is horizons-vectors.ts.

import { parseHorizonsVectors, type HorizonsVectors } from './horizons-vectors';
import {
  jdOfMicrodays,
  microdaysOf,
  type EpochRequest,
  type VectorRow,
} from './adaptive-grid-pure';

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** A `TLIST` longer than this is truncated with no error reported. */
export const MAX_LIST_EPOCHS = 70;

/** Self-imposed, well under anything Horizons has refused. */
export const MAX_RANGE_ROWS = 2000;

const RETRY_DELAY_MS = [1_000, 4_000, 12_000];

/** Horizons asks for considerate use and a refinement run issues on the
 *  order of a hundred queries. */
const PACING_MS = 250;

/** Calendar time strings are read in the same TDB scale the JDTDB column
 *  reports, so a `JD…` epoch round-trips to itself and nothing here has
 *  to reason about a UTC offset. */
function timeParam(mu: number): string {
  return `'JD${jdOfMicrodays(mu).toFixed(6)}'`;
}

function requestParams(horizonsId: string, request: EpochRequest): URLSearchParams {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${horizonsId}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    REF_PLANE: 'FRAME',
    VEC_TABLE: "'2'",
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: "'YES'",
  });
  if (request.kind === 'range') {
    params.set('START_TIME', timeParam(request.startMu));
    params.set('STOP_TIME', timeParam(request.stopMu));
    params.set('STEP_SIZE', `'${request.intervals}'`);
  } else {
    params.set(
      'TLIST',
      `'${request.mus.map((mu) => jdOfMicrodays(mu).toFixed(6)).join(',')}'`,
    );
  }
  return params;
}

/**
 * The JDTDB epochs a calendar span resolves to, which is what lets every
 * later query address epochs as `JD…` numbers instead of dates.
 */
export async function fetchSpanEndpoints(
  horizonsId: string,
  startIso: string,
  stopIso: string,
): Promise<{ startMu: number; stopMu: number }> {
  const params = requestParams(horizonsId, { kind: 'range', startMu: 0, stopMu: 0, intervals: 1 });
  params.set('START_TIME', `'${startIso}'`);
  params.set('STOP_TIME', `'${stopIso}'`);
  const { samples } = parseHorizonsVectors(await fetchText(`${HORIZONS_API}?${params}`));
  if (samples.length !== 2) {
    throw new Error(`Horizons returned ${samples.length} rows for the span probe, expected 2`);
  }
  await sleep(PACING_MS);
  return { startMu: microdaysOf(samples[0][0]), stopMu: microdaysOf(samples[1][0]) };
}

export function requestedEpochs(request: EpochRequest): number[] {
  if (request.kind === 'list') return [...request.mus];
  const step = (request.stopMu - request.startMu) / request.intervals;
  return Array.from({ length: request.intervals + 1 }, (_, i) =>
    Math.round(request.startMu + i * step),
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.text();
    if (attempt >= RETRY_DELAY_MS.length || response.status < 500) {
      throw new Error(`Horizons HTTP ${response.status}`);
    }
    await sleep(RETRY_DELAY_MS[attempt]);
  }
}

/**
 * The rows for exactly the epochs `request` names, with `jd` replaced by
 * the requested microday grid so downstream arithmetic stays exact.
 *
 * The row-count check is load-bearing rather than defensive: an
 * over-length TLIST comes back truncated with HTTP 200 and no diagnostic,
 * which would silently drop refinement epochs and leave the emitted grid
 * claiming a tolerance it does not hold.
 */
export async function fetchVectorRows(
  horizonsId: string,
  request: EpochRequest,
): Promise<{ header: HorizonsVectors['header']; rows: VectorRow[] }> {
  const wanted = requestedEpochs(request);
  const { header, samples } = parseHorizonsVectors(
    await fetchText(`${HORIZONS_API}?${requestParams(horizonsId, request)}`),
  );
  if (samples.length !== wanted.length) {
    throw new Error(
      `Horizons returned ${samples.length} rows for ${wanted.length} requested epochs`,
    );
  }
  const rows = samples.map((row, i) => {
    const drift = Math.abs(microdaysOf(row[0]) - wanted[i]);
    if (drift > 1) {
      throw new Error(
        `Horizons row ${i} is at JD ${row[0]}, ${drift} microdays off the requested epoch`,
      );
    }
    return [jdOfMicrodays(wanted[i]), ...row.slice(1)];
  });
  await sleep(PACING_MS);
  return { header, rows };
}
