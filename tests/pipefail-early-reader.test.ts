// Under pipefail, no scripts/ shell script pipes into a reader that can exit
// before its writer finishes — README.md#pipefail-early-readers.

import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');

const PIPE = String.raw`(?<!\|)\|(?![|&])\s*(?:\\\n\s*)?`;
const GREP_QUIET = new RegExp(String.raw`${PIPE}grep((?:\s+-[a-zA-Z-]+)*)`, 'g');
const HEAD = new RegExp(String.raw`${PIPE}head\b`, 'g');
const AWK_PROGRAM = new RegExp(String.raw`${PIPE}awk\b[^'\n]*'([^']*)'`, 'g');
const SETS_PIPEFAIL = /^\s*set\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*o\s+pipefail\b/m;

interface Offence {
  readonly line: number;
  readonly reader: 'grep -q' | 'head' | 'awk exit';
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function earlyReaderPipes(script: string): Offence[] {
  const src = script.replace(/^[ \t]*#.*$/gm, '');
  const out: Offence[] = [];
  for (const m of src.matchAll(GREP_QUIET)) {
    if (/(?:^|\s)(?:-[a-zA-Z]*q|--quiet|--silent)/.test(m[1])) out.push({ line: lineOf(src, m.index), reader: 'grep -q' });
  }
  for (const m of src.matchAll(HEAD)) out.push({ line: lineOf(src, m.index), reader: 'head' });
  for (const m of src.matchAll(AWK_PROGRAM)) {
    if (/\bexit\b/.test(m[1])) out.push({ line: lineOf(src, m.index), reader: 'awk exit' });
  }
  return out.sort((a, b) => a.line - b.line);
}

function pipefailScripts(): string[] {
  const files = walkFiles(join(ROOT, 'scripts'), {
    skipDir: (name) => name === 'node_modules',
    include: (p) => p.endsWith('.sh'),
  });
  return [...files].filter((p) => SETS_PIPEFAIL.test(readFileSync(p, 'utf8')));
}

describe('earlyReaderPipes', () => {
  it.each([
    ['printf "%s" "$x" | grep -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep -qE "a|b"', 'grep -q'],
    ['printf "%s" "$x" | grep -Eq foo', 'grep -q'],
    ['printf "%s" "$x" | grep -E -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep --quiet foo', 'grep -q'],
    ['jq -r . | tr "\\n" " " | grep -qF "$s"', 'grep -q'],
    ['sed -n p "$f" | head -1', 'head'],
    ['x="$(printf "%s" "$c" \\\n  | sed -n p \\\n  | head -1)"', 'head'],
    ['done < <(printf "%s" "$s" | awk -v k="$k" \'\n  $1 == k { print; exit }\n\')', 'awk exit'],
  ])('flags %j', (script, reader) => {
    expect(earlyReaderPipes(script).map((o) => o.reader)).toEqual([reader]);
  });

  it.each([
    'grep -q foo <<< "$x"',
    'test -f x || grep -q foo file',
    'printf "%s" "$x" | grep -oE "[a-z]+"',
    'printf "%s" "$x" | grep -E "a|b" > out',
    'printf "%s" "$x" | awk \'{ print $1 }\'',
    'printf "%s" "$x" | header',
    '  # never printf | grep -q, never | head -1',
    'x=$(awk \'NR == 1 { print; exit }\' <<< "$s")',
  ])('passes %j', (script) => {
    expect(earlyReaderPipes(script)).toEqual([]);
  });

  it('reports the line the pipe sits on', () => {
    expect(earlyReaderPipes('set -euo pipefail\n\na | head -1\n')).toEqual([{ line: 3, reader: 'head' }]);
  });
});

describe('pipefail scripts under scripts/', () => {
  it('finds the scripts that set pipefail', () => {
    const found = pipefailScripts().map((p) => relative(ROOT, p));
    expect(found).toContain('scripts/hooks/commit-sweep/commit-sweep-guard.sh');
    expect(found).toContain('scripts/hooks/perf-guard.sh');
  });

  it('pipe into no reader that exits before its writer finishes', () => {
    const offences = pipefailScripts().flatMap((p) => {
      const rel = relative(ROOT, p);
      return earlyReaderPipes(readFileSync(p, 'utf8')).map((o) => `${rel}:${o.line} — pipe into ${o.reader}`);
    });
    expect(
      offences,
      'Under pipefail, a reader that exits early SIGPIPEs a writer still holding multi-line input and the pipeline fails. Feed the reader a here-string (<<< "$var") instead — /tests/README.md#pipefail-early-readers.',
    ).toEqual([]);
  });
});
