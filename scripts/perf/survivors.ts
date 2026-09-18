// Reads debug.survivors() at the canon vantages. README.md § Survivor counts.

import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import type { SurvivorReport } from '../../src/client/debug/survivor-counts';
import {
  awaitSettle, bootScenario, readRecordCount, seedDismissals,
} from './page-protocol';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl, type ScenarioName } from './scenarios';

const CHROME_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 120_000;
const QUIET_MS = 1500;
const VIEWPORT = { width: 1280, height: 800 } as const;
const DPR = 2;

interface Row extends SurvivorReport {
  scenario: ScenarioName;
}

interface SurvivorsWindow {
  debug: { survivors(): Promise<SurvivorReport | null> };
}

/** Callers must settle first — README.md § Survivor counts. */
function readSurvivors(page: Page): Promise<SurvivorReport | null> {
  return page.evaluate(() => (window as unknown as SurvivorsWindow).debug.survivors());
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

function formatTable(rows: Row[]): string {
  const head = ['vantage', 'records', 'glow', 'disc', 'drawn', 'drawn %'];
  const body = rows.map((r) => [
    r.scenario, String(r.records), String(r.glow), String(r.disc),
    String(r.glow + r.disc), pct(r.drawnFraction),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(w[i])).join('  ');
  return [line(head), ...body.map(line)].join('\n');
}

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main(): Promise<number> {
  const url = flag('--url') ?? 'http://localhost:5173';
  const jsonPath = flag('--json');

  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: CHROME_ARGS });
  const rows: Row[] = [];
  try {
    for (const scenario of SCENARIO_NAMES) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
      await seedDismissals(context);
      const page = await context.newPage();
      try {
        await bootScenario(page, scenarioUrl(url, SCENARIOS[scenario].blob, 'webgpu'), {
          backend: 'webgpu', timeoutMs: BOOT_TIMEOUT_MS,
        });
        const settleMs = await awaitSettle(page, { quietMs: QUIET_MS, timeoutMs: SETTLE_TIMEOUT_MS });
        const report = await readSurvivors(page);
        if (report === null) {
          console.error(`${scenario}: debug.survivors() returned null — not a WebGPU boot`);
          return 1;
        }
        const records = await readRecordCount(page);
        console.log(
          `${scenario} — ${SCENARIOS[scenario].label} · settled ${settleMs} ms · `
          + `${records ?? report.records} records`);
        rows.push({ ...report, scenario });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${formatTable(rows)}`);
  if (jsonPath !== null) {
    writeFileSync(jsonPath, `${JSON.stringify({ url, rows }, null, 2)}\n`);
    console.log(`\nwrote ${jsonPath}`);
  }
  return 0;
}

process.exitCode = await main();
