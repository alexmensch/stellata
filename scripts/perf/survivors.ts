// Reads debug.survivors() at the canon vantages. README.md#survivor-counts--the-one-entry-point-here-that-is-not-a-cost-instrument.

import { chromium, type Page } from 'playwright';
import { survivorPct, type SurvivorReport } from '../../src/client/debug/survivor-counts';
import { ARG_DEFAULTS, parseSurvivorsArgs, type SurvivorsArgs } from './args';
import { gitMeta } from './checkout';
import { DEFAULT_CHROME_ARGS, probeAdapters, visitSettled, type PerfWindow } from './page-protocol';
import { writeRunFile } from './run-file/run-file';
import { BROWSER_CHANNEL, runProvenance } from './run-pure';
import {
  SURVIVORS_SCHEMA, type AdapterProbe, type SurvivorsFile, type SurvivorsRecord, type Viewport,
} from './schema';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl } from './scenarios';
import { formatTable } from './table-pure';

const TABLE_DECIMALS = 3;

/** The runner's own default, and the one size every vantage is visited at —
 *  which is why it belongs to the run block rather than to a row. */
const VIEWPORT: Viewport = { width: ARG_DEFAULTS.width, height: ARG_DEFAULTS.height, dpr: ARG_DEFAULTS.dpr };

/** Callers must settle first — README.md#survivor-counts--the-one-entry-point-here-that-is-not-a-cost-instrument. */
function readSurvivors(page: Page): Promise<SurvivorReport | null> {
  return page.evaluate(() => (window as unknown as PerfWindow).debug.survivors());
}

function survivorTable(rows: readonly SurvivorsRecord[]): string {
  return formatTable(
    ['vantage', 'records', 'glow', 'disc', 'drawn', 'drawn %', 'prefilter', 'drawn / prefilter',
      'in frame', 'in frame %'],
    rows.map((r) => [
      r.scenario, r.records, r.glow, r.disc, r.glow + r.disc,
      survivorPct(r.drawnFraction, TABLE_DECIMALS),
      r.prefilter, survivorPct(r.drawnOfPrefilter, TABLE_DECIMALS),
      r.inFrame ?? 'n/a',
      r.inFrameFraction === null ? 'n/a' : survivorPct(r.inFrameFraction, TABLE_DECIMALS),
    ]),
  );
}

export async function main(): Promise<number> {
  let args: SurvivorsArgs;
  try {
    args = parseSurvivorsArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n`
      + 'usage: pnpm run survivors -- [--url <base>] [--json <path.json.gz>]');
    return 2;
  }

  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({
    channel: BROWSER_CHANNEL, headless: true, args: DEFAULT_CHROME_ARGS,
  });
  const browserVersion = browser.version();
  const rows: SurvivorsRecord[] = [];
  let probe: AdapterProbe | null = null;
  try {
    for (const scenario of SCENARIO_NAMES) {
      const read = await visitSettled(
        browser, scenarioUrl(args.url, SCENARIOS[scenario].blob), { viewport: VIEWPORT },
        async ({ page, settleMs }) => {
          const report = await readSurvivors(page);
          if (report === null) return null;
          console.log(
            `${scenario} — ${SCENARIOS[scenario].label} · settled ${settleMs} ms · `
            + `${report.records} records`);
          rows.push({ ...report, scenario, settleMs });
          // After the read, never before: the WebGL branch of the probe opens a
          // throwaway context in the page the counts just came off.
          probe ??= await probeAdapters(page);
          return report;
        });
      if (read === null) {
        console.error(`${scenario}: debug.survivors() returned null — not a WebGPU boot`);
        return 1;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${survivorTable(rows)}`);
  if (args.json !== null) {
    const file: SurvivorsFile = {
      schema: SURVIVORS_SCHEMA,
      run: {
        ...runProvenance({
          startedAt,
          url: args.url,
          browserVersion,
          headless: true,
          chromeArgs: DEFAULT_CHROME_ARGS,
          git: gitMeta(),
          gpu: probe,
        }),
        viewport: VIEWPORT,
      },
      rows,
    };
    writeRunFile(args.json, file);
    console.log(`\nwrote ${args.json}`);
  }
  return 0;
}
