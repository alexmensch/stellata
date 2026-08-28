// Enforces the rule "every folder has a README." A folder without a
// README.md is a bug — see AGENTS.md § Folder READMEs.

import { describe, it } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'scripts', 'data', 'docs'];

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.vite', '.wrangler', 'public',
  '__pycache__', '.beads', '.claude', '.venv', 'coverage',
  'screenshots',
]);

/** A batched refresh's resume cache (`<output>.tsv.ckpt/`, gitignored, removed
 *  once every batch lands — scripts/refresh/README.md § Resuming a long pull).
 *  It exists for hours during a normal pull, so matching it by name would mean
 *  this suite fails for anyone who runs the tests meanwhile. */
const EXCLUDED_SUFFIXES = ['.ckpt'];

function collectFolders(dir: string, out: string[]): void {
  out.push(dir);
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    if (EXCLUDED_SUFFIXES.some((s) => entry.endsWith(s))) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFolders(full, out);
    }
  }
}

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
    'See AGENTS.md § Folder READMEs for the full rule + read/update',
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
    const folders: string[] = [];
    for (const scan of SCAN_DIRS) {
      const full = resolve(ROOT, scan);
      if (!existsSync(full)) continue;
      collectFolders(full, folders);
    }
    const missing = folders
      .filter((f) => !existsSync(join(f, 'README.md')))
      .map((f) => relative(ROOT, f))
      .sort();
    if (missing.length > 0) {
      throw new Error(failureMessage(missing));
    }
  });
});
