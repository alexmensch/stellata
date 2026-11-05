import { describe, expect, it } from 'vitest';

import { J2000_JD } from '../../src/astro-core/astronomy-constants';
import {
  FLAG_HAS_INCLINATION, FLAG_HAS_ORBIT, FLAG_IS_INNER_OF_HIERARCHY, HEADER_SIZE, MAGIC, NO_PARENT,
  RECORD_LAYOUT, RECORD_SIZE, VERSION,
} from '../../src/catalog-format/binaries/binaries-format';
import type { CatalogRowIndexMap } from '../catalog/companions/record-index/catalog-row-index-map-pure';
import { multiplesRow } from '../catalog/companions/multiples-fixture';
import {
  assignParentRelations,
  encodeBinaries,
  overrideInnerPrimaryIndices,
  pairsFromRows,
  sameRelationAlias,
  topologicalWalkOrder,
  type MultiplesPair,
} from './runtime-binaries-pure';

const ORBIT = { pDays: 365.25, tJd: 2451545, e: 0.5, aAU: 10, omegaRad: 1, q: 0.5 };

function pair(systemId = '00000+0000-AB', over: Partial<MultiplesPair> = {}): MultiplesPair {
  const components = systemId.slice(systemId.lastIndexOf('-') + 1);
  const [primaryComp, secondaryComp] = components.includes(',')
    ? components.split(',')
    : [components[0], components[1] ?? ''];
  return {
    systemId, components, primaryComp, secondaryComp,
    primaryGaia: '1', primaryHip: null, secondaryGaia: '2', secondaryHip: null,
    pDays: null, tJd: null, e: null, aAU: null, iRad: null, omegaRad: null, OmegaRad: null, q: null,
    sepArcsec: null, paDeg: null, sepPaEpochJd: null,
    ...over,
  };
}

function map(over: Partial<CatalogRowIndexMap> = {}): CatalogRowIndexMap {
  return { byGaia: { 1: 100, 2: 200, 3: 300, 4: 400 }, byHip: {}, bySynth: {}, ...over };
}

/** Encodes top-level pairs in input order. */
function encodeFlat(pairs: MultiplesPair[], m: CatalogRowIndexMap = map()) {
  const parents = pairs.map(() => NO_PARENT);
  return encodeBinaries(pairs, parents, pairs.map((_, i) => i), m);
}

function record(bytes: Uint8Array, i: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const off = HEADER_SIZE + i * RECORD_SIZE;
  return {
    primary: view.getUint32(off + RECORD_LAYOUT.primary_idx, true),
    secondary: view.getUint32(off + RECORD_LAYOUT.secondary_idx, true),
    flags: view.getUint32(off + RECORD_LAYOUT.flags, true),
    parent: view.getInt32(off + RECORD_LAYOUT.parent_relation, true),
    epoch: view.getFloat32(off + RECORD_LAYOUT.sep_pa_epoch_jd, true),
  };
}

describe('pairsFromRows', () => {
  it('joins a system’s primary and secondary, the elements from the primary', () => {
    const [p] = pairsFromRows([
      multiplesRow({ systemId: '03082+4057-Aa1,2', comp: 'Aa1', orbitRole: 'primary', hip: 14576, pDays: 2.87 }),
      multiplesRow({ systemId: '03082+4057-Aa1,2', comp: '2', orbitRole: 'secondary', gaiaSourceId: '9' }),
    ]);
    expect(p).toMatchObject({
      components: 'Aa1,2', primaryComp: 'Aa1', secondaryComp: 'Aa2',
      primaryHip: 14576, secondaryGaia: '9', pDays: 2.87,
    });
  });

  it('skips a system missing a side, and standalone rows', () => {
    expect(pairsFromRows([
      multiplesRow({ systemId: '00000+0000-AB', comp: 'A', orbitRole: 'primary' }),
      multiplesRow({ systemId: '-_C', comp: 'C', orbitRole: 'standalone' }),
    ])).toEqual([]);
  });
});

describe('assignParentRelations', () => {
  it('a top-level pair has no parent', () => {
    expect(assignParentRelations([pair()])).toEqual([NO_PARENT]);
  });

  it('an inner pair finds the outer pair naming its parent token (Algol)', () => {
    expect(assignParentRelations([pair('03082+4057-Aa,Ab'), pair('03082+4057-Aa1,Aa2')]))
      .toEqual([NO_PARENT, 0]);
  });

  it('nests a WDS-truncated inner pair through its re-anchored tokens', () => {
    expect(assignParentRelations([pair('03082+4057-Aa,Ab'), pair('03082+4057-Aa1,2')]))
      .toEqual([NO_PARENT, 0]);
  });

  it('pairs in different systems are never parents of each other', () => {
    expect(assignParentRelations([pair('00000+0000-AB'), pair('11111+1111-AB')]))
      .toEqual([NO_PARENT, NO_PARENT]);
  });

  it('an unsplittable components field takes no parent', () => {
    expect(assignParentRelations([pair('00000+0000-X')])).toEqual([NO_PARENT]);
  });

  it('prefers the bound parent over an element-less wide pair (Castor)', () => {
    // A sits in both the bound AB and the wide AC; Aa,Ab nests under AB. AC
    // comes last so a last-write-wins bucket would pick it.
    const ab = pair('07346+3153-AB', { ...ORBIT, sepArcsec: 5.4 });
    const aaAb = pair('07346+3153-Aa,Ab', { ...ORBIT, sepArcsec: 0 });
    const ac = pair('07346+3153-AC', { sepArcsec: 69.6 });
    expect(assignParentRelations([ab, aaAb, ac])).toEqual([NO_PARENT, 0, NO_PARENT]);
  });
});

describe('overrideInnerPrimaryIndices', () => {
  it('re-homes an inner primary onto its parent component slot (Castor Ba)', () => {
    // Ba carries A's blended source, so its own resolve lands on A (98630);
    // AB resolved B onto its synth record (179304).
    const resolvedPrimary = [98630, 98630];
    overrideInnerPrimaryIndices(
      [pair('07346+3153-AB'), pair('07346+3153-Ba,Bb')], [NO_PARENT, 0], [0, 1],
      resolvedPrimary, [179304, 321187],
    );
    expect(resolvedPrimary).toEqual([98630, 179304]);
  });

  it('leaves an inner primary already on its parent slot', () => {
    const resolvedPrimary = [98630, 98630];
    overrideInnerPrimaryIndices(
      [pair('07346+3153-AB'), pair('07346+3153-Aa,Ab')], [NO_PARENT, 0], [0, 1],
      resolvedPrimary, [179304, 319645],
    );
    expect(resolvedPrimary).toEqual([98630, 98630]);
  });

  it('leaves top-level pairs alone', () => {
    const resolvedPrimary = [98630];
    overrideInnerPrimaryIndices([pair('07346+3153-AB')], [NO_PARENT], [0], resolvedPrimary, [179304]);
    expect(resolvedPrimary).toEqual([98630]);
  });

  it('a deeper nest inherits its parent’s corrected slot', () => {
    const resolvedPrimary = [98630, 98630, 98630];
    overrideInnerPrimaryIndices(
      [pair('07346+3153-AB'), pair('07346+3153-Ba,Bb'), pair('07346+3153-Ba1,Ba2')],
      [NO_PARENT, 0, 1], [0, 1, 2], resolvedPrimary, [179304, 321187, 400000],
    );
    expect(resolvedPrimary).toEqual([98630, 179304, 179304]);
  });
});

describe('topologicalWalkOrder', () => {
  it('roots alone keep input order', () => {
    expect(topologicalWalkOrder([NO_PARENT, NO_PARENT, NO_PARENT])).toEqual([0, 1, 2]);
  });

  it('a parent listed after its child is still emitted first', () => {
    expect(topologicalWalkOrder([1, NO_PARENT])).toEqual([1, 0]);
  });

  it('a dangling parent link falls through as an orphan', () => {
    expect(topologicalWalkOrder([NO_PARENT, 5])).toEqual([0, 1]);
  });

  it('a multi-level chain runs outer to inner', () => {
    expect(topologicalWalkOrder([NO_PARENT, 0, 1])).toEqual([0, 1, 2]);
  });
});

describe('encodeBinaries', () => {
  it('writes the header: magic, version, count', () => {
    const { bytes } = encodeFlat([pair()]);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe(MAGIC);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(VERSION);
    expect(view.getUint32(8, true)).toBe(1);
    expect(bytes.length).toBe(HEADER_SIZE + RECORD_SIZE);
  });

  it('drops a pair whose primary or secondary resolves to no record', () => {
    expect(encodeFlat([pair(undefined, { primaryGaia: '999' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_primary_unresolved: 1, pairs_dropped_secondary_unresolved: 0 });
    expect(encodeFlat([pair(undefined, { secondaryGaia: '999' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_secondary_unresolved: 1 });
  });

  it('drops a pair whose two ends resolve to one record, by gaia or by a shared HIP', () => {
    expect(encodeFlat([pair(undefined, { secondaryGaia: '1' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_degenerate_idx: 1, pairs_dropped_primary_unresolved: 0 });
    const sharedHip = { primaryGaia: null, primaryHip: 36850, secondaryGaia: null, secondaryHip: 36850 };
    expect(encodeFlat([pair(undefined, sharedHip)], map({ byGaia: {}, byHip: { 36850: 100 } })).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_degenerate_idx: 1 });
  });

  it('a secondary sharing the primary’s id retries its synth record before reading as degenerate', () => {
    const synth = { bySynth: { 'synth-00000+0000-B': 555 } };
    expect(encodeFlat([pair(undefined, { secondaryGaia: '1' })], map(synth)).counts)
      .toMatchObject({ pairs_emitted: 1, pairs_dropped_degenerate_idx: 0 });
    const sharedHip = { primaryGaia: null, primaryHip: 36850, secondaryGaia: null, secondaryHip: 36850 };
    expect(encodeFlat([pair(undefined, sharedHip)], map({ byGaia: {}, byHip: { 36850: 100 }, ...synth })).counts)
      .toMatchObject({ pairs_emitted: 1, pairs_dropped_degenerate_idx: 0 });
  });

  it('re-homes a pair-mate-inherited secondary onto its own synth record (04049-3527 BC)', () => {
    // C carries A's source (an AC pair-mate), not the pair primary B's.
    const { bytes } = encodeFlat(
      [pair('00000+0000-BC', { primaryGaia: '2', secondaryGaia: '1' })],
      map({ bySynth: { 'synth-00000+0000-C': 340 } }),
    );
    expect(record(bytes, 0)).toMatchObject({ primary: 200, secondary: 340 });
  });

  it('re-homes a blended wide-pair primary onto its own synth record (Castor BC)', () => {
    const { bytes } = encodeFlat(
      [pair('00000+0000-BC')],
      map({ byGaia: { 1: 100, 2: 320 }, bySynth: { 'synth-00000+0000-B': 179 } }),
    );
    expect(record(bytes, 0)).toMatchObject({ primary: 179, secondary: 320 });
  });

  it('keeps a primary whose synth record is its own id-first resolve', () => {
    const { bytes } = encodeFlat(
      [pair('00000+0000-BC')],
      map({ byGaia: { 1: 179, 2: 320 }, bySynth: { 'synth-00000+0000-B': 179 } }),
    );
    expect(record(bytes, 0).primary).toBe(179);
  });

  it('counts a duplicate relation of disjoint letters as a collapse, of related ones as an alias', () => {
    const m = map({ byGaia: { 1: 100, 2: 320 } });
    expect(encodeFlat([pair('00000+0000-AC'), pair('00000+0000-BC')], m).counts).toMatchObject({
      pairs_emitted: 1, pairs_dropped_duplicate_relation: 1, pairs_dropped_same_relation_alias: 0,
    });
    // 18025+4414: AB and Aa,B name one link at two granularities.
    expect(encodeFlat([pair('00000+0000-AB'), pair('00000+0000-Aa,B')], m).counts).toMatchObject({
      pairs_emitted: 1, pairs_dropped_same_relation_alias: 1, pairs_dropped_duplicate_relation: 0,
    });
  });

  it('a duplicate relation keeps the orbit-bearing member over an earlier element-less one', () => {
    const { bytes, counts } = encodeFlat(
      [pair('00000+0000-AC'), pair('00000+0000-BC', ORBIT)],
      map({ byGaia: { 1: 100, 2: 320 } }),
    );
    expect(counts).toMatchObject({ pairs_emitted: 1, pairs_dropped_duplicate_relation: 1, pairs_with_orbit: 1 });
    expect(record(bytes, 0).flags & FLAG_HAS_ORBIT).toBe(FLAG_HAS_ORBIT);
  });

  it('remaps parent_relation from input to emitted position', () => {
    const pairs = [
      pair('A-AB', { primaryGaia: '1', secondaryGaia: '2' }),
      pair('A-CD', { primaryGaia: '3', secondaryGaia: '4' }),
      pair('A-EF', { primaryGaia: '4', secondaryGaia: '3' }),
    ];
    const { bytes } = encodeBinaries(pairs, [NO_PARENT, 0, 1], [0, 1, 2], map());
    expect([0, 1, 2].map((i) => record(bytes, i).parent)).toEqual([NO_PARENT, 0, 1]);
    expect(record(bytes, 1).flags & FLAG_IS_INNER_OF_HIERARCHY).toBe(FLAG_IS_INNER_OF_HIERARCHY);
  });

  it('a child whose parent was dropped is top-level, not inner', () => {
    const pairs = [pair(undefined, { secondaryGaia: '999' }), pair(undefined, { primaryGaia: '2', secondaryGaia: '3' })];
    const { bytes, counts } = encodeBinaries(pairs, [NO_PARENT, 0], [0, 1], map());
    expect(counts.pairs_emitted).toBe(1);
    expect(record(bytes, 0).parent).toBe(NO_PARENT);
    expect(record(bytes, 0).flags & FLAG_IS_INNER_OF_HIERARCHY).toBe(0);
  });

  it('sets has_orbit only with all six elements, and has_inclination only with it', () => {
    expect(record(encodeFlat([pair(undefined, ORBIT)]).bytes, 0).flags).toBe(FLAG_HAS_ORBIT);
    expect(record(encodeFlat([pair(undefined, { ...ORBIT, iRad: 1 })]).bytes, 0).flags)
      .toBe(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);
    for (const missing of ['pDays', 'tJd', 'e', 'aAU', 'omegaRad', 'q'] as const) {
      expect(record(encodeFlat([pair(undefined, { ...ORBIT, iRad: 1, [missing]: null })]).bytes, 0).flags, missing)
        .toBe(0);
    }
  });

  it('a WDS-truncated secondary resolves through its canonical synth key (Algol Aa1,2)', () => {
    const { counts } = encodeFlat(
      [pair('03082+4057-Aa1,2', {
        primaryComp: 'Aa1', secondaryComp: 'Aa2',
        primaryGaia: null, primaryHip: 14576, secondaryGaia: null,
      })],
      { byGaia: {}, byHip: { 14576: 100 }, bySynth: { 'synth-03082+4057-Aa2': 200 } },
    );
    expect(counts).toMatchObject({ pairs_emitted: 1, pairs_dropped_secondary_unresolved: 0 });
  });

  it('an identifier-less secondary resolves through its synthetic id (Algol Aa,Ab)', () => {
    const { bytes } = encodeFlat(
      [pair('03082+4057-Aa,Ab', { primaryGaia: null, primaryHip: 14576, secondaryGaia: null })],
      { byGaia: {}, byHip: { 14576: 100 }, bySynth: { 'synth-03082+4057-Ab': 200 } },
    );
    expect(record(bytes, 0)).toMatchObject({ primary: 100, secondary: 200 });
  });

  it('stores sep_pa_epoch_jd as its offset from J2000', () => {
    const { bytes } = encodeFlat([pair(undefined, { sepPaEpochJd: 2459945.75 })]);
    expect(record(bytes, 0).epoch).toBe(2459945.75 - J2000_JD);
  });
});

describe('sameRelationAlias', () => {
  const comps = (primaryComp: string, secondaryComp: string): MultiplesPair =>
    pair(undefined, { primaryComp, secondaryComp });

  it('equal tokens, a hierarchy ancestor, or compound containment alias', () => {
    expect(sameRelationAlias(comps('A', 'B'), comps('A', 'B'))).toBe(true);
    expect(sameRelationAlias(comps('A', 'B'), comps('Aa', 'B'))).toBe(true);
    // Tegmine 08122+1739: AC vs AB,C; 18443+3940: BC vs AB,CD.
    expect(sameRelationAlias(comps('A', 'C'), comps('AB', 'C'))).toBe(true);
    expect(sameRelationAlias(comps('B', 'C'), comps('AB', 'CD'))).toBe(true);
  });

  it('disjoint letters on either side are a real collapse', () => {
    // θ¹ Ori: Bb,Bc vs Ba,Bc.
    expect(sameRelationAlias(comps('Bb', 'Bc'), comps('Ba', 'Bc'))).toBe(false);
    expect(sameRelationAlias(comps('A', 'C'), comps('A', 'E'))).toBe(false);
  });
});
