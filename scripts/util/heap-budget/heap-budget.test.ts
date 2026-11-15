import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { heapCappedEnv } from './heap-budget-pure';
import { TSX } from '../../pipeline/processes';

const CAP_MIB = 64;
const dir = mkdtempSync(join(tmpdir(), 'heap-cap-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Exit status of a tsx process that holds `liveMib` MiB of doubles on the V8 heap at once. */
function holdLive(liveMib: number, env: NodeJS.ProcessEnv): number | null {
  const script = join(dir, `hold-${liveMib}.ts`);
  writeFileSync(script, `
const held: number[][] = [];
for (let i = 0; i < ${liveMib}; i++) held.push(new Array<number>(2 ** 17).fill(i + 0.5));
console.log(held.length);
`);
  return spawnSync(TSX, [script], { env, stdio: 'ignore' }).status;
}

describe('heapCappedEnv under tsx', () => {
  it('fails a step whose live peak is above the cap, and passes one below it', () => {
    expect(holdLive(CAP_MIB / 4, heapCappedEnv(process.env, CAP_MIB))).toBe(0);
    expect(holdLive(CAP_MIB * 2, heapCappedEnv(process.env, CAP_MIB))).not.toBe(0);
    expect(holdLive(CAP_MIB * 2, process.env)).toBe(0);
  }, 60_000);
});
