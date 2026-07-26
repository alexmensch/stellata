// Horizons VECTORS queries for a set of epochs: URL shape and the per-request
// row-count checks. Transport is ../util/horizons-response.ts; parsing is
// horizons-vectors.ts.

import { fetchHorizonsText } from '../util/horizons-response';

import { parseHorizonsVectors, type HorizonsVectors } from './horizons-vectors';
import {
  jdOfMicrodays,
  microdaysOf,
  type EpochRequest,
  type VectorRow,
} from './adaptive-grid-pure';

export { MAX_LIST_EPOCHS, MAX_RANGE_ROWS } from '../util/horizons-response';

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
  const { samples } = parseHorizonsVectors(await fetchHorizonsText(params));
  if (samples.length !== 2) {
    throw new Error(`Horizons returned ${samples.length} rows for the span probe, expected 2`);
  }
  return { startMu: microdaysOf(samples[0][0]), stopMu: microdaysOf(samples[1][0]) };
}

export function requestedEpochs(request: EpochRequest): number[] {
  if (request.kind === 'list') return [...request.mus];
  const step = (request.stopMu - request.startMu) / request.intervals;
  return Array.from({ length: request.intervals + 1 }, (_, i) =>
    Math.round(request.startMu + i * step),
  );
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
    await fetchHorizonsText(requestParams(horizonsId, request)),
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
  return { header, rows };
}
