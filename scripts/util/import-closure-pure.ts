// A build's code inputs: its import closure plus the non-code files beside it. See README.md.

import { dirname, extname } from 'node:path';

const UNREAD_SIBLING_EXTENSIONS = new Set(['.ts', '.py', '.md']);

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
