import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, lfsContentReadable } from '../../../util/paths';
import { lookupGliese } from '../../gliese-parse-pure';
import { GLIESE } from '../../gliese-source';
import { HIP2 } from '../../sources/hip2-source';
import type { Tycho2Row } from '../../tycho2-parse';
import { TYCHO2 } from '../../tycho2-source';
import { readArtifact } from '../../../util/sources/source';
import { INHERITED_SPINE } from '../../spine/inherited-spine-tsv';
import { linkTablesFrom, partitionRow } from '../../spine/association-audit-pure';
import { loadPrimaryTables } from '../../spine/primaries-tables';
import { applySpineCorrections } from '../spine-corrections/spine-corrections-pure';
import { SPINE_CORRECTIONS } from '../spine-corrections/spine-corrections-source';
import { pairLinksFrom } from '../merge-derivation/merge-derivation-pure';
import { spineIds } from '../../spine/inherited-spine-pure';
import {
  HIPPARCOS_WITNESS_TOLERANCE_ARCSEC, V70A_WITNESS_TOLERANCE_ARCSEC,
  hipparcosAstrometry, witnessHipparcos, witnessV70a, type WitnessVerdict,
} from './positional-witness-pure';

const readable = [
  DATA_FILES.tycho2Main, DATA_FILES.tycho2Suppl1, DATA_FILES.gliese, DATA_FILES.hip2, INHERITED_SPINE.file,
].every((f) => lfsContentReadable(resolve(REPO_ROOT, f)));

/** The largest separation at or under the tolerance and the smallest above it: the gap the constant sits in. */
function gapAround(separations: readonly number[], toleranceArcsec: number, digits: number): [number, number] {
  const round = (x: number) => Number(x.toFixed(digits));
  return [
    round(Math.max(...separations.filter((x) => x <= toleranceArcsec))),
    round(Math.min(...separations.filter((x) => x > toleranceArcsec))),
  ];
}

function tallyKinds(verdicts: readonly WitnessVerdict[]): Record<WitnessVerdict['kind'], number> {
  const out = { match: 0, none: 0, several: 0 };
  for (const v of verdicts) out[v.kind]++;
  return out;
}

describe.skipIf(!readable)('the witness over the populations it settles (README.md#the-tolerances)', () => {
  let tycho2: ReadonlyMap<string, Tycho2Row>;
  beforeAll(() => { tycho2 = TYCHO2.read(); });
  const candidates = (tycs: readonly string[]): Tycho2Row[] => tycs.map((tyc) => {
    const entry = tycho2.get(tyc);
    if (entry === undefined) throw new Error(`${tyc}: no Tycho-2 row`);
    return entry;
  });

  it("witnesses every spine pair whose HIP Gaia cross-matches to no source on HIP2's position", async () => {
    const spine = readArtifact(INHERITED_SPINE);
    const { kept } = applySpineCorrections(spine, SPINE_CORRECTIONS.read());
    const { links, hipEntries } = pairLinksFrom(await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== '')));
    const hip2 = HIP2.read().astrometry;
    const pairs = kept.flatMap((row) => {
      const hip = spineIds(row).hip;
      const entries = hip === null ? [] : hipEntries.get(hip) ?? [];
      return hip !== null && entries.length > 1 && entries.includes(row.tyc) && links.sourceOf.hip(hip) === null
        ? [{ hip, entries }] : [];
    });
    const verdicts = pairs.map(({ hip: hipNumber, entries }) => {
      const row = hip2.get(hipNumber);
      const hip = row === undefined ? null : hipparcosAstrometry(row);
      if (hip === null) throw new Error(`HIP ${hipNumber}: no HIP2 position and proper motion`);
      return witnessHipparcos(hip, candidates(entries));
    });
    expect(pairs.length).toBe(1046);
    expect(tallyKinds(verdicts)).toEqual({ match: 1034, none: 2, several: 10 });
    const nearest = verdicts.map((v) => v.separations[0].separationArcsec);
    expect(gapAround(nearest, HIPPARCOS_WITNESS_TOLERANCE_ARCSEC, 2)).toEqual([0.36, 1.05]);
    const insideV70aTolerance = verdicts.filter(
      (v) => v.separations.filter((s) => s.separationArcsec <= V70A_WITNESS_TOLERANCE_ARCSEC).length > 1,
    );
    expect(insideV70aTolerance.length).toBe(1024);
  }, 120_000);

  it("tests every unlinked GJ cell's V/70A position against the row's own TYC", async () => {
    const spine = readArtifact(INHERITED_SPINE);
    const { kept } = applySpineCorrections(spine, SPINE_CORRECTIONS.read());
    const links = linkTablesFrom(await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== '')));
    const rows = kept.filter((row) => row.tyc !== '' && partitionRow(row, links)?.minority.witnessed.includes('gl') === true);
    const gliese = GLIESE.read();
    const astrometry = rows.map((row) => ({ row, a: lookupGliese(gliese, row.gl)?.astrometryB1950 ?? null }));
    const witnessed = astrometry.flatMap(({ row, a }) => (a === null ? [] : [witnessV70a(a, candidates([row.tyc]))]));
    expect(rows.length).toBe(130);
    expect(astrometry.length - witnessed.length).toBe(1);
    expect(tallyKinds(witnessed)).toEqual({ match: 100, none: 29, several: 0 });
    const own = witnessed.map((v) => v.separations[0].separationArcsec);
    expect(gapAround(own, V70A_WITNESS_TOLERANCE_ARCSEC, 1)).toEqual([13.5, 20.7]);
  }, 120_000);
});
