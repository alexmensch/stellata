import { describe, expect, it } from 'vitest';
import { ARG_DEFAULTS, ArgError, parseRunArgs, usage } from './args';
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
    });
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
      '--settle-frames', '12', '--width', '1920', '--height', '1080', '--dpr', '1',
      '--quiet-ms', '2000', '--no-interleave', '--headed', '--method', 'raf-delta',
      '--backend', 'webgpu', '--mode', 'probe',
    ]);
    expect(a.budgetMs).toBe(90000);
    expect(a.dwellFrames).toBe(240);
    expect(a.warmupFrames).toBe(60);
    expect(a.settleFrames).toBe(12);
    expect([a.width, a.height, a.dpr]).toEqual([1920, 1080, 1]);
    expect(a.quietMs).toBe(2000);
    expect(a.interleave).toBe(false);
    expect(a.headed).toBe(true);
    expect(a.method).toBe('raf-delta');
    expect(a.backend).toBe('webgpu');
    expect(a.mode).toBe('probe');
  });

  it.each([
    [['--scenario', 'mars'], /--scenario/],
    [['--backend', 'metal'], /--backend/],
    [['--mode', 'dwell'], /--mode/],
    [['--method', 'stopwatch'], /--method/],
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
      '--dwell-frames', '--warmup-frames', '--settle-frames', '--no-interleave',
      '--headed', '--width', '--height', '--dpr', '--quiet-ms', '--url', '--chrome-arg',
    ]) {
      expect(text).toContain(flag);
    }
  });
});
