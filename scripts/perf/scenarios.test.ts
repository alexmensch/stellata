import { describe, expect, it } from 'vitest';
import { BACKENDS, SCENARIOS, SCENARIO_NAMES, TIER1_SCENARIOS, scenarioUrl } from './scenarios';

describe('scenarios', () => {
  it('names the five canon vantages in canon order', () => {
    expect(SCENARIO_NAMES).toEqual(['mw120', 'sol', 'earth', 'mw50', 'lg']);
  });

  // A row compares only against one taken at the same position in its run,
  // so the pin run has to visit the Tier 1 vantages first, in Tier 1's
  // order. Reordering either constant re-takes the pin.
  it('opens the canon with the Tier 1 vantages', () => {
    expect(TIER1_SCENARIOS).toEqual(['mw120', 'sol']);
    expect(SCENARIO_NAMES.slice(0, TIER1_SCENARIOS.length)).toEqual([...TIER1_SCENARIOS]);
    expect(BACKENDS).toEqual(['webgpu']);
  });

  it('builds the canonical /app/v/<blob>/ path with no fragment on the default boot', () => {
    expect(scenarioUrl('http://localhost:5173', SCENARIOS.sol.blob)).toBe(
      'http://localhost:5173/app/v/BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB/',
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(scenarioUrl('http://localhost:5174/', 'BLOB')).toBe(
      'http://localhost:5174/app/v/BLOB/',
    );
  });

  it('appends --hash as the fragment, and omits it when empty', () => {
    expect(scenarioUrl('http://h', 'B', 'webgpu-gate=force')).toBe('http://h/app/v/B/#webgpu-gate=force');
    expect(scenarioUrl('http://h', 'B', '')).toBe('http://h/app/v/B/');
  });
});
