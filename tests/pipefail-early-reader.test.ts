// Under pipefail, no scripts/ shell script pipes into a reader that can exit
// before its writer finishes — README.md#pipefail-early-readers.

import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');

const PIPE = String.raw`(?<!\|)\|(?!\|)&?\s*(?:\\\n\s*)?`;
const QUOTED = String.raw`'[^']*'|"(?:\\.|[^"\\])*"`;
const GREP_ARGS = new RegExp(String.raw`${PIPE}grep\b((?:${QUOTED}|[^'"\n|;&)])*)`, 'g');
const QUIET_FLAG = /(?:^|\s)(?:-[a-zA-Z0-9]*q[a-zA-Z0-9]*|--quiet|--silent)(?=\s|$)/;
const MAX_COUNT_FLAG = /(?:^|\s)(?:-[a-zA-Z]*m[0-9]*|--max-count(?:=\S*)?)(?=\s|$)/;
const SED_ARGS = new RegExp(String.raw`${PIPE}sed\b((?:${QUOTED}|[^'"\n|;&)])*)`, 'g');
const SED_QUIT = /(?:^|[\s;{}\/0-9$])[qQ][0-9]*\s*(?=[;}]|$)/m;
const HEAD = new RegExp(String.raw`${PIPE}head\b`, 'g');
const AWK_PROGRAM = new RegExp(String.raw`${PIPE}awk\b[^'\n]*'([^']*)'`, 'g');
const SETS_PIPEFAIL = /^\s*set\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*o\s+pipefail\b/m;

interface Offence {
  readonly line: number;
  readonly reader: 'grep -q' | 'grep -m' | 'head' | 'awk exit' | 'sed q';
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function earlyReaderPipes(script: string): Offence[] {
  const src = script.replace(/^[ \t]*#.*$/gm, '');
  const out: Offence[] = [];
  for (const m of src.matchAll(GREP_ARGS)) {
    const flags = m[1].replace(new RegExp(QUOTED, 'g'), ' ');
    if (QUIET_FLAG.test(flags)) out.push({ line: lineOf(src, m.index), reader: 'grep -q' });
    else if (MAX_COUNT_FLAG.test(flags)) out.push({ line: lineOf(src, m.index), reader: 'grep -m' });
  }
  for (const m of src.matchAll(SED_ARGS)) {
    const words = m[1].replace(/['"]/g, ' ');
    if (SED_QUIT.test(words)) out.push({ line: lineOf(src, m.index), reader: 'sed q' });
  }
  for (const m of src.matchAll(HEAD)) out.push({ line: lineOf(src, m.index), reader: 'head' });
  for (const m of src.matchAll(AWK_PROGRAM)) {
    if (/\bexit\b/.test(m[1])) out.push({ line: lineOf(src, m.index), reader: 'awk exit' });
  }
  return out.sort((a, b) => a.line - b.line);
}

const SOURCED = /^[ \t]*(?:\.|source)[ \t]+[^\n]*?([A-Za-z0-9_-][A-Za-z0-9_.-]*\.sh)\b/gm;

function pipefailScripts(): string[] {
  const all = [
    ...walkFiles(join(ROOT, 'scripts'), {
      skipDir: (name) => name === 'node_modules',
      include: (p) => p.endsWith('.sh'),
    }),
  ];
  const text = new Map(all.map((p) => [p, readFileSync(p, 'utf8')]));
  const scanned = new Set(all.filter((p) => SETS_PIPEFAIL.test(text.get(p)!)));
  const pending = [...scanned];
  for (let p = pending.pop(); p !== undefined; p = pending.pop()) {
    for (const [, name] of text.get(p)!.matchAll(SOURCED)) {
      for (const lib of all.filter((q) => basename(q) === name && !scanned.has(q))) {
        scanned.add(lib);
        pending.push(lib);
      }
    }
  }
  return [...scanned];
}

describe('earlyReaderPipes', () => {
  it.each([
    ['printf "%s" "$x" | grep -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep -qE "a|b"', 'grep -q'],
    ['printf "%s" "$x" | grep -Eq foo', 'grep -q'],
    ['printf "%s" "$x" | grep -E -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep --quiet foo', 'grep -q'],
    ['printf "%s" "$x" | grep -m1 -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep -e foo -q', 'grep -q'],
    ['printf "%s" "$x" |& grep -q foo', 'grep -q'],
    ['printf "%s" "$x" | grep "-q" -q', 'grep -q'],
    ['jq -r . | tr "\\n" " " | grep -qF "$s"', 'grep -q'],
    ['printf "%s" "$x" | grep -m1 foo', 'grep -m'],
    ['printf "%s" "$x" | grep -m 1 foo', 'grep -m'],
    ['printf "%s" "$x" | grep -Em1 foo', 'grep -m'],
    ['printf "%s" "$x" | grep --max-count=1 foo', 'grep -m'],
    ['printf "%s" "$x" | sed -n "1p;q"', 'sed q'],
    ['printf "%s" "$x" | sed -n \'/a/{s//b/p;q;}\'', 'sed q'],
    ['printf "%s" "$x" | sed 5q', 'sed q'],
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
    'printf "%s" "$x" | grep -E " -q" > out',
    'printf "%s" "$x" | grep -c foo; other -q',
    'printf "%s" "$x" | grep -E "-m1" > out',
    'printf "%s" "$x" | sed \'s/q/x/\'',
    'printf "%s" "$x" | sed -E \'s/quit/x/g\'',
    'printf "%s" "$x" | sed -n \'s/a/\\1/p\'',
    'x=$(sed -n \'/a/{p;q;}\' <<< "$s")',
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

  it('also scans the libraries those scripts source, which run under their pipefail', () => {
    const found = pipefailScripts().map((p) => relative(ROOT, p));
    expect(found).toContain('scripts/hooks/command-match.sh');
    expect(found).toContain('scripts/perf/arming/perf-go-lib.sh');
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
