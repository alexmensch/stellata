import { describe, expect, it } from 'vitest';
import {
  ARG_DEFAULTS, ArgError, BACKEND_REQUESTS, MODES, ROUNDTRIP_IDLE, parseRunArgs, usage,
} from './args';
import { DEFAULT_SWEEP_SCALES } from './sweep-pure';
import { SCENARIO_NAMES } from './scenarios';

describe('parseRunArgs', () => {
  it('fills every default from ARG_DEFAULTS and leaves priceFrame knobs unset', () => {
    const a = parseRunArgs([]);
    expect(a).toEqual({
      help: false,
      url: ARG_DEFAULTS.url,
      scenarios: [ARG_DEFAULTS.scenario],
      backend: ARG_DEFAULTS.backend,
      mode: ARG_DEFAULTS.mode,
      passes: undefined,
      method: undefined,
      budgetMs: ARG_DEFAULTS.budgetMs,
      dwellFrames: undefined,
      warmupFrames: undefined,
      settleFrames: undefined,
      interleave: true,
      headed: false,
      width: ARG_DEFAULTS.width,
      height: ARG_DEFAULTS.height,
      dpr: ARG_DEFAULTS.dpr,
      quietMs: ARG_DEFAULTS.quietMs,
      chromeArgs: [],
      frames: ARG_DEFAULTS.frames,
      roundtrip: undefined,
      scales: [...DEFAULT_SWEEP_SCALES],
      json: undefined,
      baseline: undefined,
      pin: undefined,
      againstPin: undefined,
      accept: [],
      cooldownMs: ARG_DEFAULTS.cooldownMs,
    });
  });

  it('takes the pin flags in dwell mode, --accept as key:bead pairs, and a zero cool-down', () => {
    const a = parseRunArgs([
      '--mode', 'dwell', '--json', 'run.json', '--pin', 'scripts/perf/pins/x.json',
      '--accept', 'sol|webgpu:bead-1', '--accept', 'mw50|webgl2: bead-2',
      '--against-pin', 'scripts/perf/pins/y.json', '--cooldown-ms', '120000',
    ]);
    expect(a.pin).toBe('scripts/perf/pins/x.json');
    expect(a.againstPin).toBe('scripts/perf/pins/y.json');
    expect(a.accept).toEqual([
      { key: 'sol|webgpu', bead: 'bead-1' },
      { key: 'mw50|webgl2', bead: 'bead-2' },
    ]);
    expect(a.cooldownMs).toBe(120000);
    expect(parseRunArgs(['--cooldown-ms', '0']).cooldownMs).toBe(0);
  });

  it('refuses --pin without --json, --accept without --pin, a malformed --accept, and a negative cool-down', () => {
    expect(() => parseRunArgs(['--mode', 'dwell', '--pin', 'p.json'])).toThrow(/needs --json/);
    expect(() => parseRunArgs(['--mode', 'dwell', '--accept', 'sol|webgpu:bead-1'])).toThrow(/needs --pin/);
    expect(() => parseRunArgs(['--mode', 'dwell', '--json', 'r.json', '--pin', 'p.json', '--accept', 'sol:bead-1']))
      .toThrow(/<scenario>\|<backend>:<bead-id>/);
    expect(() => parseRunArgs(['--mode', 'dwell', '--json', 'r.json', '--pin', 'p.json', '--accept', 'sol|webgpu']))
      .toThrow(ArgError);
    expect(() => parseRunArgs(['--cooldown-ms=-1'])).toThrow(/zero or a positive/);
  });

  it('refuses the pin flags outside dwell mode', () => {
    expect(() => parseRunArgs(['--json', 'r.json', '--pin', 'p.json'])).toThrow(/--mode dwell only/);
    expect(() => parseRunArgs(['--against-pin', 'p.json'])).toThrow(/--mode dwell only/);
  });

  it('takes a pass key or the idle control as --roundtrip, in dwell mode', () => {
    expect(parseRunArgs(['--mode', 'dwell', '--roundtrip', 'localDepth']).roundtrip).toBe('localDepth');
    expect(parseRunArgs(['--mode', 'dwell', '--roundtrip', ROUNDTRIP_IDLE]).roundtrip).toBe('idle');
  });

  it('parses comma lists and repeated flags', () => {
    const a = parseRunArgs([
      '--scenario', 'sol, mw120',
      '--passes', 'localDepth,reduction',
      '--chrome-arg=--use-angle=metal',
      '--chrome-arg=--foo',
    ]);
    expect(a.scenarios).toEqual(['sol', 'mw120']);
    expect(a.passes).toEqual(['localDepth', 'reduction']);
    expect(a.chromeArgs).toEqual(['--use-angle=metal', '--foo']);
  });

  it('drops the -- that pnpm run forwards ahead of the flags', () => {
    expect(parseRunArgs(['--', '--scenario', 'lg']).scenarios).toEqual(['lg']);
  });

  it('expands all to the five canon vantages in canon order', () => {
    expect(parseRunArgs(['--scenario', 'all']).scenarios).toEqual(SCENARIO_NAMES);
  });

  it('coerces the numeric knobs and the two booleans', () => {
    const a = parseRunArgs([
      '--budget-ms', '90000', '--dwell-frames', '240', '--warmup-frames', '60',
      '--settle-frames', '12', '--empty-passes', '4',
      '--width', '1920', '--height', '1080', '--dpr', '1',
      '--quiet-ms', '2000', '--no-interleave', '--headed', '--method', 'raf-delta',
      '--backend', 'webgpu', '--mode', 'differential',
    ]);
    expect(a.budgetMs).toBe(90000);
    expect(a.dwellFrames).toBe(240);
    expect(a.warmupFrames).toBe(60);
    expect(a.settleFrames).toBe(12);
    expect(a.emptyPasses).toBe(4);
    expect([a.width, a.height, a.dpr]).toEqual([1920, 1080, 1]);
    expect(a.quietMs).toBe(2000);
    expect(a.interleave).toBe(false);
    expect(a.headed).toBe(true);
    expect(a.method).toBe('raf-delta');
    expect(a.backend).toBe('webgpu');
    expect(a.mode).toBe('differential');
  });

  it('takes a bare probe run, which reads none of the mode-only knobs', () => {
    const a = parseRunArgs(['--mode', 'probe', '--backend', 'webgpu', '--headed']);
    expect([a.mode, a.backend, a.headed]).toEqual(['probe', 'webgpu', true]);
  });

  it('lets --warmup-frames through in every mode, since every mode absorbs the same ramp', () => {
    for (const mode of ['differential', 'probe', 'dwell', 'sweep']) {
      expect(parseRunArgs(['--mode', mode, '--warmup-frames', '90']).warmupFrames).toBe(90);
    }
  });

  it('takes the new modes, the both backend and the two paths', () => {
    const a = parseRunArgs([
      '--mode', 'sweep', '--backend', 'both', '--frames', '480',
      '--scales', '0.25, 1, 3', '--json', '/tmp/a.json', '--baseline', '/tmp/b.json',
    ]);
    expect(a.mode).toBe('sweep');
    expect(a.backend).toBe('both');
    expect(a.frames).toBe(480);
    expect(a.scales).toEqual([0.25, 1, 3]);
    expect(a.json).toBe('/tmp/a.json');
    expect(a.baseline).toBe('/tmp/b.json');
  });

  it('accepts every mode and backend request it advertises', () => {
    for (const mode of MODES) expect(parseRunArgs(['--mode', mode]).mode).toBe(mode);
    for (const backend of BACKEND_REQUESTS) {
      expect(parseRunArgs(['--backend', backend]).backend).toBe(backend);
    }
  });

  it.each([
    [['--scenario', 'mars'], /--scenario/],
    [['--backend', 'metal'], /--backend/],
    [['--mode', 'stopwatch'], /--mode/],
    [['--method', 'stopwatch'], /--method/],
    [['--mode', 'dwell', '--frames', '0'], /--frames/],
    [['--mode', 'sweep', '--scales', '0'], /--scales/],
    [['--mode', 'sweep', '--scales', 'half'], /--scales/],
    [['--mode', 'sweep', '--scales', ' , '], /names nothing/],
    [['--mode', 'dwell', '--method', 'raf-delta'], /--mode dwell, which would ignore it/],
    [['--mode', 'sweep', '--passes', 'localDepth'], /--mode sweep, which would ignore it/],
    [['--mode', 'probe', '--no-interleave'], /--mode probe, which would ignore it/],
    [['--mode', 'differential', '--frames', '120'], /--mode differential, which would ignore it/],
    [['--mode', 'dwell', '--scales', '1,2'], /--mode dwell, which would ignore it/],
    [['--mode', 'dwell', '--empty-passes', '4'], /--mode dwell, which would ignore it/],
    [['--empty-passes', 'four'], /--empty-passes/],
    [['--passes', 'localDepht'], /no such pass/],
    [['--passes', 'localDepth,mwBnad'], /no such pass/],
    [['--mode', 'dwell', '--roundtrip', 'localDepht'], /--roundtrip names no such pass/],
    [['--mode', 'differential', '--roundtrip', 'localDepth'], /--mode differential, which would ignore it/],
    [['--mode', 'sweep', '--roundtrip', 'idle'], /--mode sweep, which would ignore it/],
    [['--budget-ms', 'soon'], /--budget-ms/],
    [['--dpr', '0'], /--dpr/],
    [['--scenario', ' , '], /names nothing/],
    [['--bogus'], /bogus/],
    [['stray'], /stray/],
  ])('rejects %j as an ArgError', (argv, message) => {
    expect(() => parseRunArgs(argv)).toThrow(ArgError);
    expect(() => parseRunArgs(argv)).toThrow(message);
  });

  it('prints every flag in the usage text', () => {
    const text = usage();
    for (const flag of [
      '--scenario', '--backend', '--mode', '--passes', '--method', '--budget-ms',
      '--dwell-frames', '--warmup-frames', '--settle-frames', '--empty-passes',
      '--no-interleave',
      '--headed', '--width', '--height', '--dpr', '--quiet-ms', '--url', '--chrome-arg',
      '--frames', '--roundtrip', '--scales', '--json', '--baseline',
    ]) {
      expect(text).toContain(flag);
    }
    for (const mode of MODES) expect(text).toContain(mode);
    for (const backend of BACKEND_REQUESTS) expect(text).toContain(backend);
  });
});
