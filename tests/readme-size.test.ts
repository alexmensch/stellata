// Caps folder README size. Companion to folder-readme-coverage.test.ts:
// that one enforces "every folder has a README", this one enforces "no
// README is too long to be worth reading." See /AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { README_TREES, readmeTreeFolders } from './readme-trees';

const ROOT = resolve(__dirname, '..');

const MAX_LINES = 450;

// Documented exceptions. An entry must say why splitting the folder is
// the WRONG fix — the cap's default remedy is to split, so anything
// listed here needs a reason that survives a future session re-reading
// it with the intent to "finally clean this up."
const ALLOWLIST: Record<string, string> = {
  'scripts/catalog/companions/README.md':
    'One pass (promoteCompanions) over one row type, whose post-passes all ' +
    'read state the cursor walk accumulated. Every seam measured needs ' +
    'MultiplesTsvRow plus 2-4 value helpers back OUT of the parent (the ' +
    'wrong split, per AGENTS.md). Anchor flux conservation, the largest ' +
    'topic at 91 lines, also writes seven counters ' +
    'on PromotionStats that build-catalog reads, and placement needs ' +
    'hasRenderableOrbit and the WDS letter algebra the rest of the pass ' +
    'uses too. The science half is ' +
    'already in docs/science-multiple-star-pipeline.md and the naming half ' +
    'in ../naming/ and record-index/; what is left is the per-gate ' +
    'engineering contract.',
};

// A trailing newline terminates the last line rather than starting a new
// one, so splitting on it alone counts one line too many and the advertised
// cap enforces one below itself.
function countLines(content: string): number {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function lineCount(path: string): number {
  return countLines(readFileSync(path, 'utf8'));
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
    '     help (see the scripts/catalog/companions entry in ALLOWLIST',
    '     for the worked example of a folder where it does not).',
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
  it('counts a newline-terminated file the way wc -l does', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('')).toBe(0);
    expect(countLines('\n')).toBe(1);
  });

  it(`every README under ${README_TREES.join(', ')} is at most ${MAX_LINES} lines`, () => {
    const offenders = readmeTreeFolders(ROOT)
      .map((dir) => join(dir, 'README.md'))
      .filter((p) => existsSync(p))
      .map((p) => ({
        path: relative(ROOT, p),
        lines: lineCount(p),
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
      const lines = lineCount(full);
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
