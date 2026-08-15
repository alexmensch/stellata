// Recursive file walk shared by the repo-meta scanners.
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

export interface WalkOptions {
  include?: (path: string) => boolean;
  skipDir?: (name: string) => boolean;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function* walkFiles(dir: string, opts: WalkOptions = {}): Generator<string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (opts.skipDir?.(entry.name)) continue;
    const path = join(dir, entry.name);
    // A symlinked directory must be recursed, not yielded as a file:
    // public/ legitimately carries symlinked build artifacts, and the
    // bundle guard has to see inside them.
    if (entry.isDirectory() || (entry.isSymbolicLink() && isDir(path))) {
      yield* walkFiles(path, opts);
    } else if (!opts.include || opts.include(path)) {
      yield path;
    }
  }
}
