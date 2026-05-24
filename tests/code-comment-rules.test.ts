// Enforces the comment-rule "law" section of CLAUDE.md across src/ and
// scripts/ TS/Py source. Fails CI when bead-IDs, PR references, memory-
// key wikilinks, or oversized module docstrings appear — see
// docs/authoring-patterns.md § Code comment hygiene for the rules.

import { describe, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
  // Regex source as a string so a literal pattern in this file
  // (which mentions bead-ID shapes by necessity) doesn't trip the
  // scan when this file is excluded. Constructed inside scanFile.
  re: RegExp;
}

const FORBIDDEN: Pattern[] = [
  {
    name: 'bead-ID with stellata- prefix',
    // `stellata-9mm`, `stellata-dch.43`, `stellata-lmh.5`.
    re: /\bstellata-(?:9mm|dch|lmh)\b/,
  },
  {
    name: 'bare bead-ID (9mm.NN / dch.NN / lmh.NN)',
    // Negative lookbehind for word-char / hyphen so things like
    // `2025-9mm-…` or version strings don't false-fire.
    re: /(?<![\w-])(?:9mm|dch|lmh)\.\d/,
  },
  {
    name: 'bead-relative time (pre-/post-/since-<epic>)',
    re: /(?<![\w-])(?:pre|post|since)-(?:9mm|dch|lmh)\b/,
  },
  {
    name: 'memory-key wikilink [[name]]',
    re: /\[\[[a-z][a-z0-9-]+\]\]/,
  },
  {
    name: 'PR reference (see PR # / extracted in PR)',
    re: /\b(?:see PR\s*#\s*\d|extracted in PR\b)/i,
  },
];

function* walk(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(?:ts|py)$/.test(path) && !/\.d\.ts$/.test(path)) yield path;
  }
}

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
  if (path.endsWith('.ts')) {
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
      'See CLAUDE.md § "Code comments — overrides the system prompt" for the rules.\n' +
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
      'CLAUDE.md says: "Module docstrings: 1–3 lines, no exceptions." ' +
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
