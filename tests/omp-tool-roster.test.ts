// Holds scripts/hooks/omp-bridge-pure.ts's KNOWN_TOOLS against the tool
// rosters the installed omp actually ships, so a tool omp adds fails here
// rather than silently blocking a session.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_TOOLS } from '../scripts/hooks/omp-bridge-pure';

/**
 * omp publishes its tool list in three places that do not agree, so the test
 * pins the difference instead of trusting one. A source gaining or losing an
 * id fails here; growing KNOWN_TOOLS is then a deliberate edit.
 */
const COMPLETIONS_ONLY = [
  'ast_edit', 'ast_grep', 'checkpoint', 'debug', 'eval', 'github', 'hub',
  'learn', 'manage_skill', 'memory_edit', 'recall', 'reflect', 'retain',
  'rewind', 'security_scan',
];

/** `python` needs `omp setup python`; neither is offered to `--tools`. */
const HELP_ONLY = ['notebook', 'python'];

function ompPrefix(): string | undefined {
  let binary: string;
  try {
    binary = execFileSync('which', ['omp'], { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
  if (binary === '') return undefined;
  return dirname(dirname(realpathSync(binary)));
}

function zshRoster(prefix: string): string[] | undefined {
  const file = join(prefix, 'share/zsh/site-functions/_omp');
  if (!existsSync(file)) return undefined;
  const match = /_omp_tools\(\)\s*\{[^}]*'tools'\s+([^}]*?)\s*\}/.exec(
    readFileSync(file, 'utf-8'),
  );
  return match ? match[1].trim().split(/\s+/) : undefined;
}

function fishRoster(prefix: string): string[] | undefined {
  const file = join(prefix, 'share/fish/vendor_completions.d/omp.fish');
  if (!existsSync(file)) return undefined;
  const match = /-l tools\b[^\n]*?-a '([^']+)'/.exec(readFileSync(file, 'utf-8'));
  return match ? match[1].trim().split(/\s+/) : undefined;
}

function helpRoster(): string[] | undefined {
  let help: string;
  try {
    help = execFileSync('omp', ['--help'], { encoding: 'utf-8' });
  } catch {
    return undefined;
  }
  const section = /Available Tools[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/.exec(help);
  if (!section) return undefined;
  const ids: string[] = [];
  for (const line of section[1].split('\n')) {
    const entry = /^\s{2,}([a-z_][a-z0-9_]*)\s+-\s/.exec(line);
    if (entry) ids.push(entry[1]);
  }
  return ids.length > 0 ? ids : undefined;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function difference(a: string[], b: string[]): string[] {
  const other = new Set(b);
  return sorted(a.filter((id) => !other.has(id)));
}

const prefix = ompPrefix();
const zsh = prefix === undefined ? undefined : zshRoster(prefix);
const fish = prefix === undefined ? undefined : fishRoster(prefix);
const help = helpRoster();
const installed = zsh !== undefined && fish !== undefined && help !== undefined;

/**
 * `xd://` write devices are a fourth roster, and the one no completion list
 * or `--help` section carries: they arrive as a `write` whose path names them.
 * Scraped from the installed binary so a device omp adds fails here.
 */
function deviceRoster(): string[] | undefined {
  let binary: string;
  try {
    binary = realpathSync(execFileSync('which', ['omp'], { encoding: 'utf-8' }).trim());
  } catch {
    return undefined;
  }
  if (!existsSync(binary)) return undefined;
  const found = readFileSync(binary, 'latin1').match(/xd:\/\/[a-z_]+/g);
  return found === null ? undefined : sorted(found.map((url) => url.slice(5)));
}

const devices = deviceRoster();
const known = Object.keys(KNOWN_TOOLS);

describe.skipIf(!installed)('omp tool roster', () => {
  it('classifies every tool the shell completions offer', () => {
    expect(difference(zsh as string[], known)).toEqual([]);
  });

  it('classifies every tool --help lists', () => {
    expect(difference(help as string[], known)).toEqual([]);
  });

  it('keeps the zsh and fish completions identical', () => {
    expect(sorted(zsh as string[])).toEqual(sorted(fish as string[]));
  });

  it('holds the pinned disagreement between completions and --help', () => {
    expect(difference(zsh as string[], help as string[])).toEqual(sorted(COMPLETIONS_ONLY));
    expect(difference(help as string[], zsh as string[])).toEqual(sorted(HELP_ONLY));
  });
});

describe.skipIf(devices === undefined)('omp xd:// device roster', () => {
  it('classifies every device the installed binary names', () => {
    // A device absent from KNOWN_TOOLS took whichever branch its body's JSON
    // validity chose: prose passed ungated, JSON blocked. Both were wrong.
    expect(difference(devices as string[], known)).toEqual([]);
  });

  it('holds the devices that exist as literals rather than tool mounts', () => {
    expect(devices).toEqual(['goal', 'propose', 'reject', 'report_issue', 'resolve']);
  });
});

describe('omp tool roster (harness-independent)', () => {
  it('classifies apply_patch, which no roster lists', () => {
    // `edit` under `edit.mode: apply_patch` arrives on the wire as
    // `apply_patch`; it takes the same hashline payload and must gate alike.
    expect(KNOWN_TOOLS.apply_patch).toBe(true);
  });

  it('reads the installed rosters rather than a literal in this file', () => {
    const guardSource = readFileSync(
      resolve(__dirname, '../scripts/hooks/omp-bridge-pure.ts'),
      'utf-8',
    );
    for (const id of [...COMPLETIONS_ONLY, ...HELP_ONLY]) {
      expect(guardSource).toContain(`${id}: true`);
    }
  });
});
