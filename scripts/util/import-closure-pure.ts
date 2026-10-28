// A build's code inputs: its import closure plus the non-code files beside it. See README.md.

import { dirname, extname } from 'node:path';

const UNREAD_SIBLING_EXTENSIONS = new Set(['.ts', '.py', '.md']);

/** One `&&`-joined command of a package.json script. */
export type ScriptPart =
  | { readonly kind: 'tsx'; readonly entry: string; readonly args: readonly string[] }
  | { readonly kind: 'python'; readonly entry: string }
  | { readonly kind: 'pnpm'; readonly script: string }
  | { readonly kind: 'other'; readonly command: string };

function part(command: string): ScriptPart {
  const words = command.trim().split(/\s+/);
  if (words[0] === 'tsx' && /\.ts$/.test(words[1] ?? '')) return { kind: 'tsx', entry: words[1], args: words.slice(2) };
  if (words[0] === 'python3' && /\.py$/.test(words[1] ?? '')) return { kind: 'python', entry: words[1] };
  if (words[0] === 'pnpm' && words[1] === 'run' && words.length === 3) return { kind: 'pnpm', script: words[2] };
  return { kind: 'other', command: command.trim() };
}

export function scriptParts(scripts: Readonly<Record<string, string>>, name: string): ScriptPart[] {
  const script = scripts[name];
  if (script === undefined) throw new Error(`package.json has no script ${name}`);
  return script.split('&&').map(part);
}

/** The entry of a script that is exactly `tsx <file>.ts`: one module keys the whole step. */
export function tsxEntry(scripts: Readonly<Record<string, string>>, name: string): string {
  const parts = scriptParts(scripts, name);
  const [only] = parts;
  if (parts.length !== 1 || only.kind !== 'tsx' || only.args.length > 0) {
    throw new Error(`package.json script ${name} must be exactly "tsx <file>.ts", got ${JSON.stringify(scripts[name])}`);
  }
  return only.entry;
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
    if (closureDirs.has(dirname(path)) && !UNREAD_SIBLING_EXTENSIONS.has(extname(path))) {
      keyed.add(path);
    }
  }
  return [...keyed].sort();
}
