// CLI parsing for the perf runner. Flag reference: README.md § Invocation.

import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  GPU_FRAME_METHODS,
  PRICED_PASS_KEYS,
  type GpuFrameMethod,
  type PricedPassKey,
} from '../../src/client/debug/frame-cost/frame-cost-pure';
import { DEFAULT_DWELL_FRAMES } from './dwell-pure';
import { DEFAULT_SWEEP_SCALES } from './sweep-pure';
import { DEFAULT_QUIET_MS } from './settle-pure';
import { BACKENDS, SCENARIO_NAMES, type ScenarioName } from './scenarios';

export const MODES = ['differential', 'probe', 'dwell', 'sweep'] as const;
export type Mode = (typeof MODES)[number];

/** `both` measures each scenario twice, in its own context. It is not a
 *  `Backend`: nothing boots "both", so it never reaches a URL or a record. */
export const BACKEND_REQUESTS = [...BACKENDS, 'both'] as const;
export type BackendRequest = (typeof BACKEND_REQUESTS)[number];

/** `--roundtrip idle`: the same frames between the two dwells with nothing
 *  toggled — the time-matched control for a pass round trip. */
export const ROUNDTRIP_IDLE = 'idle';
export type RoundTrip = PricedPassKey | typeof ROUNDTRIP_IDLE;

export interface RunArgs {
  readonly help: boolean;
  readonly url: string;
  readonly scenarios: readonly ScenarioName[];
  readonly backend: BackendRequest;
  readonly mode: Mode;
  readonly passes: readonly string[] | undefined;
  readonly method: GpuFrameMethod | undefined;
  readonly budgetMs: number;
  readonly dwellFrames: number | undefined;
  readonly warmupFrames: number | undefined;
  readonly settleFrames: number | undefined;
  readonly interleave: boolean;
  readonly headed: boolean;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly quietMs: number;
  readonly chromeArgs: readonly string[];
  /** dwell and sweep: frames whose deltas count, per dwell. */
  readonly frames: number;
  /** dwell: a priceFrame pass key, or `idle`, applied between two dwells. */
  readonly roundtrip: RoundTrip | undefined;
  readonly scales: readonly number[];
  readonly json: string | undefined;
  readonly baseline: string | undefined;
}

export const ARG_DEFAULTS = {
  url: 'http://localhost:5173',
  scenario: 'sol',
  backend: 'webgl2',
  mode: 'differential',
  budgetMs: 180_000,
  width: 1280,
  height: 800,
  dpr: 2,
  quietMs: DEFAULT_QUIET_MS,
  frames: DEFAULT_DWELL_FRAMES,
  scales: DEFAULT_SWEEP_SCALES.join(','),
} as const;

export class ArgError extends Error {}

const OPTIONS = {
  help: { type: 'boolean', short: 'h', default: false },
  url: { type: 'string', default: ARG_DEFAULTS.url },
  scenario: { type: 'string', default: ARG_DEFAULTS.scenario },
  backend: { type: 'string', default: ARG_DEFAULTS.backend },
  mode: { type: 'string', default: ARG_DEFAULTS.mode },
  passes: { type: 'string' },
  method: { type: 'string' },
  'budget-ms': { type: 'string', default: String(ARG_DEFAULTS.budgetMs) },
  'dwell-frames': { type: 'string' },
  'warmup-frames': { type: 'string' },
  'settle-frames': { type: 'string' },
  'no-interleave': { type: 'boolean', default: false },
  headed: { type: 'boolean', default: false },
  width: { type: 'string', default: String(ARG_DEFAULTS.width) },
  height: { type: 'string', default: String(ARG_DEFAULTS.height) },
  dpr: { type: 'string', default: String(ARG_DEFAULTS.dpr) },
  'quiet-ms': { type: 'string', default: String(ARG_DEFAULTS.quietMs) },
  'chrome-arg': { type: 'string', multiple: true, default: [] },
  frames: { type: 'string', default: String(ARG_DEFAULTS.frames) },
  roundtrip: { type: 'string' },
  scales: { type: 'string', default: ARG_DEFAULTS.scales },
  json: { type: 'string' },
  baseline: { type: 'string' },
} satisfies ParseArgsConfig['options'];

export function usage(): string {
  return [
    'Usage: pnpm run perf -- [flags]',
    `  --scenario <names>       comma list of ${SCENARIO_NAMES.join('|')}, or all   (default ${ARG_DEFAULTS.scenario})`,
    `  --backend <name>         ${BACKEND_REQUESTS.join('|')}                         (default ${ARG_DEFAULTS.backend})`,
    `  --mode <name>            ${MODES.join('|')}   (default ${ARG_DEFAULTS.mode})`,
    '  --passes <keys>          comma list of priceFrame pass keys        (default: every present pass)',
    `  --method <clock>         ${GPU_FRAME_METHODS.join('|')}       (default: the backend\'s best)`,
    `  --budget-ms <n>          whole-sweep wall-clock ceiling            (default ${ARG_DEFAULTS.budgetMs})`,
    '  --dwell-frames <n>  --warmup-frames <n>  --settle-frames <n>       (default: priceFrame\'s own)',
    '  --no-interleave          single-baseline sweep (drift-exposed)',
    '  --headed                 headed Chrome; headed and headless never compare',
    `  --width <px> --height <px> --dpr <n>                               (default ${ARG_DEFAULTS.width}x${ARG_DEFAULTS.height} @ ${ARG_DEFAULTS.dpr})`,
    `  --quiet-ms <n>           render-gate idle required before measuring (default ${ARG_DEFAULTS.quietMs})`,
    `  --url <base>             a RUNNING dev server                       (default ${ARG_DEFAULTS.url})`,
    '  --chrome-arg=<switch>    extra Chromium switch, repeatable (the = form, since the value starts with a dash)',
    `  --frames <n>             dwell and sweep: frames per dwell         (default ${ARG_DEFAULTS.frames})`,
    `  --roundtrip <pass|${ROUNDTRIP_IDLE}>  dwell: dwell, hold the pass off for --frames then restore it, dwell again`,
    `  --scales <list>          sweep: viewport scales                    (default ${ARG_DEFAULTS.scales})`,
    '  --json <path>            write the whole run as stellata-perf/1',
    '  --baseline <path>        diff this run against a saved one and print the verdicts',
    'Exit codes: 0 ok · 1 scenario failed / refused / software adapter · 2 bad flags or unreachable url · 3 not armed',
  ].join('\n');
}

/**
 * Which flags each mode actually reads. A flag the chosen mode ignores is an
 * error rather than a no-op: the in-app instrument refuses a pin it cannot
 * honour rather than switching clocks underneath the caller
 * (`src/client/debug/frame-cost/README.md` § Preconditions), and a table
 * stamped `raf-delta` after `--method timer-query` was asked for is the same
 * lie with a typed command line in front of it.
 */
const MODE_ONLY_FLAGS: Readonly<Record<string, readonly Mode[]>> = {
  passes: ['differential'],
  method: ['differential'],
  'budget-ms': ['differential'],
  'dwell-frames': ['differential'],
  'settle-frames': ['differential'],
  'no-interleave': ['differential'],
  frames: ['dwell', 'sweep'],
  roundtrip: ['dwell'],
  scales: ['sweep'],
};

export function parseRunArgs(argv: readonly string[]): RunArgs {
  let values: Record<string, unknown>;
  // Which flags were actually typed, as against which carry a default. Only
  // the typed set can be checked for mode compatibility.
  let supplied: Set<string>;
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  try {
    const parsed = parseArgs({ args, options: OPTIONS, strict: true, tokens: true });
    values = parsed.values;
    supplied = new Set(
      parsed.tokens.flatMap((t) => (t.kind === 'option' ? [t.name] : [])),
    );
  } catch (e) {
    throw new ArgError((e as Error).message);
  }

  const str = (name: string): string | undefined => values[name] as string | undefined;

  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T => {
    const v = str(name) as T;
    if (!allowed.includes(v)) {
      throw new ArgError(`--${name} must be one of ${allowed.join(', ')}; got '${v}'`);
    }
    return v;
  };

  const optionalOneOf = <T extends string>(name: string, allowed: readonly T[]): T | undefined =>
    str(name) === undefined ? undefined : oneOf(name, allowed);

  const num = (name: string): number => {
    const raw = str(name)!;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new ArgError(`--${name} must be a positive number; got '${raw}'`);
    return n;
  };

  const optionalNum = (name: string): number | undefined =>
    str(name) === undefined ? undefined : num(name);

  const list = (name: string): string[] | undefined =>
    str(name)?.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  const numberList = (name: string): number[] => {
    const parsed = (list(name) ?? []).map((raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ArgError(`--${name} takes positive numbers; got '${raw}'`);
      }
      return n;
    });
    if (parsed.length === 0) throw new ArgError(`--${name} names nothing`);
    return parsed;
  };

  const isPassKey = (key: string): key is PricedPassKey =>
    PRICED_PASS_KEYS.includes(key as PricedPassKey);

  const passes = list('passes');
  for (const key of passes ?? []) {
    if (!isPassKey(key)) {
      throw new ArgError(`--passes names no such pass: '${key}'. Known: ${PRICED_PASS_KEYS.join(', ')}`);
    }
  }

  const requestedRoundTrip = str('roundtrip');
  if (requestedRoundTrip !== undefined
    && requestedRoundTrip !== ROUNDTRIP_IDLE && !isPassKey(requestedRoundTrip)) {
    throw new ArgError(
      `--roundtrip names no such pass: '${requestedRoundTrip}'. `
      + `Known: ${PRICED_PASS_KEYS.join(', ')}, or ${ROUNDTRIP_IDLE}`);
  }
  const roundtrip: RoundTrip | undefined = requestedRoundTrip;

  const requested = list('scenario') ?? [];
  const scenarios = requested.includes('all') ? [...SCENARIO_NAMES] : requested.map((name) => {
    if (!SCENARIO_NAMES.includes(name as ScenarioName)) {
      throw new ArgError(`--scenario must name ${SCENARIO_NAMES.join(', ')} or all; got '${name}'`);
    }
    return name as ScenarioName;
  });
  if (scenarios.length === 0) throw new ArgError('--scenario names nothing');

  const mode = oneOf('mode', MODES);
  for (const [flag, modes] of Object.entries(MODE_ONLY_FLAGS)) {
    if (supplied.has(flag) && !modes.includes(mode)) {
      throw new ArgError(
        `--${flag} is read by --mode ${modes.join(' and ')} only; this run is --mode ${mode}, ` +
        'which would ignore it. Drop the flag or change the mode.',
      );
    }
  }

  return {
    help: values.help as boolean,
    url: str('url')!,
    scenarios,
    backend: oneOf('backend', BACKEND_REQUESTS),
    mode,
    passes,
    method: optionalOneOf('method', GPU_FRAME_METHODS),
    budgetMs: num('budget-ms'),
    dwellFrames: optionalNum('dwell-frames'),
    warmupFrames: optionalNum('warmup-frames'),
    settleFrames: optionalNum('settle-frames'),
    interleave: !(values['no-interleave'] as boolean),
    headed: values.headed as boolean,
    width: num('width'),
    height: num('height'),
    dpr: num('dpr'),
    quietMs: num('quiet-ms'),
    chromeArgs: values['chrome-arg'] as string[],
    frames: num('frames'),
    roundtrip,
    scales: numberList('scales'),
    json: str('json'),
    baseline: str('baseline'),
  };
}
