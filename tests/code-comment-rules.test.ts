// Enforces the comment-rule "law" section of AGENTS.md across src/ and
// scripts/ TS/Py source. Fails CI when bead-IDs, PR references, memory-
// key wikilinks, or oversized module docstrings appear — see
// docs/authoring-patterns.md § Code-comment hygiene for the rules.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';
import { loadCommentRules } from '../scripts/hooks/comment-rules';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'scripts'];
const DOCSTRING_ALLOWLIST_PATH = resolve(__dirname, 'code-comment-rules-allowlist.txt');

function loadDocstringAllowlist(): Set<string> {
  const text = readFileSync(DOCSTRING_ALLOWLIST_PATH, 'utf8');
  const out = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.add(line);
  }
  return out;
}
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.vite', '.wrangler', 'public',
  '__pycache__', '.beads', '.claude', '.venv', 'coverage',
]);
const SELF = resolve(__filename);

interface Pattern {
  name: string;
  re: RegExp;
}

// scripts/hooks/comment-rules.json is the single source of truth: this suite,
// commit-sweep-guard.sh and the generated TTSR rule all read it. It drifted
// once already — the shell copy pinned the epic slug to three characters after
// this file widened it to five, so every bead on a four- or five-character
// epic stopped being caught at commit time.
const FORBIDDEN: Pattern[] = loadCommentRules(ROOT).map((entry) => ({
  name: entry.name,
  re: new RegExp(entry.pattern, entry.flags),
}));

const walk = (dir: string): Generator<string> =>
  walkFiles(dir, {
    skipDir: (name) => EXCLUDED_DIRS.has(name),
    include: (path) => /\.(?:ts|js|py)$/.test(path) && !/\.d\.ts$/.test(path),
  });

interface Violation {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

function scanFile(path: string): Violation[] {
  if (resolve(path) === SELF) return [];
  const content = readFileSync(path, 'utf8');
  // Generated files opt out via a top-of-file marker. Matches the
  // existing AUTO-GENERATED convention used in scripts/-side codegen.
  if (content.includes('AUTO-GENERATED')) return [];
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of FORBIDDEN) {
      if (p.re.test(line)) {
        violations.push({
          file: relative(ROOT, path),
          line: i + 1,
          pattern: p.name,
          text: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

function collectAllViolations(): Violation[] {
  const all: Violation[] = [];
  for (const root of SCAN_DIRS) {
    const start = join(ROOT, root);
    try { statSync(start); } catch { continue; }
    for (const path of walk(start)) {
      all.push(...scanFile(path));
    }
  }
  return all;
}

// Module-docstring length: count consecutive leading comment lines (//
// for TS, # or """ block for Py) before the first non-comment line.
function moduleDocstringLines(path: string): number {
  const content = readFileSync(path, 'utf8');
  if (content.includes('AUTO-GENERATED')) return 0;
  const lines = content.split('\n');
  let i = 0;
  // Skip leading blanks and shebangs.
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('#!'))) i++;
  if (i >= lines.length) return 0;
  let count = 0;
  if (path.endsWith('.ts') || path.endsWith('.js')) {
    if (lines[i].trim().startsWith('//')) {
      while (i < lines.length && lines[i].trim().startsWith('//')) {
        count++; i++;
      }
    } else if (lines[i].trim().startsWith('/*')) {
      // Block comment — count lines until */ inclusive.
      while (i < lines.length) {
        count++;
        if (lines[i].includes('*/')) { i++; break; }
        i++;
      }
    }
  } else if (path.endsWith('.py')) {
    const t = lines[i].trim();
    if (t.startsWith('"""') || t.startsWith("'''")) {
      const quote = t.startsWith('"""') ? '"""' : "'''";
      // Single-line docstring (open and close on same line).
      const rest = t.slice(3);
      if (rest.endsWith(quote) && rest.length >= 3) return 1;
      count = 1; i++;
      while (i < lines.length) {
        count++;
        if (lines[i].includes(quote)) { i++; break; }
        i++;
      }
    }
  }
  return count;
}

// The scan is only as good as the shapes it recognises, and a silent gap
// here reads as compliance: EPIC_SHAPE was pinned to exactly 3 characters
// for a long time, which exempted xypg / 3bsf / o6nx / t2u5 / uadc / zau1 —
// most of the epics in use — with a green suite the whole time.
describe('forbidden-pattern shapes', () => {
  const matches = (line: string) => FORBIDDEN.some(p => p.re.test(line));

  it('catches bead IDs at every epic-slug length', () => {
    for (const id of [
      'stellata-9mm.227', 'stellata-dch.83.9', 'stellata-xypg.29',
      'stellata-3bsf.4', 'stellata-o6nx.1', 'stellata-zau1',
      'uadc.3', 'xypg.12', 'a7d.2.11', 'pre-dch.5', 'since-t2u5.7',
    ]) {
      expect(matches(`// something ${id} something`), id).toBe(true);
    }
  });

  it('catches PR refs and memory-key wikilinks', () => {
    expect(matches('// see PR #12 for the rationale')).toBe(true);
    expect(matches('// extracted in PR 341')).toBe(true);
    expect(matches('// per [[stellata-bd-operations]]')).toBe(true);
  });

  it('leaves ordinary prose and numerals alone', () => {
    for (const line of [
      '// 365.25 days per Julian year',
      '// clamped to 180.0 degrees',
      '// the 100.5 pc cutoff',
      '// bumped to v3.16.0 this release',
      '// hip-2.5 is not a bead',
      '// see stellata-events.test.ts for the wiring',
      // A slash makes it a path or a namespaced identifier. No bead ID is
      // ever followed by one, and the 3-5 char slug window cannot tell
      // 'perf' from a real epic slug like 'cns' or 'dch' any other way.
      "const PERF_SCHEMA = 'stellata-perf/2';",
      '// the arm protocol lives in .claude/skills/stellata-perf/SKILL.md',
      '// writes public/catalog.bin.0 and .bin.1',
      '// Table 24.3 gives the integrated starlight',
      '// a tab-escaped TSV cell like \\t20.85 in the Python parser',
    ]) {
      expect(matches(line), line).toBe(false);
    }
  });
});

describe('forbidden code-comment patterns', () => {
  it('no bead-IDs, PR refs, or memory-key wikilinks in src/ or scripts/', () => {
    const violations = collectAllViolations();
    if (violations.length === 0) return;
    violations.sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file));
    const formatted = violations
      .map(v => `  ${v.file}:${v.line} [${v.pattern}]\n    ${v.text}`)
      .join('\n');
    throw new Error(
      `\nForbidden code-comment patterns found (${violations.length}):\n\n${formatted}\n\n` +
      'See AGENTS.md § "Code comments — what CI enforces here" for the rules.\n' +
      'Substitutions: credit a bead → commit subject (not the code). ' +
      'Reference a memory → no link in code (memories are invisible to readers). ' +
      'Cite a PR → drop it; git blame carries the history.\n'
    );
  });
});

// Comment vs code lines in one file. Blank lines count as neither. `#`
// is a comment only in Python — a TS line can open with a private field.
function commentCodeLines(path: string): { comment: number; code: number } {
  const content = readFileSync(path, 'utf8');
  if (content.includes('AUTO-GENERATED')) return { comment: 0, code: 0 };
  const py = path.endsWith('.py');
  let comment = 0;
  let code = 0;
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const s = raw.trim();
    if (s === '') continue;
    if (inBlock) {
      comment++;
      if (s.includes('*/')) inBlock = false;
      continue;
    }
    if (s.startsWith('/*')) {
      comment++;
      if (!s.includes('*/')) inBlock = true;
      continue;
    }
    if (s.startsWith('//') || (py && s.startsWith('#'))) { comment++; continue; }
    code++;
  }
  return { comment, code };
}

/** Paths out of `git status --porcelain`. The status and its separator are
 *  fixed-width, and a rename prints `old -> new`, the new name being the one
 *  that exists to be read. */
export function parseStatusPaths(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const path = line.slice(3).trim().split(' -> ').pop()?.replace(/^"|"$/g, '');
    if (path !== undefined && path !== '') out.push(path);
  }
  return out;
}

/** Every path this change touches: the working tree (staged, unstaged and
 *  untracked) plus the branch's own commits against the default branch, so the
 *  set survives the agent having already committed. Empty on any git failure —
 *  this suite must never fail, so a broken git degrades the report instead. */
function changedPaths(): Set<string> {
  const out = new Set<string>();
  const run = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return ''; }
  };
  for (const path of parseStatusPaths(run(['status', '--porcelain']))) out.add(path);
  for (const base of ['origin/main', 'main']) {
    const merge = run(['merge-base', base, 'HEAD']).trim();
    if (merge === '') continue;
    for (const path of run(['diff', '--name-only', '--diff-filter=d', merge, 'HEAD']).split('\n')) {
      if (path.trim() !== '') out.add(path.trim());
    }
    break;
  }
  return out;
}

describe('the changed-file set behind the ratio report', () => {
  it('takes a rename by its new name and unwraps a quoted path', () => {
    expect(parseStatusPaths([
      ' M src/client/stellata.ts',
      'A  src/client/webgpu/extinction/probe.ts',
      '?? scripts/perf/scratch.ts',
      'R  src/old/name.ts -> src/new/name.ts',
      '?? "quoted/path with space.ts"',
      '',
    ].join('\n'))).toEqual([
      'src/client/stellata.ts',
      'src/client/webgpu/extinction/probe.ts',
      'scripts/perf/scratch.ts',
      'src/new/name.ts',
      'quoted/path with space.ts',
    ]);
  });

  it('yields nothing for a clean tree, so the report falls back to its summary', () => {
    expect(parseStatusPaths('')).toEqual([]);
    expect(parseStatusPaths('\n\n')).toEqual([]);
  });
});

// Reports, never fails. A hard threshold would be wrong in both
// directions — a derivation-heavy pure helper is legitimately 60% prose
// while a renderer at 40% is bloat — and the useful output is a list of
// files to trim, which a pass/fail verdict cannot carry.
//
// It lists only the files THIS change touches, because a tree-wide top ten
// reads identically whether the diff is one file or fifty, and a report
// that cannot say which of its rows are yours is one a reader learns to
// scroll past. The standing backlog keeps a single summary line.
describe('comment-to-code ratio', () => {
  const TARGET_FILE_SHARE_PCT = 20;
  // One floor for the listed rows and the backlog tally both, so the tally
  // stays a superset of what is printed above it.
  const MIN_FILE_LINES = 40;
  const REPORT_CAP = 10;

  it(`reports source files over ${TARGET_FILE_SHARE_PCT}% comment lines`, () => {
    const changed = changedPaths();
    let comment = 0;
    let code = 0;
    const files: Array<{ file: string; comment: number; code: number; mine: boolean }> = [];
    for (const root of SCAN_DIRS) {
      const start = join(ROOT, root);
      try { statSync(start); } catch { continue; }
      for (const path of walk(start)) {
        if (resolve(path) === SELF) continue;
        // Suites carry explanatory prose by design and are half the tree
        // by line count, so including them dilutes the signal to nothing.
        if (/\.test\./.test(path)) continue;
        const r = commentCodeLines(path);
        comment += r.comment;
        code += r.code;
        const file = relative(ROOT, path);
        if (r.comment + r.code >= MIN_FILE_LINES) {
          files.push({ file, ...r, mine: changed.has(file) });
        }
      }
    }
    const pct = (c: number, k: number) => (100 * c) / (c + k);
    const overall = pct(comment, code).toFixed(1);
    const over = files
      .filter(f => pct(f.comment, f.code) > TARGET_FILE_SHARE_PCT)
      .sort((a, b) => b.comment - a.comment);
    const row = (f: typeof files[number]) =>
      `  ${pct(f.comment, f.code).toFixed(0).padStart(3)}%  `
      + `${String(f.comment).padStart(4)} comment / ${String(f.code).padStart(4)} code  ${f.file}`;
    const backlog = `src/ and scripts/ are ${overall}% overall, ${over.length} files `
      + `of ${MIN_FILE_LINES}+ lines over ${TARGET_FILE_SHARE_PCT}%`;

    const mine = over.filter(f => f.mine);
    if (mine.length === 0) {
      if (over.length === 0) return;
      process.stderr.write(`\nComment lines: ${backlog}; none of them in this change.\n`);
      return;
    }

    const rest = mine.length > REPORT_CAP
      ? `\n  … and ${mine.length - REPORT_CAP} more in this change.\n` : '\n';
    process.stderr.write(
      `\n── prose-heavy files IN THIS CHANGE ──────────────────────────\n`
      + `${mine.length} file${mine.length === 1 ? ' you touched is' : 's you touched are'} `
      + `over ${TARGET_FILE_SHARE_PCT}% comment lines, most prose first:\n\n`
      + mine.slice(0, REPORT_CAP).map(row).join('\n') + rest
      + `\nTrim these. For each block, in this order:\n`
      + `  1. Does it need to exist at all? Identifiers, types and control flow\n`
      + `     are the explanation. Deleting is the default, not the fallback.\n`
      + `  2. Does it explain a decision, an invariant, a rejected alternative,\n`
      + `     or anything a reader needs BEFORE they touch the code? That is the\n`
      + `     folder README's job — move it there and leave a pointer at most.\n`
      + `  3. Only prose whose absence would make a reader of THIS line act\n`
      + `     wrongly stays in the code.\n`
      + `AGENTS.md § Code comments; docs/authoring-patterns.md § Defer doc updates.\n\n`
      + `Standing backlog, not a gate: ${backlog}.\n`
      + `──────────────────────────────────────────────────────────────\n`
    );
  });
});

describe('module docstring length', () => {
  const MAX_LINES = 3;
  const allowlist = loadDocstringAllowlist();

  it(`every non-allowlisted module docstring is ≤ ${MAX_LINES} lines`, () => {
    const offenders: Array<{ file: string; lines: number }> = [];
    for (const root of SCAN_DIRS) {
      const start = join(ROOT, root);
      try { statSync(start); } catch { continue; }
      for (const path of walk(start)) {
        if (resolve(path) === SELF) continue;
        const rel = relative(ROOT, path);
        if (allowlist.has(rel)) continue;
        const count = moduleDocstringLines(path);
        if (count > MAX_LINES) {
          offenders.push({ file: rel, lines: count });
        }
      }
    }
    if (offenders.length === 0) return;
    offenders.sort((a, b) => a.file.localeCompare(b.file));
    const formatted = offenders
      .map(o => `  ${o.file}: ${o.lines} lines (max ${MAX_LINES})`)
      .join('\n');
    throw new Error(
      `\nModule docstrings exceed the ${MAX_LINES}-line cap (${offenders.length} files):\n\n${formatted}\n\n` +
      'AGENTS.md says: "Module docstrings: 1–3 lines, no exceptions." ' +
      'Move detail to the folder README.md with a one-line code-side pointer.\n\n' +
      'If the file is pre-existing tech-debt, add it to ' +
      'tests/code-comment-rules-allowlist.txt — but the goal is for the ' +
      'allowlist to shrink, not grow.\n'
    );
  });

  it('allowlist contains no stale entries (every listed file still exists and still exceeds the cap)', () => {
    const stale: string[] = [];
    for (const rel of allowlist) {
      const abs = resolve(ROOT, rel);
      let exists = true;
      try { statSync(abs); } catch { exists = false; }
      if (!exists) {
        stale.push(`${rel} (file no longer exists)`);
        continue;
      }
      const count = moduleDocstringLines(abs);
      if (count <= MAX_LINES) {
        stale.push(`${rel} (docstring trimmed to ${count} lines — remove from allowlist)`);
      }
    }
    if (stale.length === 0) return;
    throw new Error(
      `\nStale allowlist entries (${stale.length}):\n  ${stale.join('\n  ')}\n\n` +
      'Edit tests/code-comment-rules-allowlist.txt to remove them — the ' +
      'allowlist exists to shrink over time, and stale entries hide real ' +
      'progress.\n'
    );
  });
});
