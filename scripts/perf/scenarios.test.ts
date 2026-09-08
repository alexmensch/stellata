import { describe, expect, it } from 'vitest';
import { SCENARIOS, SCENARIO_NAMES, scenarioUrl } from './scenarios';

describe('scenarios', () => {
  it('names the five canon vantages in canon order', () => {
    expect(SCENARIO_NAMES).toEqual(['sol', 'earth', 'mw50', 'mw120', 'lg']);
  });

  it('builds the canonical /app/v/<blob>/ path with no fragment on the default boot', () => {
    expect(scenarioUrl('http://localhost:5173', SCENARIOS.sol.blob, 'webgpu')).toBe(
      'http://localhost:5173/app/v/BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB/',
    );
  });

  it('appends the escape-hatch fragment for a WebGL2 boot and tolerates a trailing slash', () => {
    expect(scenarioUrl('http://localhost:5174/', 'BLOB', 'webgl2')).toBe(
      'http://localhost:5174/app/v/BLOB/#renderer=webgl2',
    );
  });
});
