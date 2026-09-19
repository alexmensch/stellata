// Reads debug.survivors() at the canon vantages. README.md § Survivor counts.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { survivorPct, type SurvivorReport } from '../../src/client/debug/survivor-counts';
import { ARG_DEFAULTS, ArgError } from './args';
import { gitMeta } from './checkout';
import {
  BOOT_TIMEOUT_MS, DEFAULT_CHROME_ARGS, SETTLE_TIMEOUT_MS,
  awaitSettle, bootScenario, probeAdapters, seedDismissals, type PerfWindow,
} from './page-protocol';
import { BROWSER_CHANNEL, runProvenance } from './run-pure';
import {
  SURVIVORS_SCHEMA, type AdapterProbe, type SurvivorsFile, type SurvivorsRecord, type Viewport,
} from './schema';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl } from './scenarios';
import { formatTable } from './table-pure';

const QUIET_MS = 1500;
const TABLE_DECIMALS = 3;

/** The runner's own default, and the one size every vantage is visited at —
 *  which is why it belongs to the run block rather than to a row. */
const VIEWPORT: Viewport = { width: ARG_DEFAULTS.width, height: ARG_DEFAULTS.height, dpr: ARG_DEFAULTS.dpr };

/** Callers must settle first — README.md § Survivor counts. */
function readSurvivors(page: Page): Promise<SurvivorReport | null> {
  return page.evaluate(() => (window as unknown as PerfWindow).debug.survivors());
}

function survivorTable(rows: readonly SurvivorsRecord[]): string {
  return formatTable(
    ['vantage', 'records', 'glow', 'disc', 'drawn', 'drawn %', 'prefilter', 'drawn / prefilter'],
    rows.map((r) => [
      r.scenario, r.records, r.glow, r.disc, r.glow + r.disc,
      survivorPct(r.drawnFraction, TABLE_DECIMALS),
      r.prefilter, survivorPct(r.drawnOfPrefilter, TABLE_DECIMALS),
    ]),
  );
}

interface SurvivorsArgs {
  readonly url: string;
  readonly json: string | null;
}

export function parseSurvivorsArgs(argv: readonly string[]): SurvivorsArgs {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { url: { type: 'string' }, json: { type: 'string' } },
      strict: true,
    });
    return { url: values.url ?? ARG_DEFAULTS.url, json: values.json ?? null };
  } catch (e) {
    throw new ArgError(e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<number> {
  let args: SurvivorsArgs;
  try {
    args = parseSurvivorsArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n`
      + 'usage: pnpm run survivors -- [--url <base>] [--json <path>]');
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
      const context = await browser.newContext({
        viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
        deviceScaleFactor: VIEWPORT.dpr,
      });
      await seedDismissals(context);
      const page = await context.newPage();
      try {
        await bootScenario(page, scenarioUrl(args.url, SCENARIOS[scenario].blob, 'webgpu'), {
          backend: 'webgpu', timeoutMs: BOOT_TIMEOUT_MS,
        });
        const settleMs = await awaitSettle(page, { quietMs: QUIET_MS, timeoutMs: SETTLE_TIMEOUT_MS });
        const report = await readSurvivors(page);
        if (report === null) {
          console.error(`${scenario}: debug.survivors() returned null — not a WebGPU boot`);
          return 1;
        }
        console.log(
          `${scenario} — ${SCENARIOS[scenario].label} · settled ${settleMs} ms · `
          + `${report.records} records`);
        rows.push({ ...report, scenario, settleMs });
        // After the read, never before: the WebGL branch of the probe opens a
        // throwaway context in the page the counts just came off.
        probe ??= await probeAdapters(page);
      } finally {
        await context.close();
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
    writeFileSync(args.json, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`\nwrote ${args.json}`);
  }
  return 0;
}

process.exitCode = await main();
