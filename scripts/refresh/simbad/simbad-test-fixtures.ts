// Fixtures the SIMBAD suites share: a manifest record with named cells set, a fake SIMBAD built from per-object ids, and a committed table's replay.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import { declareOutputs, type DeclaredOutputs } from '../../util/emit-artifacts';
import { runPhasedPull, type PhasedPull } from '../pull/pull';
import { QUIET_DEPS } from '../pull/recorded-reply';
import { SIMBAD } from '../pull/tap-pure';
import { fakeTransport, type FakeSimbad } from './simbad-fake-pure';

export function record(cells: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    tyc: null, hip: null, hd: null, hdAlt: [], hr: null, hrAlt: [], gl: null, flam: null, bayer: null, proper: null,
    gaiaSourceId: null, binding: 'none', routes: '', term: 'primaries', originKey: 'test', isSol: false, ...cells,
  };
}

/** A fake SIMBAD holding `ids` per oid and `basic` cells per oid. */
export function simbad(
  ids: Readonly<Record<number, readonly string[]>>, basic: Readonly<Record<number, Readonly<Record<string, string | null>>>> = {},
): FakeSimbad {
  return {
    idents: Object.entries(ids).flatMap(([oid, list]) => list.map((id) => ({ oid: Number(oid), id }))),
    basic: new Map(Object.entries(basic).map(([oid, cells]) => [Number(oid), cells])),
  };
}

/** A replay's ceiling: every committed-table replay runs in under 4 s alone. */
export const REPLAY_TIMEOUT_MS = 30_000;

/** What `build`'s pull writes to its one output, `key`, run against `fake`. */
export async function replayedTable<K extends string>(build: (outputs: DeclaredOutputs<K>) => PhasedPull<K>, key: K, fake: FakeSimbad): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'simbad-replay-'));
  try {
    const file = join(dir, 'replayed.tsv');
    const pull = build(declareOutputs({ [key]: file } as Record<K, string>));
    await runPhasedPull(pull, { ...QUIET_DEPS, transport: fakeTransport(fake, pull.phases, SIMBAD.quote) });
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
