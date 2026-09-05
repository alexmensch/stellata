// The perf runner: human-armed, Chrome only, clocks only. Protocol, flags
// and exit codes: README.md. The only Playwright value import in the tree.

import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { PriceFrameOptions } from '../../src/client/debug/frame-cost/frame-cost';
import {
  median,
  WARMUP_FRAMES,
  type GpuFrameMethod,
} from '../../src/client/debug/frame-cost/frame-cost-pure';
import { ArgError, parseRunArgs, usage, type BackendRequest, type RunArgs } from './args';
import { diffRuns } from './diff-pure';
import type { DwellSummary } from './dwell-pure';
import { applyRoundTrip, measureDwell, measureSweep, type Measured } from './measure';
import { PERF_GO_MARKER_NAME, PERF_GO_MAX_AGE_S } from './perf-go-lib';
import {
  DWELL_METHOD,
  describeProbe,
  markerVerdict,
  methodFor,
  softwareRenderer,
  type MarkerVerdict,
} from './run-pure';
import {
  BootError,
  awaitSettle,
  bootScenario,
  probeAdapters,
  probeRafDeltas,
  readDrawingBuffer,
  runDifferential,
  seedDismissals,
} from './page-protocol';
import {
  PERF_SCHEMA,
  assertPerfFile,
  SchemaError,
  type AdapterProbe,
  type DwellRecord,
  type PerfFile,
  type ScenarioRecord,
} from './schema';
import { BACKENDS, SCENARIOS, scenarioUrl, type Backend, type ScenarioName } from './scenarios';
import {
  formatDiffTable, formatDwellTable, formatPassCountTable, formatPriceTable,
  formatRoundTripLine, formatSweepTable,
} from './table-pure';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const MARKER = resolve(REPO_ROOT, PERF_GO_MARKER_NAME);
const MARKER_MAX_AGE_MS = PERF_GO_MAX_AGE_S * 1000;
const REACHABILITY_TIMEOUT_MS = 5000;
const DEFAULT_CHROME_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 120_000;
const RAF_PROBE_FRAMES = 60;

const EXIT = { ok: 0, failed: 1, usage: 2, unarmed: 3 } as const;

class SoftwareAdapter extends Error {}
class PageCrash extends Error {}

function consumeMarker(): MarkerVerdict {
  const exists = existsSync(MARKER);
  const ageMs = exists ? Date.now() - statSync(MARKER).mtimeMs : 0;
  if (exists) unlinkSync(MARKER);
  return markerVerdict(exists, ageMs, MARKER_MAX_AGE_MS);
}

async function unreachable(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

function priceFrameOptions(a: RunArgs, method: GpuFrameMethod | undefined): PriceFrameOptions {
  return {
    passes: a.passes,
    method,
    budgetMs: a.budgetMs,
    dwellFrames: a.dwellFrames,
    warmupFrames: a.warmupFrames,
    settleFrames: a.settleFrames,
    interleave: a.interleave,
  };
}

function backendsFor(request: BackendRequest): readonly Backend[] {
  return request === 'both' ? BACKENDS : [request];
}

function gitMeta(): { commit: string; dirty: boolean } {
  const git = (...argv: string[]): string =>
    execFileSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  try {
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  } catch (e) {
    return { commit: `unavailable (${(e as Error).message})`, dirty: true };
  }
}

interface ScenarioPlan {
  readonly name: ScenarioName;
  readonly backend: Backend;
  readonly method: GpuFrameMethod | undefined;
}

/** One dwell's tables and gate line, the same for the first dwell and a
 *  round trip's second. */
function printDwell(
  label: string,
  dwelt: Measured<DwellRecord>,
  idleRafMs: number | null,
): void {
  const d = dwelt.value;
  if (d === null) return;
  const clocks: (readonly [string, DwellSummary])[] = [[DWELL_METHOD, d.stats]];
  if (d.gpuStats !== null) clocks.push(['gpu-timestamp', d.gpuStats]);
  console.log(`${label}\n${formatDwellTable(clocks)}`);
  console.log(
    `gpu stream: ${d.gpuNote} · readback ${d.readbackPerFrame.toFixed(3)}/frame · ` +
    `limit ${d.limitMag.toFixed(3)} mag at dm ${d.dm.toFixed(3)} · ` +
    `clamp judged against the ${idleRafMs?.toFixed(2) ?? '?'} ms idle cadence`,
  );
  if (d.passCounts !== null) {
    console.log(`${formatPassCountTable(d.passCounts.summary)}\npass counts: ${d.passCounts.note}`);
  }
}

interface ScenarioOutcome {
  readonly record: ScenarioRecord;
  /** Whichever adapter this scenario's context saw. The run-level `gpu`
   *  block takes the first one; a diff refuses across two adapters, so it
   *  is a property of the run rather than of a row. */
  readonly probe: AdapterProbe | null;
}

async function runScenario(browser: Browser, args: RunArgs, plan: ScenarioPlan): Promise<ScenarioOutcome> {
  const { name, backend } = plan;
  const scenario = SCENARIOS[name];
  const url = scenarioUrl(args.url, scenario.blob, backend);
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: args.dpr,
  });
  await seedDismissals(context);
  const page = await context.newPage();

  const consoleLines: string[] = [];
  const pageErrors: string[] = [];
  let measuring = false;
  let tainted = false;
  let crashed = false;
  page.on('console', (message) => {
    if (message.type() === 'table') return;
    consoleLines.push(`[${message.type()}] ${message.text()}`);
    console.log(`[page:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error(`[page:error] ${error.message}`);
    if (measuring) tainted = true;
  });
  page.on('crash', () => { crashed = true; });

  console.log(`\n== ${name} — ${scenario.label} · ${backend} · ${args.headed ? 'headed' : 'headless'} · ${url}`);

  const record = {
    name,
    blob: scenario.blob,
    backend: { requested: backend, actual: null as Backend | null },
    viewport: { width: args.width, height: args.height, dpr: args.dpr },
    buffer: null as { width: number; height: number } | null,
    bufferMpx: null as number | null,
    mode: args.mode,
    method: null as GpuFrameMethod | null,
    params: {} as Record<string, unknown>,
    settleMs: null as number | null,
    idleRafMs: null as number | null,
    differential: null as ScenarioRecord['differential'],
    dwell: null as ScenarioRecord['dwell'],
    dwellAfter: null as ScenarioRecord['dwellAfter'],
    roundtrip: null as ScenarioRecord['roundtrip'],
    sweep: null as ScenarioRecord['sweep'],
    failed: false,
    failure: null as string | null,
  };

  let probe: AdapterProbe | null = null;
  try {
    await bootScenario(page, url, { backend, timeoutMs: BOOT_TIMEOUT_MS });
    if (pageErrors.length > 0) throw new BootError(`page error during boot: ${pageErrors[0]}`);
    record.backend.actual = backend;

    probe = await probeAdapters(page);
    console.log(describeProbe(probe));
    const software = softwareRenderer(probe);
    if (software !== null) throw new SoftwareAdapter(software);

    record.settleMs = await awaitSettle(page, { quietMs: args.quietMs, timeoutMs: SETTLE_TIMEOUT_MS });
    record.idleRafMs = median(await probeRafDeltas(page, RAF_PROBE_FRAMES));
    const buffer = await readDrawingBuffer(page);
    record.buffer = buffer;
    record.bufferMpx = Number(((buffer.width * buffer.height) / 1e6).toFixed(3));
    console.log(
      `settled after ${record.settleMs} ms · idle rAF period ${record.idleRafMs.toFixed(2)} ms ` +
      `(${(1000 / record.idleRafMs).toFixed(1)} Hz) · drawing buffer ${buffer.width}x${buffer.height} ` +
      `(${record.bufferMpx} Mpx)`,
    );

    measuring = true;
    if (args.mode === 'differential') {
      record.params = { ...priceFrameOptions(args, plan.method) };
      const rows = await runDifferential(page, priceFrameOptions(args, plan.method));
      if (rows.length === 0) {
        record.failed = true;
        record.failure =
          `priceFrame returned no rows${args.passes ? ` for --passes ${args.passes.join(',')}` : ''} — ` +
          'either it refused the sweep, or no requested pass was active at this vantage';
        console.error(`${record.failure}. Last console line: ${consoleLines.at(-1) ?? '(none)'}`);
      } else {
        record.differential = rows;
        record.method = rows[0].method;
        console.log(formatPriceTable(rows));
      }
    } else if (args.mode === 'dwell' || args.mode === 'sweep') {
      const dwellPlan = {
        frames: args.frames,
        warmupFrames: args.warmupFrames ?? WARMUP_FRAMES,
        backend,
        cadenceMs: record.idleRafMs,
      };
      record.method = DWELL_METHOD;
      if (args.mode === 'dwell') {
        record.params = { ...dwellPlan, roundtrip: args.roundtrip ?? null };
        const dwelt = await measureDwell(page, dwellPlan);
        record.dwell = dwelt.value;
        printDwell(args.roundtrip === undefined ? 'dwell' : 'dwell BEFORE the round trip', dwelt, record.idleRafMs);
        if (dwelt.failure !== null) {
          record.failed = true;
          record.failure = dwelt.failure;
          console.error(`${name} FAILED: ${dwelt.failure}`);
        } else if (args.roundtrip !== undefined) {
          record.roundtrip = await applyRoundTrip(page, { pass: args.roundtrip, offFrames: args.frames });
          console.log(
            `round trip applied: ${args.roundtrip} off for ${record.roundtrip.offFrames} frames, ` +
            `restored, ${record.roundtrip.settleFrames} frames to settle`,
          );
          const again = await measureDwell(page, dwellPlan);
          record.dwellAfter = again.value;
          printDwell('dwell AFTER the round trip', again, record.idleRafMs);
          if (again.failure !== null) {
            record.failed = true;
            record.failure = `after the round trip: ${again.failure}`;
            console.error(`${name} FAILED: ${record.failure}`);
          } else if (dwelt.value !== null && again.value !== null) {
            console.log(formatRoundTripLine(args.roundtrip, dwelt.value, again.value));
          }
        }
      } else {
        record.params = { ...dwellPlan, scales: args.scales };
        const swept = await measureSweep(page, {
          ...dwellPlan,
          scales: args.scales,
          width: args.width,
          height: args.height,
          quietMs: args.quietMs,
          settleTimeoutMs: SETTLE_TIMEOUT_MS,
        });
        record.sweep = swept.value;
        if (swept.value !== null) {
          console.log(formatSweepTable(swept.value.points, swept.value.fit, swept.value.bracketMs));
        }
        if (swept.failure !== null) {
          record.failed = true;
          record.failure = swept.failure;
          console.error(`${name} FAILED: ${swept.failure}`);
        }
      }
    }
    if (tainted) {
      console.error(
        `${name} TAINTED: ${pageErrors.length} page error(s) landed inside the measurement — ` +
        'the numbers above priced a broken page.',
      );
    }
  } catch (e) {
    if (crashed) throw new PageCrash(`${name}: the page crashed`);
    if (e instanceof SoftwareAdapter) throw e;
    record.failed = true;
    record.failure = (e as Error).message;
    console.error(`${name} FAILED: ${record.failure}`);
  } finally {
    await context.close();
  }

  return { record: { ...record, console: consoleLines, pageErrors, tainted }, probe };
}

function writeJson(path: string, file: PerfFile): void {
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nperf: wrote ${path} (${PERF_SCHEMA})`);
}

function printBaseline(path: string, baseline: PerfFile, current: PerfFile): void {
  console.log(`\nperf: against baseline ${path} (${baseline.run.git.commit.slice(0, 8)}${baseline.run.git.dirty ? '-dirty' : ''})`);
  console.log(formatDiffTable(diffRuns(baseline, current)));
}

/**
 * Both output paths are proved usable BEFORE the marker is consumed, because
 * a run is authorised one launch at a time: a directory that does not exist
 * would otherwise surface as an exception thrown over the finished samples,
 * discarding minutes of measurement and costing a fresh human arm to redo.
 * So a bad path is a flag error like any other — exit 2, marker untouched.
 */
function preflightPaths(args: RunArgs): { baseline: PerfFile | null; error: string | null } {
  if (args.json !== undefined) {
    const dir = dirname(resolve(args.json)) || '.';
    try {
      accessSync(dir, constants.W_OK);
    } catch {
      return { baseline: null, error: `--json ${args.json}: ${dir} is not a writable directory` };
    }
  }
  if (args.baseline === undefined) return { baseline: null, error: null };
  try {
    return {
      baseline: assertPerfFile(JSON.parse(readFileSync(args.baseline, 'utf-8')), args.baseline),
      error: null,
    };
  } catch (e) {
    const why = e instanceof SchemaError || e instanceof SyntaxError
      ? (e as Error).message
      : `unreadable — ${(e as Error).message}`;
    return { baseline: null, error: `--baseline ${why}` };
  }
}

async function main(): Promise<number> {
  let args: RunArgs;
  try {
    args = parseRunArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ArgError)) throw e;
    console.error(`perf: ${e.message}\n\n${usage()}`);
    return EXIT.usage;
  }
  if (args.help) {
    console.log(usage());
    return EXIT.ok;
  }

  const down = await unreachable(args.url);
  if (down !== null) {
    console.error(`perf: ${args.url} is not reachable (${down}). The runner never starts a dev server — point --url at the one that is running.`);
    return EXIT.usage;
  }

  const { baseline, error } = preflightPaths(args);
  if (error !== null) {
    console.error(`perf: ${error}`);
    return EXIT.usage;
  }

  const marker = consumeMarker();
  if (marker !== 'armed') {
    console.error(marker === 'absent'
      ? `perf: not armed — no ${MARKER}. Announce the measurement and wait for scripts/perf/await-go.sh to report the marker.`
      : `perf: ${MARKER} was older than an hour — a stale arm, now deleted. Ask for a fresh one.`);
    return EXIT.unarmed;
  }

  const { method, why } = methodFor(args);
  if (why !== null) console.log(`perf: ${why}`);

  const chromeArgs = [...DEFAULT_CHROME_ARGS, ...args.chromeArgs];
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ channel: 'chromium', headless: !args.headed, args: chromeArgs });
  const browserVersion = browser.version();
  console.log(
    `perf: ${browser.browserType().name()} ${browserVersion} · channel chromium · ${args.headed ? 'HEADED' : 'HEADLESS'} · ` +
    `${process.platform}/${process.arch}\nargs: ${chromeArgs.join(' ')}\n` +
    `viewport ${args.width}x${args.height} @ dpr ${args.dpr} · mode ${args.mode} · backend ${args.backend}` +
    (method ? ` · method pinned ${method}` : ''),
  );

  const records: ScenarioRecord[] = [];
  const probes: AdapterProbe[] = [];
  try {
    for (const name of args.scenarios) {
      for (const backend of backendsFor(args.backend)) {
        const outcome = await runScenario(browser, args, { name, backend, method });
        records.push(outcome.record);
        if (outcome.probe !== null) probes.push(outcome.probe);
      }
    }
  } catch (e) {
    if (e instanceof SoftwareAdapter) {
      console.error(`perf: ABORT — software renderer (${e.message}). Nothing measured on it counts.`);
      return EXIT.failed;
    }
    if (e instanceof PageCrash) {
      console.error(`perf: ABORT — ${e.message}`);
      return EXIT.failed;
    }
    throw e;
  } finally {
    await browser.close();
  }

  const file: PerfFile = {
    schema: PERF_SCHEMA,
    run: {
      startedAt,
      finishedAt: new Date().toISOString(),
      url: args.url,
      argv: process.argv.slice(2),
      git: gitMeta(),
      browser: {
        name: 'chromium',
        version: browserVersion,
        channel: 'chromium',
        headless: !args.headed,
        args: chromeArgs,
      },
      gpu: probes[0] ?? null,
      host: { platform: process.platform, arch: process.arch },
    },
    scenarios: records,
  };

  // The preflight proved the directory writable, so a throw here is the disk
  // or a race. Report it and carry on to the diff: the samples are already in
  // hand and a lost table helps nobody.
  let writeFailure: string | null = null;
  if (args.json !== undefined) {
    try {
      writeJson(args.json, file);
    } catch (e) {
      writeFailure = (e as Error).message;
      console.error(`perf: could not write ${args.json} — ${writeFailure}`);
    }
  }
  if (baseline !== null && args.baseline !== undefined) printBaseline(args.baseline, baseline, file);

  const failed = records.filter((r) => r.failed).map((r) => `${r.name}/${r.backend.requested}`);
  const tainted = records.filter((r) => r.tainted).map((r) => `${r.name}/${r.backend.requested}`);
  console.log(
    `\nperf: ${records.length} scenario run(s), ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}` +
    (tainted.length ? `, tainted: ${tainted.join(', ')}` : ''),
  );
  return failed.length + tainted.length > 0 || writeFailure !== null ? EXIT.failed : EXIT.ok;
}

process.exitCode = await main();
