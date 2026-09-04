import { describe, expect, it } from 'vitest';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl } from './scenarios';

describe('scenarios', () => {
  it('names the five canon vantages in canon order', () => {
    expect(SCENARIO_NAMES).toEqual(['sol', 'earth', 'mw50', 'mw120', 'lg']);
  });

  it('builds the canonical /v/<blob>/ path with no fragment on a WebGL2 boot', () => {
    expect(scenarioUrl('http://localhost:5173', SCENARIOS.sol.blob, 'webgl2')).toBe(
      'http://localhost:5173/v/BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB/',
    );
  });

  it('appends only the renderer fragment for a WebGPU boot and tolerates a trailing slash', () => {
    expect(scenarioUrl('http://localhost:5174/', 'BLOB', 'webgpu')).toBe(
      'http://localhost:5174/v/BLOB/#renderer=webgpu',
    );
  });
});
