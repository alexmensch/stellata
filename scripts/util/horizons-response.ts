// Shape shared by every JPL Horizons text response: the endpoint, the two API
// limits, the retrying fetch, and the header / data-block readers the typed
// per-ephemeris-type parsers sit on top of.

export const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** A `TLIST` longer than this is truncated with no error reported. */
export const MAX_LIST_EPOCHS = 70;

/** Self-imposed, well under anything Horizons has refused. */
export const MAX_RANGE_ROWS = 2000;

const RETRY_DELAY_MS = [1_000, 4_000, 12_000];

/** Horizons asks for considerate use and a full fetch run issues on the order
 *  of a hundred queries. */
const PACING_MS = 250;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One query, retried through `RETRY_DELAY_MS` on 5xx and then paced. A 4xx
 *  is a query bug and fails immediately. */
export async function fetchHorizonsText(params: URLSearchParams): Promise<string> {
  const url = `${HORIZONS_API}?${params}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      const text = await response.text();
      await sleep(PACING_MS);
      return text;
    }
    if (attempt >= RETRY_DELAY_MS.length || response.status < 500) {
      throw new Error(`Horizons HTTP ${response.status}`);
    }
    await sleep(RETRY_DELAY_MS[attempt]);
  }
}

export function readHeaderField(text: string, label: string): string {
  const match = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'm').exec(text);
  if (!match) throw new Error(`Horizons response has no "${label}" header line`);
  return match[1].trim().replace(/\s{2,}/g, ' ');
}

/** The header text and the non-empty CSV lines of the `$$SOE`/`$$EOE` block.
 *  A response that lost the block entirely is usually an error page served
 *  with HTTP 200, so the first 400 characters ride the message. */
export function splitDataBlock(text: string): { headerText: string; lines: string[] } {
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  if (start < 0 || end < 0 || end < start) {
    const signature = text.slice(0, 400).replace(/\s+/g, ' ');
    throw new Error(`Horizons response has no $$SOE/$$EOE data block. Starts: ${signature}`);
  }
  const lines = text
    .slice(start + '$$SOE'.length, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error('Horizons data block is empty');
  return { headerText: text.slice(0, start), lines };
}

export function assertAscendingJd(jds: readonly number[]): void {
  for (let i = 1; i < jds.length; i++) {
    if (jds[i] <= jds[i - 1]) {
      throw new Error(`Horizons jd column is not ascending at row ${i}: ${jds[i]}`);
    }
  }
}

/** Split `count` grid indices into runs of at most `MAX_RANGE_ROWS` rows, so a
 *  uniform-cadence span can be fetched as a few range queries whose endpoints
 *  land exactly on grid epochs. */
export function rangeChunks(count: number): Array<{ first: number; last: number }> {
  const chunks: Array<{ first: number; last: number }> = [];
  for (let first = 0; first < count; first = chunks[chunks.length - 1].last + 1) {
    chunks.push({ first, last: Math.min(first + MAX_RANGE_ROWS - 1, count - 1) });
  }
  return chunks;
}
