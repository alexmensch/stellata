// Holds the generated .omp/rules/*.md against the bucket omp will sort each
// into. Both failures here are silent at runtime: the file still exists, still
// parses, and still says what it used to.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function frontmatter(rel: string): string {
  const text = readFileSync(resolve(ROOT, rel), 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (match === null) throw new Error(`${rel} has no frontmatter`);
  return match[1];
}

describe('.omp/rules/bd-prime.md', () => {
  it('is always-apply, which is what puts the memories in the system prompt', () => {
    expect(frontmatter('.omp/rules/bd-prime.md')).toMatch(/^alwaysApply: true$/m);
  });

  it('carries no condition, which would divert it out of the always-apply bucket', () => {
    // bucketRules tests `condition`/`astCondition` FIRST and `continue`s on a
    // hit, so a rule with either never reaches the alwaysApply branch. Adding
    // one here would stop the memories reaching the system prompt while the
    // file still reads as though they do — the exact failure the Claude-side
    // prime gate exists to prevent, reintroduced by one frontmatter line.
    expect(frontmatter('.omp/rules/bd-prime.md')).not.toMatch(/^(?:ast)?[Cc]ondition:/m);
  });
});

describe('.omp/rules/code-comments.md', () => {
  const meta = frontmatter('.omp/rules/code-comments.md');

  it('carries the condition that makes it a TTSR trigger at all', () => {
    expect(meta).toMatch(/^condition:$/m);
  });

  it('interrupts tool calls only, never prose', () => {
    // These patterns match ordinary prose about beads. Under the default
    // `always`, every reply naming a bead id would abort its own turn.
    expect(meta).toMatch(/^interruptMode: tool-only$/m);
  });

  it('scopes by path, because a bare extension glob matches on basename', () => {
    // `*.ts` would fire on the suites whose fixtures are deliberately full of
    // bead ids, starting with tests/code-comment-rules.test.ts.
    expect(meta).toMatch(/tool:edit\(src\/\*\*\/\*\.ts\)/);
    expect(meta).not.toMatch(/tool:(?:edit|write)\(\*\./);
  });
});
