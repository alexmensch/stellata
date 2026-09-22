import { describe, expect, it } from 'vitest';
import {
  BROWSER_CHANNEL, DWELL_METHOD, GATE_BOOT_PREFIX, bootFailure, bufferShortfall, describeProbe,
  markerVerdict, methodFor, planContexts, readbackOrder, runProvenance, softwareRenderer,
} from './run-pure';
import { SCENARIO_NAMES, TIER1_SCENARIOS } from './scenarios';
import type { AdapterProbe, GitProvenance } from './schema';

const HOUR_MS = 60 * 60 * 1000;

function probe(over: {
  renderer?: string;
  device?: string;
  description?: string;
  fallback?: boolean;
  webgl?: boolean;
  webgpu?: boolean;
} = {}): AdapterProbe {
  return {
    webgl: over.webgl === false ? null : {
      renderer: over.renderer ?? 'ANGLE (Apple, Apple M3 Max, OpenGL 4.1)',
      vendor: 'Google Inc. (Apple)',
      timerQuery: true,
    },
    webgpu: over.webgpu === false ? null : {
      vendor: 'apple',
      architecture: 'metal-3',
      device: over.device ?? '',
      description: over.description ?? 'Apple M3 Max',
      isFallbackAdapter: over.fallback ?? false,
      timestampsAvailable: true,
    },
  };
}

describe('methodFor', () => {
  it('leaves an ordinary run on the adapter\'s own best clock', () => {
    expect(methodFor({})).toEqual({ method: undefined, why: null });
  });

  it('pins wall time for a run that writes or reads the pin, and says why', () => {
    for (const args of [{ pin: 'p.json' }, { againstPin: 'p.json' }]) {
      const { method, why } = methodFor(args);
      expect(method).toBe(DWELL_METHOD);
      expect(why).toContain('every archived pin and baseline was recorded on it');
    }
  });

  it('honours an explicit pin over that default, silently', () => {
    expect(methodFor({ pin: 'p.json', method: 'timestamp' }))
      .toEqual({ method: 'timestamp', why: null });
  });
});

describe('planContexts — the order a run visits its contexts in', () => {
  it('runs one backend in the order the scenarios were given', () => {
    expect(planContexts(['sol', 'lg'], 'webgpu', [4])).toEqual([
      { name: 'sol', backend: 'webgpu', readbackEvery: 4 },
      { name: 'lg', backend: 'webgpu', readbackEvery: 4 },
    ]);
  });

  // The pin run and the Tier 1 run share their first two contexts, which is
  // what lets Tier 1 compare against the pin: rows compare at equal position.
  it('opens a pin run with exactly the contexts a Tier 1 run visits', () => {
    const pin = planContexts(SCENARIO_NAMES, 'webgpu', [4]);
    const tier1 = planContexts(TIER1_SCENARIOS, 'webgpu', [4]);
    expect(pin).toHaveLength(5);
    expect(pin.slice(0, tier1.length)).toEqual(tier1);
    expect(tier1.map((c) => `${c.name}|${c.backend}`)).toEqual(['mw120|webgpu', 'sol|webgpu']);
  });

  // A cadence probe: one context per cadence, and the first cadence again at
  // the end so the pair bounds the GPU's own drift across the run.
  it('visits a scenario once per cadence, first cadence repeated last', () => {
    expect(planContexts(['earth'], 'webgpu', [4, 1, 2]).map((c) => c.readbackEvery))
      .toEqual([4, 1, 2, 4]);
  });

  it('adds no repeat for a single cadence, which is every ordinary run', () => {
    expect(readbackOrder([4])).toEqual([4]);
    expect(planContexts(SCENARIO_NAMES, 'webgpu', [4])).toHaveLength(5);
  });
});

describe('softwareRenderer — nothing measured on one counts', () => {
  it('passes a real GPU', () => {
    expect(softwareRenderer(probe())).toBeNull();
  });

  it.each([
    ['SwiftShader Device (Subzero)'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)'],
    ['Software Rasterizer'],
  ])('catches %s in the WebGL renderer string', (renderer) => {
    expect(softwareRenderer(probe({ renderer }))).toBe(renderer);
  });

  it('catches a software name that only the WebGPU side carries', () => {
    expect(softwareRenderer(probe({ webgl: false, description: 'SwiftShader' }))).toBe('SwiftShader');
    expect(softwareRenderer(probe({ description: '', device: 'llvmpipe' }))).toBe('llvmpipe');
  });

  it('catches a fallback adapter that names no rasteriser at all', () => {
    expect(softwareRenderer(probe({ fallback: true }))).toBe('WebGPU fallback adapter');
  });

  it('passes a probe that found neither API rather than inventing a verdict', () => {
    expect(softwareRenderer({ webgl: null, webgpu: null })).toBeNull();
  });
});

describe('describeProbe', () => {
  it('spells out an absent timer query rather than printing a bare false', () => {
    const text = describeProbe(probe({ renderer: 'Apple GPU' }));
    expect(text).toContain('EXT_disjoint_timer_query_webgl2 present');
    expect(describeProbe({ webgl: { renderer: 'x', vendor: 'y', timerQuery: false }, webgpu: null }))
      .toContain('ABSENT');
  });

  it('says a WebGL2 boot has no WebGPU timestamp answer, rather than false', () => {
    const text = describeProbe({
      webgl: null,
      webgpu: {
        vendor: 'apple', architecture: 'metal-3', device: '', description: 'Apple M3 Max',
        isFallbackAdapter: false, timestampsAvailable: null,
      },
    });
    expect(text).toContain('unread');
    expect(text).toContain('no WebGL2 context');
  });
});

describe('bufferShortfall — the buffer the app drew against the one the flags asked for', () => {
  it('names the capped ratio when --dpr 3 comes back as a dpr 2 buffer', () => {
    const why = bufferShortfall({ width: 1280, height: 800, dpr: 3 }, { width: 2560, height: 1600 });
    expect(why).toContain('2560x1600 is under the requested 1280x800 @ dpr 3 = 3840x2400');
    expect(why).toContain('effective dpr 2.00');
    expect(why).toContain('--width/--height');
  });

  it('passes an honoured request, a larger viewport at the cap, and one pixel of rounding', () => {
    expect(bufferShortfall({ width: 1280, height: 800, dpr: 2 }, { width: 2560, height: 1600 })).toBeNull();
    expect(bufferShortfall({ width: 1920, height: 1200, dpr: 2 }, { width: 3840, height: 2400 })).toBeNull();
    expect(bufferShortfall({ width: 1281, height: 801, dpr: 1.5 }, { width: 1921, height: 1201 })).toBeNull();
  });
});

describe('markerVerdict — one arm is one launch attempt', () => {
  it('arms on a fresh marker', () => {
    expect(markerVerdict(true, 0, HOUR_MS)).toBe('armed');
    expect(markerVerdict(true, HOUR_MS, HOUR_MS)).toBe('armed');
  });

  it('refuses a marker past the hour', () => {
    expect(markerVerdict(true, HOUR_MS + 1, HOUR_MS)).toBe('stale');
  });

  it('refuses when there is no marker at all', () => {
    expect(markerVerdict(false, 0, HOUR_MS)).toBe('absent');
  });
});

describe('bootFailure — a boot that produced no page says which kind', () => {
  it('passes a booted page', () => {
    expect(bootFailure('ok')).toBeNull();
  });

  it('names the gate and its verdict, where the wait used to time out', () => {
    const why = bootFailure(`${GATE_BOOT_PREFIX}no-api`);
    expect(why).toContain('requires-WebGPU gate');
    expect(why).toContain("'no-api'");
  });

  it('carries a verdict it does not recognise through rather than dropping it', () => {
    expect(bootFailure(`${GATE_BOOT_PREFIX}unknown`)).toContain("'unknown'");
  });

  // The gate's prefix is what separates the two, so a loading-status that
  // reads like a verdict is still reported as the page's own error.
  it('reports a loading-status error as itself', () => {
    expect(bootFailure('Error: catalogue fetch failed')).toBe('Error: catalogue fetch failed');
  });
});

describe('runProvenance', () => {
  const GIT: GitProvenance = { commit: 'abc', dirty: false, mainCommit: 'def', mainReachable: true };
  const START = {
    startedAt: '2026-09-18T00:00:00.000Z',
    url: 'http://localhost:5173',
    browserVersion: '151.0',
    headless: true,
    chromeArgs: ['--ignore-gpu-blocklist'],
    git: GIT,
    gpu: null,
  };

  it('records the channel every launch here passes, as both name and channel', () => {
    const run = runProvenance(START);
    expect(run.browser.name).toBe(BROWSER_CHANNEL);
    expect(run.browser.channel).toBe(BROWSER_CHANNEL);
    expect(BROWSER_CHANNEL).toBe('chromium');
  });

  it("carries the caller's own fields through untouched", () => {
    const run = runProvenance({ ...START, headless: false, gpu: probe() });
    expect(run.startedAt).toBe(START.startedAt);
    expect(run.url).toBe(START.url);
    expect(run.git).toBe(GIT);
    expect(run.browser.version).toBe('151.0');
    expect(run.browser.headless).toBe(false);
    expect(run.browser.args).toEqual(['--ignore-gpu-blocklist']);
    expect(run.gpu).not.toBeNull();
  });

  it('stamps finishedAt at or after the start it was given', () => {
    const run = runProvenance(START);
    expect(Date.parse(run.finishedAt)).toBeGreaterThanOrEqual(Date.parse(START.startedAt));
  });

  it('takes argv and the host from the process, so neither instrument spells them', () => {
    const run = runProvenance(START);
    expect(run.argv).toEqual(process.argv.slice(2));
    expect(run.host).toEqual({ platform: process.platform, arch: process.arch });
  });
});
