// A throwaway launchable entry that records each run of its main in a marker file, removed when the test finishes.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

const MARKER = 'runs';

export interface EntryFixture {
  readonly path: string;
  /** The arguments of each run of its main, in order. */
  readonly runs: () => string[];
}

export function writeEntryFixture(
  name: string, { mains = true, describes = true }: { mains?: boolean; describes?: boolean } = {},
): EntryFixture {
  const dir = mkdtempSync(join(tmpdir(), 'entry-fixture-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  const marker = join(dir, MARKER);
  writeFileSync(path, [
    "import { appendFileSync } from 'node:fs';",
    `${mains ? 'export ' : ''}function main(): number { appendFileSync(new URL('${MARKER}', import.meta.url), process.argv.slice(2).join(' ') + '\\n'); return 3; }`,
    ...(describes ? ["export function describe() { return { query: 'Q', services: ['svc'] }; }"] : []),
    '',
  ].join('\n'));
  return {
    path,
    runs: () => (existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').slice(0, -1) : []),
  };
}
