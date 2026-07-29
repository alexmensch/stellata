import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_LINES = 330;
const MAX_BYTES = 16 * 1024;

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
    'The codebase is organised as a wiki: every folder owns one topic,',
    'documented in its own README.md. Per-area architectural prose,',
    'file rosters, and topic-specific gotchas belong in the folder\'s',
    'README.md — NOT in CLAUDE.md. See CLAUDE.md § Repo layout for',
    'the wiki convention.',
    '',
    'If you are about to add something here:',
    '  1. Check whether the matching folder\'s README.md already covers',
    '     the topic. If yes, add the content there. CLAUDE.md should',
    '     not need to mention it — the folder + README is the index.',
    '  2. If the topic is genuinely cross-cutting (spans the whole',
    '     codebase, not one folder), it may belong in docs/. Examples:',
    '     authoring-patterns.md (write-time rules), ux-tweaks.md (knob',
    '     reference across many files). Default is still a folder',
    '     README — only fall back to docs/ if no folder fits.',
    '  3. If it is a universal preference rather than a stellata fact',
    '     (how to write comments, PR bodies, git flow), it belongs in',
    '     the user-level CLAUDE.md, not here — this file carries only',
    '     what is specific to this project.',
    '  4. If it is a new top-level convention that the existing wiki',
    '     shape cannot host, STOP and consult the user before',
    '     expanding CLAUDE.md or restructuring the wiki. A larger reorg',
    '     (new top-level folder surface, threshold bump, re-shaping the',
    '     wiki) is a deliberate decision the user wants in on.',
    '  5. Otherwise, trim or compress to fit the budget.',
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
