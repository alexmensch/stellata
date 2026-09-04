// Enforces the comment-rule "law" section of AGENTS.md across src/ and
// scripts/ TS/Py source. Fails CI when bead-IDs, PR references, memory-
// key wikilinks, or oversized module docstrings appear — see
// docs/authoring-patterns.md § Code-comment hygiene for the rules.

import { describe, expect, it } from 'vitest';
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
      "const PERF_SCHEMA = 'stellata-perf/1';",
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
