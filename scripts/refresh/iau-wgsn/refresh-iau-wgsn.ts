// refresh:iau-wgsn — the IAU WGSN naked-eye catalogue and faint approved names, fetched over plain HTTP and committed verbatim. See README.md.

import { setTimeout as sleep } from 'node:timers/promises';

import { reportService } from '../../util/answered-by';
import { emitArtifacts, type PullDescription } from '../../util/emit-artifacts';
import { TapTransient, withRetry } from '../pull/tap-pure';
import { IAU_WGSN_OUTPUTS } from './iau-wgsn-outputs';
import { WGSN_FILES, describeWgsn, fetchedText, wgsnChecks, wgsnService, type WgsnKey } from './iau-wgsn-pure';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const TIMEOUT_MS = 60_000;

/** A network failure retries, as a 5xx does. */
async function fetchText(url: string): Promise<string> {
  return withRetry(async () => {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new TapTransient(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return fetchedText(url, response.status, await response.arrayBuffer());
  }, RETRY_DELAYS_MS, (ms) => sleep(ms));
}

export const describe = (): PullDescription => describeWgsn();

export async function main(): Promise<void> {
  const keys = Object.keys(WGSN_FILES) as WgsnKey[];
  const files = {} as Record<WgsnKey, string>;
  for (const key of keys) {
    console.log(`fetching ${WGSN_FILES[key].url}`);
    files[key] = await fetchText(WGSN_FILES[key].url);
    reportService(wgsnService(key));
  }
  emitArtifacts({ outputs: IAU_WGSN_OUTPUTS, files, checks: keys.flatMap((key) => wgsnChecks(key, files[key])) });
  console.log('Now re-run: pnpm run build:wgsn (and commit both if changed)');
}
