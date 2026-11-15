import { describe, expect, it } from 'vitest';

import { CI_HEAP_LIMIT_MIB, CI_HEAP_HEADROOM, HEAP_BUDGET_MIB, heapCappedEnv, heapRuntimeVerdict, nodeMajor } from './heap-budget-pure';

describe('HEAP_BUDGET_MIB', () => {
  it('is the headroom share of the runner limit, in whole MiB', () => {
    expect(HEAP_BUDGET_MIB).toBe(Math.floor(CI_HEAP_LIMIT_MIB * CI_HEAP_HEADROOM));
    expect(HEAP_BUDGET_MIB).toBe(3481);
  });
});

describe('heapCappedEnv', () => {
  it('sets the old-space limit, after any NODE_OPTIONS already set so it wins', () => {
    expect(heapCappedEnv({ A: '1' }, 64)).toEqual({ A: '1', NODE_OPTIONS: '--max-old-space-size=64' });
    expect(heapCappedEnv({ NODE_OPTIONS: '--max-old-space-size=9000 --trace-gc' }, 64).NODE_OPTIONS)
      .toBe('--max-old-space-size=9000 --trace-gc --max-old-space-size=64');
  });
});

describe('heapRuntimeVerdict', () => {
  it('passes the pinned major and refuses another', () => {
    expect(heapRuntimeVerdict({ running: 26, pinned: 26 })).toEqual({ kind: 'pinned' });
    const other = heapRuntimeVerdict({ running: 24, pinned: 26 });
    expect(other.kind === 'other' && other.reason).toMatch(/^it runs under Node 24, but CI runs Node 26/);
  });
});

describe('nodeMajor', () => {
  it('reads process.version and .nvmrc spellings, and throws on neither', () => {
    expect(nodeMajor('v26', 'x')).toBe(26);
    expect(nodeMajor('26\n', 'x')).toBe(26);
    expect(() => nodeMajor('lts/*', '.nvmrc')).toThrow('.nvmrc: "lts/*" names no Node major');
  });
});
