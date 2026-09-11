import { describe, expect, it } from 'vitest';
import { BACKENDS, SCENARIOS, SCENARIO_NAMES, TIER1_SCENARIOS, scenarioUrl } from './scenarios';

describe('scenarios', () => {
  it('names the five canon vantages in canon order', () => {
    expect(SCENARIO_NAMES).toEqual(['mw120', 'sol', 'earth', 'mw50', 'lg']);
  });

  // A row compares only against one taken at the same position in its run,
  // so the pin run has to visit the Tier 1 vantages first, in Tier 1's order,
  // on the backend Tier 1 measures. Reordering either constant re-takes the pin.
  it('opens the canon with the Tier 1 vantages, and the gated backend first', () => {
    expect(TIER1_SCENARIOS).toEqual(['mw120', 'sol']);
    expect(SCENARIO_NAMES.slice(0, TIER1_SCENARIOS.length)).toEqual([...TIER1_SCENARIOS]);
    expect(BACKENDS).toEqual(['webgpu', 'webgl2']);
  });

  it('builds the canonical /v/<blob>/ path with no fragment on the default boot', () => {
    expect(scenarioUrl('http://localhost:5173', SCENARIOS.sol.blob, 'webgpu')).toBe(
      'http://localhost:5173/v/BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB/',
    );
  });

  it('appends the escape-hatch fragment for a WebGL2 boot and tolerates a trailing slash', () => {
    expect(scenarioUrl('http://localhost:5174/', 'BLOB', 'webgl2')).toBe(
      'http://localhost:5174/v/BLOB/#renderer=webgl2',
    );
  });

  it('composes --hash with the backend fragment: both present, either alone, neither', () => {
    expect(scenarioUrl('http://h', 'B', 'webgl2', 'webgpu-gate=force')).toBe('http://h/v/B/#renderer=webgl2&webgpu-gate=force');
    expect(scenarioUrl('http://h', 'B', 'webgpu', 'webgpu-gate=force')).toBe('http://h/v/B/#webgpu-gate=force');
    expect(scenarioUrl('http://h', 'B', 'webgl2', '')).toBe('http://h/v/B/#renderer=webgl2');
    expect(scenarioUrl('http://h', 'B', 'webgpu', '')).toBe('http://h/v/B/');
  });
});
