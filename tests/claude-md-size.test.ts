import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_LINES = 500;
const MAX_BYTES = 26 * 1024;

const claudeMdPath = resolve(process.cwd(), 'CLAUDE.md');
const content = readFileSync(claudeMdPath, 'utf8');
const lineCount = content.split('\n').length;
const byteCount = Buffer.byteLength(content, 'utf8');

function failureMessage(): string {
  return [
    '',
    `CLAUDE.md has grown past its budget`,
    `  (currently ${lineCount} lines / ${byteCount} bytes;`,
    `   max ${MAX_LINES} lines / ${MAX_BYTES} bytes).`,
    '',
    'CLAUDE.md is loaded into EVERY Claude Code session, so every',
    'line here costs context for the rest of the session.',
    '',
    'Per-area file rosters, architectural prose, and topic-specific',
    'gotchas belong in docs/<area>.md — see CLAUDE.md § Repo layout',
    'and § Documentation index for the topic-tree convention.',
    '',
    'If you are about to add something here:',
    '  1. Check whether a docs/<area>.md already covers the topic.',
    '     If yes, add the content there. CLAUDE.md only needs a',
    '     one-line trigger in § Documentation index pointing at it.',
    '  2. If it is a new top-level concept that does not fit the',
    '     existing topic tree, STOP and consult the user before',
    '     expanding CLAUDE.md or restructuring the docs tree. A',
    '     larger reorg (new top-level surface, threshold bump,',
    '     re-shaping the wiki) is a deliberate decision the user',
    '     wants in on.',
    '  3. Otherwise, trim or compress to fit the budget.',
    '',
  ].join('\n');
}

describe('CLAUDE.md size guard', () => {
  it(`is under ${MAX_LINES} lines`, () => {
    if (lineCount > MAX_LINES) {
      throw new Error(failureMessage());
    }
  });

  it(`is under ${MAX_BYTES} bytes`, () => {
    if (byteCount > MAX_BYTES) {
      throw new Error(failureMessage());
    }
  });
});
