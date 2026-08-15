// Tripwire for the hand audit of three's runtime surface: pins the version
// that audit was last run against. README.md § The three upgrade audit is the
// checklist, and the reason none of it can be pinned by a test instead.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AUDITED_THREE_RANGE = '^0.185.1';

describe('the three version the runtime audit was run against', () => {
  it('still matches the pinned dependency', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(
      pkg.dependencies.three,
      'three moved without the runtime audit being re-run — work README.md ' +
        '§ The three upgrade audit, then move AUDITED_THREE_RANGE',
    ).toBe(AUDITED_THREE_RANGE);
  });
});
