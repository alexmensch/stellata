import { describe, expect, it } from 'vitest';

import { testsNotRun, type VitestJsonReport } from './vitest-skips-pure';

const ROOT = '/repo';

function report(...statuses: string[]): VitestJsonReport {
  return {
    numTotalTests: statuses.length,
    testResults: [
      {
        name: `${ROOT}/scripts/x/x.test.ts`,
        assertionResults: statuses.map((status, i) => ({ fullName: `case ${i}`, status })),
      },
    ],
  };
}

describe('testsNotRun', () => {
  it('passes and failures both ran', () => {
    expect(testsNotRun(report('passed', 'failed'), ROOT)).toEqual([]);
  });

  it('names every skipped, pending and todo test by repo-relative file', () => {
    expect(testsNotRun(report('passed', 'skipped', 'pending', 'todo'), ROOT)).toEqual([
      'SKIPPED scripts/x/x.test.ts › case 1',
      'PENDING scripts/x/x.test.ts › case 2',
      'TODO scripts/x/x.test.ts › case 3',
    ]);
  });
});
