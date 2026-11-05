// A throwaway launchable entry that records each run of its main in a marker file.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EntryFixture {
  readonly path: string;
  /** The arguments of each run of its main, in order. */
  readonly runs: () => string[];
}

export function writeEntryFixture(name: string, { describes = true }: { describes?: boolean } = {}): EntryFixture {
  const dir = mkdtempSync(join(tmpdir(), 'entry-fixture-'));
  const path = join(dir, name);
  const marker = join(dir, 'runs');
  writeFileSync(path, [
    "import { appendFileSync } from 'node:fs';",
    `export function main(): number { appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n'); return 3; }`,
    ...(describes ? ["export function describe() { return { query: 'Q', services: ['svc'] }; }"] : []),
    '',
  ].join('\n'));
  return {
    path,
    runs: () => (existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').slice(0, -1) : []),
  };
}
