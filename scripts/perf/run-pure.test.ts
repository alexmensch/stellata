import { describe, expect, it } from 'vitest';
import { DWELL_METHOD, describeProbe, markerVerdict, methodFor, softwareRenderer } from './run-pure';
import type { AdapterProbe } from './schema';

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
  it('leaves each backend on its own best clock when only one is asked for', () => {
    expect(methodFor({ backend: 'webgl2' })).toEqual({ method: undefined, why: null });
    expect(methodFor({ backend: 'webgpu' })).toEqual({ method: undefined, why: null });
  });

  it('pins wall time for a two-backend run, and says why', () => {
    const { method, why } = methodFor({ backend: 'both' });
    expect(method).toBe(DWELL_METHOD);
    expect(why).toContain('the one clock WebGL2 and WebGPU share');
  });

  it('honours an explicit pin over the both-backend default, silently', () => {
    expect(methodFor({ backend: 'both', method: 'timestamp' }))
      .toEqual({ method: 'timestamp', why: null });
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
    expect(text).toContain('n/a on a webgl2 boot');
    expect(text).toContain('no WebGL2 context');
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
