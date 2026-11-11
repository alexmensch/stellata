// A test's measured figures held in a committed snapshot the docs quote through markers: asserted against it, or rewritten under UPDATE_SNAPSHOTS=1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { UPDATE_SNAPSHOTS_ENV } from '../util/snapshot-check';

export type AssertClose = (actual: number, expected: number, digits: number) => void;

export interface FigurePins {
  readonly updating: boolean;
  /** Asserts `actual` against the snapshot's value to `digits` places, or records it when updating. */
  pin(key: string, actual: number, digits: number): void;
  /** Snapshot keys no `pin` has reached; empty after a whole run of the suite. */
  unpinned(): string[];
  /** Writes every recorded figure when updating; a no-op otherwise. */
  write(): void;
}

export function figurePins(
  snapshotPath: string,
  assertClose: AssertClose,
  updating = process.env[UPDATE_SNAPSHOTS_ENV] === '1',
): FigurePins {
  const expected: Record<string, number> = existsSync(snapshotPath)
    ? (JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, number>)
    : {};
  const recorded = new Map<string, number>();
  const refresh = `${UPDATE_SNAPSHOTS_ENV}=1 pnpm vitest run <this test file>, then pnpm run docs:figures`;

  return {
    updating,
    pin(key, actual, digits) {
      if (recorded.has(key)) throw new Error(`figure ${key} is pinned twice`);
      recorded.set(key, actual);
      if (updating) return;
      if (!Object.hasOwn(expected, key)) {
        throw new Error(`${snapshotPath} has no figure ${key}. To write it: ${refresh}`);
      }
      assertClose(actual, expected[key], digits);
    },
    unpinned: () => Object.keys(expected).filter((k) => !recorded.has(k)),
    write() {
      if (!updating) return;
      const merged = { ...expected, ...Object.fromEntries(recorded) };
      const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
      writeFileSync(snapshotPath, JSON.stringify(sorted, null, 2) + '\n');
    },
  };
}
