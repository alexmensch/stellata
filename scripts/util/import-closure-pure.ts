// A build's code inputs: its import closure plus the non-code files beside it. See README.md.

import { dirname, extname } from 'node:path';

export const CODE_FILE = /\.(py|ts|mts)$/;

/** The one `tsx` entry a script names: it runs the entry after it (`runStep`). */
export const LAUNCHER = 'scripts/util/launch.ts';

/** One `&&`-joined command of a package.json script. */
export type ScriptPart =
  | { readonly kind: 'tsx'; readonly entry: string; readonly args: readonly string[] }
  | { readonly kind: 'python'; readonly entry: string }
  | { readonly kind: 'pnpm'; readonly script: string }
  | { readonly kind: 'other'; readonly command: string };

function part(command: string): ScriptPart {
  const words = command.trim().split(/\s+/);
  if (words[0] === 'tsx' && words[1] === LAUNCHER && /\.ts$/.test(words[2] ?? '')) return { kind: 'tsx', entry: words[2], args: words.slice(3) };
  if (words[0] === 'python3' && /\.py$/.test(words[1] ?? '')) return { kind: 'python', entry: words[1] };
  if (words[0] === 'pnpm' && words[1] === 'run' && words.length === 3) return { kind: 'pnpm', script: words[2] };
  return { kind: 'other', command: command.trim() };
}

export function scriptParts(scripts: Readonly<Record<string, string>>, name: string): ScriptPart[] {
  const script = scripts[name];
  if (script === undefined) throw new Error(`package.json has no script ${name}`);
  return script.split('&&').map(part);
}

/** Every `tsx` entry a script runs, chained ones included. */
export function tsxEntries(scripts: Readonly<Record<string, string>>, name: string): string[] {
  return scriptParts(scripts, name).flatMap((p) => (p.kind === 'tsx' ? [p.entry] : []));
}

/** `closure` plus every file in `files` that sits in a closure module's folder
 *  and is not itself code or prose — the `*-expected.json` snapshots a build
 *  reads by path rather than by import. Repo-relative paths, sorted. */
export function closureWithSiblings(closure: ReadonlySet<string>, files: Iterable<string>): string[] {
  const closureDirs = new Set([...closure].map(dirname));
  const keyed = new Set(closure);
  for (const path of files) {
    if (closureDirs.has(dirname(path)) && !CODE_FILE.test(path) && extname(path) !== '.md') {
      keyed.add(path);
    }
  }
  return [...keyed].sort();
}
