// Enforces the rule "every folder has a README." A folder without a
// README.md is a bug — see /AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit.

import { describe, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readmeTreeFolders } from './readme-trees';

const ROOT = resolve(__dirname, '..');

function failureMessage(missing: string[]): string {
  return [
    '',
    `Found ${missing.length} folder(s) without a README.md:`,
    ...missing.map((p) => `  ${p}`),
    '',
    'The codebase is organised as a wiki by progressive disclosure:',
    'folder name signals the topic, README.md carries the load-bearing',
    'context, code is the implementation. A folder without a README',
    'is a bug — the next session reading the code is missing the',
    'context layer.',
    '',
    'For each folder above, write a README.md that:',
    '  - States what the folder owns (one paragraph)',
    '  - Lists each file with a one-line description (the roster)',
    '  - Documents invariants, sentinels, pins, override mechanisms,',
    '    data-flow contracts that the code alone cannot tell a reader',
    '',
    'See /AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit for the full rule + read/update',
    'protocol.',
    '',
    'If a folder is genuinely contentless (e.g. a generated artifact',
    'directory not yet excluded), add its name to EXCLUDED_DIRS in',
    'this test file with a comment explaining why.',
    '',
  ].join('\n');
}

describe('folder README coverage', () => {
  it('every folder under src/, scripts/, data/, docs/ has a README.md', () => {
    const missing = readmeTreeFolders(ROOT)
      .filter((f) => !existsSync(join(f, 'README.md')))
      .map((f) => relative(ROOT, f))
      .sort();
    if (missing.length > 0) {
      throw new Error(failureMessage(missing));
    }
  });
});
