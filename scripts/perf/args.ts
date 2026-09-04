// CLI parsing for the perf runner. Flag reference: README.md § Invocation.

import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  GPU_FRAME_METHODS,
  PRICED_PASS_KEYS,
  type GpuFrameMethod,
} from '../../src/client/debug/frame-cost/frame-cost-pure';
import { DEFAULT_QUIET_MS } from './settle-pure';
import { BACKENDS, SCENARIO_NAMES, type Backend, type ScenarioName } from './scenarios';

export const MODES = ['differential', 'probe'] as const;
export type Mode = (typeof MODES)[number];

export interface RunArgs {
  readonly help: boolean;
  readonly url: string;
  readonly scenarios: readonly ScenarioName[];
  readonly backend: Backend;
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
} as const;

export class ArgError extends Error {}

const OPTIONS: ParseArgsConfig['options'] = {
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
};

export function usage(): string {
  return [
    'Usage: pnpm run perf -- [flags]',
    `  --scenario <names>       comma list of ${SCENARIO_NAMES.join('|')}, or all   (default ${ARG_DEFAULTS.scenario})`,
    `  --backend <name>         ${BACKENDS.join('|')}                              (default ${ARG_DEFAULTS.backend})`,
    `  --mode <name>            ${MODES.join('|')}                        (default ${ARG_DEFAULTS.mode})`,
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
    'Exit codes: 0 ok · 1 scenario failed / refused / software adapter · 2 bad flags or unreachable url · 3 not armed',
  ].join('\n');
}

export function parseRunArgs(argv: readonly string[]): RunArgs {
  let values: Record<string, unknown>;
  const tokens = argv[0] === '--' ? argv.slice(1) : [...argv];
  try {
    ({ values } = parseArgs({ args: tokens, options: OPTIONS, strict: true }));
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

  const passes = list('passes');
  for (const key of passes ?? []) {
    if (!PRICED_PASS_KEYS.includes(key as (typeof PRICED_PASS_KEYS)[number])) {
      throw new ArgError(`--passes names no such pass: '${key}'. Known: ${PRICED_PASS_KEYS.join(', ')}`);
    }
  }

  const requested = list('scenario') ?? [];
  const scenarios = requested.includes('all') ? [...SCENARIO_NAMES] : requested.map((name) => {
    if (!SCENARIO_NAMES.includes(name as ScenarioName)) {
      throw new ArgError(`--scenario must name ${SCENARIO_NAMES.join(', ')} or all; got '${name}'`);
    }
    return name as ScenarioName;
  });
  if (scenarios.length === 0) throw new ArgError('--scenario names nothing');

  return {
    help: values.help as boolean,
    url: str('url')!,
    scenarios,
    backend: oneOf('backend', BACKENDS),
    mode: oneOf('mode', MODES),
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
  };
}
