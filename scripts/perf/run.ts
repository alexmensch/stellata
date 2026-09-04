// The perf runner: human-armed, Chrome only, clocks only. Protocol, flags
// and exit codes: README.md. The only Playwright value import in the tree.

import { existsSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { PriceFrameOptions } from '../../src/client/debug/frame-cost/frame-cost';
import { median } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { ArgError, parseRunArgs, usage, type RunArgs } from './args';
import { PERF_GO_MARKER_NAME, PERF_GO_MAX_AGE_S } from './perf-go-lib';
import {
  BootError,
  awaitSettle,
  bootScenario,
  probeAdapters,
  probeRafDeltas,
  readDrawingBuffer,
  runDifferential,
  seedDismissals,
  type AdapterProbe,
} from './page-protocol';
import { SCENARIOS, scenarioUrl, type ScenarioName } from './scenarios';
import { formatPriceTable } from './table-pure';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const MARKER = resolve(REPO_ROOT, PERF_GO_MARKER_NAME);
const MARKER_MAX_AGE_MS = PERF_GO_MAX_AGE_S * 1000;
const REACHABILITY_TIMEOUT_MS = 5000;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;
const DEFAULT_CHROME_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 120_000;
const RAF_PROBE_FRAMES = 60;

const EXIT = { ok: 0, failed: 1, usage: 2, unarmed: 3 } as const;

class SoftwareAdapter extends Error {}
class PageCrash extends Error {}

type MarkerVerdict = 'armed' | 'absent' | 'stale';

function consumeMarker(): MarkerVerdict {
  if (!existsSync(MARKER)) return 'absent';
  const ageMs = Date.now() - statSync(MARKER).mtimeMs;
  unlinkSync(MARKER);
  return ageMs > MARKER_MAX_AGE_MS ? 'stale' : 'armed';
}

async function unreachable(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

function describeProbe(p: AdapterProbe): string {
  const webgl = p.webgl
    ? `${p.webgl.renderer} · ${p.webgl.vendor} · EXT_disjoint_timer_query_webgl2 ${p.webgl.timerQuery ? 'present' : 'ABSENT'}`
    : 'no WebGL2 context';
  const webgpu = p.webgpu
    ? `${p.webgpu.description || p.webgpu.device || '(unnamed)'} · ${p.webgpu.vendor}/${p.webgpu.architecture} · ` +
      `fallback ${p.webgpu.isFallbackAdapter} · timestampsAvailable ${p.webgpu.timestampsAvailable ?? 'n/a on a webgl2 boot'}`
    : 'no adapter';
  return `webgl : ${webgl}\nwebgpu: ${webgpu}`;
}

function softwareRenderer(p: AdapterProbe): string | null {
  const candidates = [p.webgl?.renderer, p.webgpu?.description, p.webgpu?.device];
  const hit = candidates.find((s) => s !== undefined && SOFTWARE_RENDERER.test(s));
  if (hit !== undefined) return hit;
  return p.webgpu?.isFallbackAdapter ? 'WebGPU fallback adapter' : null;
}

function priceFrameOptions(a: RunArgs): PriceFrameOptions {
  return {
    passes: a.passes,
    method: a.method,
    budgetMs: a.budgetMs,
    dwellFrames: a.dwellFrames,
    warmupFrames: a.warmupFrames,
    settleFrames: a.settleFrames,
    interleave: a.interleave,
  };
}

interface ScenarioOutcome {
  readonly name: ScenarioName;
  readonly failed: boolean;
  readonly tainted: boolean;
}

async function runScenario(browser: Browser, args: RunArgs, name: ScenarioName): Promise<ScenarioOutcome> {
  const scenario = SCENARIOS[name];
  const url = scenarioUrl(args.url, scenario.blob, args.backend);
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: args.dpr,
  });
  await seedDismissals(context);
  const page = await context.newPage();

  const pageErrors: string[] = [];
  let lastConsoleLine = '';
  let measuring = false;
  let tainted = false;
  let crashed = false;
  page.on('console', (message) => {
    if (message.type() === 'table') return;
    lastConsoleLine = message.text();
    console.log(`[page:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error(`[page:error] ${error.message}`);
    if (measuring) tainted = true;
  });
  page.on('crash', () => { crashed = true; });

  console.log(`\n== ${name} — ${scenario.label} · ${args.backend} · ${args.headed ? 'headed' : 'headless'} · ${url}`);
  let failed = false;
  try {
    await bootScenario(page, url, { backend: args.backend, timeoutMs: BOOT_TIMEOUT_MS });
    if (pageErrors.length > 0) throw new BootError(`page error during boot: ${pageErrors[0]}`);

    const probe = await probeAdapters(page);
    console.log(describeProbe(probe));
    const software = softwareRenderer(probe);
    if (software !== null) throw new SoftwareAdapter(software);

    const settleMs = await awaitSettle(page, { quietMs: args.quietMs, timeoutMs: SETTLE_TIMEOUT_MS });
    const rafMs = median(await probeRafDeltas(page, RAF_PROBE_FRAMES));
    const buffer = await readDrawingBuffer(page);
    console.log(
      `settled after ${settleMs} ms · idle rAF period ${rafMs.toFixed(2)} ms (${(1000 / rafMs).toFixed(1)} Hz) · ` +
      `drawing buffer ${buffer.width}x${buffer.height} (${((buffer.width * buffer.height) / 1e6).toFixed(3)} Mpx)`,
    );

    if (args.mode === 'differential') {
      measuring = true;
      const rows = await runDifferential(page, priceFrameOptions(args));
      if (rows.length === 0) {
        failed = true;
        console.error(
          `priceFrame returned no rows${args.passes ? ` for --passes ${args.passes.join(',')}` : ''} — ` +
          `either it refused the sweep, or no requested pass was active at this vantage. ` +
          `Last console line: ${lastConsoleLine}`,
        );
      } else {
        console.log(formatPriceTable(rows));
      }
      if (tainted) {
        console.error(`${name} TAINTED: ${pageErrors.length} page error(s) landed inside the sweep — the rows above priced a broken page.`);
      }
    }
  } catch (e) {
    if (crashed) throw new PageCrash(`${name}: the page crashed`);
    if (e instanceof SoftwareAdapter) throw e;
    failed = true;
    console.error(`${name} FAILED: ${(e as Error).message}`);
  } finally {
    await context.close();
  }
  return { name, failed, tainted };
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

  const marker = consumeMarker();
  if (marker !== 'armed') {
    console.error(marker === 'absent'
      ? `perf: not armed — no ${MARKER}. Announce the measurement and wait for scripts/perf/await-go.sh to report the marker.`
      : `perf: ${MARKER} was older than an hour — a stale arm, now deleted. Ask for a fresh one.`);
    return EXIT.unarmed;
  }

  const chromeArgs = [...DEFAULT_CHROME_ARGS, ...args.chromeArgs];
  const browser = await chromium.launch({ channel: 'chromium', headless: !args.headed, args: chromeArgs });
  console.log(
    `perf: ${browser.browserType().name()} ${browser.version()} · channel chromium · ${args.headed ? 'HEADED' : 'HEADLESS'} · ` +
    `${process.platform}/${process.arch}\nargs: ${chromeArgs.join(' ')}\n` +
    `viewport ${args.width}x${args.height} @ dpr ${args.dpr} · mode ${args.mode} · backend ${args.backend}` +
    (args.method ? ` · method pinned ${args.method}` : ''),
  );

  const outcomes: ScenarioOutcome[] = [];
  try {
    for (const name of args.scenarios) outcomes.push(await runScenario(browser, args, name));
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

  const failed = outcomes.filter((o) => o.failed).map((o) => o.name);
  const tainted = outcomes.filter((o) => o.tainted).map((o) => o.name);
  console.log(
    `\nperf: ${outcomes.length} scenario(s), ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}` +
    (tainted.length ? `, tainted: ${tainted.join(', ')}` : ''),
  );
  return failed.length + tainted.length > 0 ? EXIT.failed : EXIT.ok;
}

process.exitCode = await main();
