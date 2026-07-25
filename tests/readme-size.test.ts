// Caps folder README size. Companion to folder-readme-coverage.test.ts:
// that one enforces "every folder has a README", this one enforces "no
// README is too long to be worth reading." See CLAUDE.md § Folder READMEs.

import { describe, it } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

// The trees scripts/hooks/readme-guard.sh gates. A README outside them
// costs nothing until a session deliberately opens it, so it isn't capped
// (research/ holds frozen reports that are allowed to run long).
const SCAN_DIRS = ['src', 'scripts', 'data', 'docs'];

const MAX_LINES = 450;

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.vite', '.wrangler', 'public',
  '__pycache__', '.beads', '.claude', '.venv', 'coverage',
  'screenshots',
]);

// Documented exceptions. An entry must say why splitting the folder is
// the WRONG fix — the cap's default remedy is to split, so anything
// listed here needs a reason that survives a future session re-reading
// it with the intent to "finally clean this up."
const ALLOWLIST: Record<string, string> = {
  'scripts/binaries/README.md':
    'Seven-stage linear pipeline where stage N consumes every earlier ' +
    'stage. Splitting into resolve/pairs/emit measured 65 cross-folder ' +
    'import edges vs 32 same-folder, and because readme-guard charges ' +
    'the nearest README per folder touched, a stage-6 task would read ' +
    '~910 lines across four READMEs instead of this one file — no ' +
    'saving, plus duplicated rosters and no typechecker to verify the ' +
    'rewrite. Already trimmed of everything that had another home; the ' +
    'remainder is per-stage engineering contract.',
};

function collectReadmes(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectReadmes(full, out);
    } else if (entry === 'README.md') {
      out.push(full);
    }
  }
}

function failureMessage(
  offenders: { path: string; lines: number }[],
): string {
  return [
    '',
    `${offenders.length} folder README(s) past the ${MAX_LINES}-line cap:`,
    ...offenders.map((o) => `  ${o.lines} lines  ${o.path}`),
    '',
    'Folder READMEs are not free to grow. scripts/hooks/readme-guard.sh',
    'blocks every Read / Grep / Edit under src/, scripts/, data/, docs/',
    "until the containing folder's README has been read this session, so",
    'each line here is a tax on every future session that touches the',
    'folder — paid before any code is read.',
    '',
    'The fix, in order of preference:',
    '',
    '  1. SPLIT THE FOLDER into subfolders, each owning one topic, each',
    '     with its own README. The guard resolves to the NEAREST README,',
    '     so a subfolder README fully replaces the parent for reads',
    '     inside it — this removes the tax rather than relocating it.',
    '     Check the seam first: if the candidate subfolder imports its',
    '     way back into the parent on every file, the split will not',
    '     help (see the scripts/binaries entry in ALLOWLIST for the',
    '     worked example of a folder where it does not).',
    '',
    '  2. Relocate science narrative to docs/science-*.md and leave a',
    '     one-line pointer. Applies to physics derivations and',
    '     calibration rationale — NOT to shader-uniform contracts,',
    '     invariants, sentinels, or pins, which belong in the README.',
    '',
    '  3. Drop content that duplicates another folder\'s README. A',
    '     roster listing files this folder does not own is the common',
    '     case.',
    '',
    'What NOT to do: delete invariants, sentinels, pins, or override',
    'mechanisms to fit the cap. That content is the entire reason the',
    'README exists — a single sentence about a uniform pin or a',
    'sentinel is often the whole explanation for a bug whose symptom',
    'looks unrelated. If a README genuinely cannot fit without losing',
    'that, add it to ALLOWLIST with a reason, and say why splitting is',
    'the wrong fix.',
    '',
  ].join('\n');
}

describe('folder README size guard', () => {
  it(`every README under ${SCAN_DIRS.join(', ')} is at most ${MAX_LINES} lines`, () => {
    const readmes: string[] = [];
    for (const scan of SCAN_DIRS) {
      const full = resolve(ROOT, scan);
      if (!existsSync(full)) continue;
      collectReadmes(full, readmes);
    }

    const offenders = readmes
      .map((p) => ({
        path: relative(ROOT, p),
        lines: readFileSync(p, 'utf8').split('\n').length,
      }))
      .filter((o) => o.lines > MAX_LINES && !(o.path in ALLOWLIST))
      .sort((a, b) => b.lines - a.lines);

    if (offenders.length > 0) {
      throw new Error(failureMessage(offenders));
    }
  });

  it('every ALLOWLIST entry still exists and still needs the exemption', () => {
    const stale: string[] = [];
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      const full = resolve(ROOT, rel);
      if (!existsSync(full)) {
        stale.push(`${rel} — listed but does not exist; drop the entry`);
        continue;
      }
      const lines = readFileSync(full, 'utf8').split('\n').length;
      if (lines <= MAX_LINES) {
        stale.push(
          `${rel} — now ${lines} lines, under the ${MAX_LINES} cap; ` +
            'drop the entry so the file is guarded again',
        );
      }
      if (reason.trim().length < 40) {
        stale.push(`${rel} — reason too thin to be useful to a future session`);
      }
    }
    if (stale.length > 0) {
      throw new Error(
        '\nALLOWLIST is out of date:\n' +
          stale.map((s) => `  ${s}`).join('\n') +
          '\n\nAn exemption that is no longer needed hides the next ' +
          'regression behind it.\n',
      );
    }
  });
});
