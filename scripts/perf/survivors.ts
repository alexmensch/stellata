// Reads debug.survivors() at the canon vantages. README.md § Survivor counts.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { survivorPct, type SurvivorReport } from '../../src/client/debug/survivor-counts';
import { ARG_DEFAULTS, ArgError } from './args';
import {
  BOOT_TIMEOUT_MS, DEFAULT_CHROME_ARGS, SETTLE_TIMEOUT_MS,
  awaitSettle, bootScenario, seedDismissals, type PerfWindow,
} from './page-protocol';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl, type ScenarioName } from './scenarios';
import { formatTable } from './table-pure';

const QUIET_MS = 1500;
const TABLE_DECIMALS = 3;

interface Row extends SurvivorReport {
  scenario: ScenarioName;
}

/** Callers must settle first — README.md § Survivor counts. */
function readSurvivors(page: Page): Promise<SurvivorReport | null> {
  return page.evaluate(() => (window as unknown as PerfWindow).debug.survivors());
}

function survivorTable(rows: readonly Row[]): string {
  return formatTable(
    ['vantage', 'records', 'glow', 'disc', 'drawn', 'drawn %'],
    rows.map((r) => [
      r.scenario, r.records, r.glow, r.disc, r.glow + r.disc,
      survivorPct(r.drawnFraction, TABLE_DECIMALS),
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

  const browser = await chromium.launch({
    channel: 'chromium', headless: true, args: DEFAULT_CHROME_ARGS,
  });
  const rows: Row[] = [];
  try {
    for (const scenario of SCENARIO_NAMES) {
      const context = await browser.newContext({
        viewport: { width: ARG_DEFAULTS.width, height: ARG_DEFAULTS.height },
        deviceScaleFactor: ARG_DEFAULTS.dpr,
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
        rows.push({ ...report, scenario });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${survivorTable(rows)}`);
  if (args.json !== null) {
    writeFileSync(args.json, `${JSON.stringify({ url: args.url, rows }, null, 2)}\n`);
    console.log(`\nwrote ${args.json}`);
  }
  return 0;
}

process.exitCode = await main();
