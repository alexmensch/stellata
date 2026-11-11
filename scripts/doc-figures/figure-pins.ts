// A test's measured figures held in a committed snapshot the docs quote through markers: asserted against it, or rewritten under UPDATE_SNAPSHOTS=1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { UPDATE_SNAPSHOTS_ENV } from '../util/snapshot-check';

/** Far tighter than any doc quotes a figure, so a re-measure that could move a quoted digit always fails. */
export const FIGURE_PIN_RELATIVE_TOLERANCE = 1e-9;

function parseFigures(path: string, text: string): Record<string, number> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must be one flat object of figures`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path}: figure ${key} is not a finite number`);
  }
  return parsed as Record<string, number>;
}

export interface FigurePins {
  /** Throws unless `actual` matches the snapshot's value; records it instead when updating. */
  pin(key: string, actual: number): void;
  /** Snapshot keys no `pin` has reached; empty after a whole run of the suite. */
  unpinned(): string[];
  /** Writes every recorded figure when updating; a no-op otherwise. */
  write(): void;
}

export function figurePins(
  snapshotPath: string,
  updating = process.env[UPDATE_SNAPSHOTS_ENV] === '1',
): FigurePins {
  const expected = existsSync(snapshotPath) ? parseFigures(snapshotPath, readFileSync(snapshotPath, 'utf8')) : {};
  const recorded = new Map<string, number>();
  const refresh = `${UPDATE_SNAPSHOTS_ENV}=1 pnpm vitest run <this test file>, then pnpm run docs:figures`;

  return {
    pin(key, actual) {
      if (recorded.has(key)) throw new Error(`figure ${key} is pinned twice`);
      recorded.set(key, actual);
      if (updating) return;
      if (!Object.hasOwn(expected, key)) {
        throw new Error(`${snapshotPath} has no figure ${key}. To write it: ${refresh}`);
      }
      const want = expected[key];
      if (Math.abs(actual - want) > FIGURE_PIN_RELATIVE_TOLERANCE * Math.abs(want)) {
        throw new Error(`figure ${key} measures ${actual}, ${snapshotPath} holds ${want}. If the move is intended: ${refresh}`);
      }
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
