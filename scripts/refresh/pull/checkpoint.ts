// A pull's resume cache: each answered query's CSV reply, keyed by the hash of its text. See README.md#the-checkpoint.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashBytes } from '../../util/stamp-hash';

export interface Checkpoint {
  load(adql: string): string | null;
  save(adql: string, body: string): void;
  clear(): void;
}

/** A changed query hashes to a different file, so it never replays an answer to the old one. */
export function checkpoint(dir: string): Checkpoint {
  const file = (adql: string): string => join(dir, `${hashBytes(adql)}.csv`);
  return {
    load: (adql) => (existsSync(file(adql)) ? readFileSync(file(adql), 'utf8') : null),
    save(adql, body) {
      mkdirSync(dir, { recursive: true });
      const staged = `${file(adql)}.tmp`;
      writeFileSync(staged, body);
      renameSync(staged, file(adql));
    },
    clear: () => rmSync(dir, { recursive: true, force: true }),
  };
}
