// A pull's resume cache: each answered query's CSV reply and the service that answered it, keyed by the hash of its text. See README.md#the-checkpoint.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashBytes } from '../../util/stamp-hash';

/** `service` is null for a reply no network service gave: one seeded from committed rows. */
export interface CachedReply {
  readonly body: string;
  readonly service: string | null;
}

export interface Checkpoint {
  load(adql: string): CachedReply | null;
  save(adql: string, reply: CachedReply): void;
  clear(): void;
}

function writeAtomic(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

/** A changed query hashes to a different file, so it never replays an answer to the old one. */
export function checkpoint(dir: string): Checkpoint {
  const base = (adql: string): string => join(dir, hashBytes(adql));
  return {
    load(adql) {
      const csv = `${base(adql)}.csv`;
      if (!existsSync(csv)) return null;
      const meta = `${base(adql)}.json`;
      if (!existsSync(meta)) throw new Error(`${csv} has no record of the service that answered it; delete ${dir} and re-run`);
      const { service } = JSON.parse(readFileSync(meta, 'utf8')) as { service: string | null };
      return { body: readFileSync(csv, 'utf8'), service };
    },
    save(adql, reply) {
      mkdirSync(dir, { recursive: true });
      writeAtomic(`${base(adql)}.json`, JSON.stringify({ service: reply.service }));
      writeAtomic(`${base(adql)}.csv`, reply.body);
    },
    clear: () => rmSync(dir, { recursive: true, force: true }),
  };
}
