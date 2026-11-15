import { describe, expect, it } from 'vitest';

import { unitVectorFromRaDec } from '../../../src/astro-core/equatorial-basis';
import {
  FLAG_BINARY_COMPANION_ONLY, MULTIPLICITY_UNRESOLVED, VAR_TYPE_ECLIPSING, type DistVia,
} from '../../../src/catalog-format/record/catalog-pure';
import {
  serializeSystemMembership, type SystemNode,
} from '../../../src/catalog-format/system-membership/system-membership-format';
import { OPTICAL_DOUBLE_MIN_SEP_PC } from '../multiplicity/binary-flags-pure';
import type { DoublesEvidence } from '../multiplicity/visual-doubles';
import { wdsIdPosition } from '../../wds/wds-pure';
import {
  buildSystemMembership, lentDistanceRecords, type MembershipRecord, type SystemMembershipInputs,
} from './system-membership-pure';
import type { WdsPairEnds } from './wds-trees-pure';

const CASTOR = '07346+3153';
const OTHER = '18000+1000';

function star(wdsId: string, distPc: number, over: Partial<MembershipRecord> = {}): MembershipRecord {
  const p = wdsIdPosition(wdsId)!;
  const u = unitVectorFromRaDec(p.raDeg, p.decDeg);
  return {
    x: u.x * distPc, y: u.y * distPc, z: u.z * distPc,
    absmag: 5, hip: null, gaiaSourceId: null, distVia: 'bailer_jones' as DistVia, varType: 0, flags: 0, ...over,
  };
}

const pair = (wdsId: string, primaryComp: string, secondaryComp: string, primary: number | null, secondary: number | null): WdsPairEnds =>
  ({ pair: { wdsId, primaryComp, secondaryComp }, rendered: { primary, secondary } });

const r = (record: number): SystemNode => ({ kind: 'record', record });
const g = (component: string | null, ...children: SystemNode[]): SystemNode => ({ kind: 'group', component, children });

function doubles(groups: number[][], physicalHips: number[] = []): DoublesEvidence {
  return {
    groups, ccdmGroupCount: groups.length,
    optical: { physicalHips: new Set(physicalHips), physicalGaia: new Set(), minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC },
  };
}

// 0–5 Castor (WDS); 6 a CCDM extra of Castor (HIP 106 shares HIP 100's group);
// 7 a geometric partner of 4; 8–9 a CCDM-only pair; 10 + 11 a CCDM pair 50 pc apart
// along the sightline, so each member is the other's optical double; 12–13 a geometric-only pair; 14–15 a geometric pair with
// a minted member; 16 eclipsing; 17 SIMBAD multiple; 18 alone in its CCDM group.
function fixture(): SystemMembershipInputs {
  const records: MembershipRecord[] = [
    star(CASTOR, 15, { hip: 100 }), star(CASTOR, 15), star(CASTOR, 15), star(CASTOR, 15), star(CASTOR, 15), star(CASTOR, 15),
    star(CASTOR, 15, { hip: 106 }), star(CASTOR, 15),
    star(OTHER, 40, { hip: 108 }), star(OTHER, 40, { hip: 109 }),
    star(OTHER, 60, { hip: 110 }), star(OTHER, 110, { hip: 111 }),
    star(OTHER, 80), star(OTHER, 80),
    star(OTHER, 90), star(OTHER, 90, { flags: FLAG_BINARY_COMPANION_ONLY }),
    star(OTHER, 20, { varType: VAR_TYPE_ECLIPSING }), star(OTHER, 21), star(OTHER, 22, { hip: 118 }),
  ];
  const multiplicityStatus = new Uint8Array(records.length);
  multiplicityStatus[17] = MULTIPLICITY_UNRESOLVED;
  return {
    records,
    multiplicityStatus,
    wdsPairs: [
      pair(CASTOR, 'A', 'B', 0, 1), pair(CASTOR, 'A', 'C', 0, 2),
      pair(CASTOR, 'Aa', 'Ab', 0, 3), pair(CASTOR, 'Ba', 'Bb', 1, 4), pair(CASTOR, 'Ca', 'Cb', 2, 5),
    ],
    doubles: doubles([[100, 106], [108, 109], [110, 111], [118]]),
    hipToIndex: new Map(records.flatMap((s, i) => (s.hip === null ? [] : [[s.hip, i] as const]))),
    geometricPairs: [[4, 7], [12, 13], [14, 15], [0, 3]],
    lentDistance: lentDistanceRecords(records, new Set()),
  };
}

describe('buildSystemMembership', () => {
  const { membership, counts } = buildSystemMembership(fixture());

  it('keeps the WDS tree, nests a geometric partner with its member, and hangs a CCDM-only record at the root', () => {
    expect(membership.systems[0]).toEqual({
      sources: ['wds', 'ccdm', 'geometric'],
      root: g(null, g('A', r(0), r(3)), g('B', r(1), g(null, r(4), r(7))), g('C', r(2), r(5)), r(6)),
    });
  });

  it('forms flat systems from a CCDM group and from a geometric pair alone', () => {
    expect(membership.systems.slice(1)).toEqual([
      { sources: ['ccdm'], root: g(null, r(8), r(9)) },
      { sources: ['geometric'], root: g(null, r(12), r(13)) },
    ]);
  });

  it('drops the optical CCDM member and the pair whose distance is lent, and counts both', () => {
    expect(counts).toMatchObject({ systemCcdmOpticalMembers: 2, systemGeometricLentPairs: 1 });
    const all = membership.systems.flatMap((s) => JSON.stringify(s.root));
    for (const gone of [10, 11, 14, 15]) expect(all.join()).not.toMatch(new RegExp(`"record":${gone}\\b`));
  });

  it('lists the no-record companions as evidenced', () => {
    expect([...membership.companions]).toEqual([[16, ['eclipsing-partner']], [17, ['simbad-multiple']], [18, ['ccdm-companion']]]);
  });

  it('pins every count', () => {
    expect(counts).toEqual({
      systemWdsIdentityGated: 0, systemWdsAmbiguous: 0, systemWdsTokenConflicts: 0,
      systems: 3, systemRecords: 12,
      systemsWithWds: 1, systemsWithCcdm: 2, systemsWithGeometric: 2,
      systemCcdmOpticalMembers: 2, systemGeometricLentPairs: 1,
      companionEclipsingPartner: 1, companionSimbadMultiple: 1, companionCcdm: 1,
    });
  });

  it('merges two WDS systems a CCDM group joins under one new root', () => {
    const records = [star(CASTOR, 15, { hip: 1 }), star(CASTOR, 15), star(OTHER, 15, { hip: 3 }), star(OTHER, 15)];
    const out = buildSystemMembership({
      records, multiplicityStatus: new Uint8Array(4),
      wdsPairs: [pair(CASTOR, 'A', 'B', 0, 1), pair(OTHER, 'A', 'B', 2, 3)],
      doubles: doubles([[1, 3]], [1, 3]), hipToIndex: new Map([[1, 0], [3, 2]]),
      geometricPairs: [], lentDistance: new Set(),
    });
    expect(out.membership.systems).toEqual([
      { sources: ['wds', 'ccdm'], root: g(null, g(null, r(0), r(1)), g(null, r(2), r(3))) },
    ]);
  });

  it('keeps a labelled WDS root intact when an outsider joins it', () => {
    const records = [star(CASTOR, 15), star(CASTOR, 15), star(CASTOR, 15)];
    const out = buildSystemMembership({
      records, multiplicityStatus: new Uint8Array(3),
      wdsPairs: [pair(CASTOR, 'Aa', 'Ab', 0, 1)],
      doubles: doubles([]), hipToIndex: new Map(), geometricPairs: [[1, 2]], lentDistance: new Set(),
    });
    expect(out.membership.systems[0].root).toEqual(g(null, r(0), g(null, r(1), r(2))));
  });
});

describe('buildSystemMembership — input order changes no system', () => {
  function shuffled<T>(xs: readonly T[], seed: number): T[] {
    const out = [...xs];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', (seed) => {
    const base = fixture();
    const permuted: SystemMembershipInputs = {
      ...base,
      wdsPairs: shuffled(base.wdsPairs, seed),
      doubles: { ...base.doubles, groups: shuffled(base.doubles.groups.map((grp) => shuffled(grp, seed + 1)), seed + 2) },
      geometricPairs: shuffled(base.geometricPairs.map(([a, b]) => (seed % 2 === 0 ? [b, a] as const : [a, b] as const)), seed + 3),
    };
    expect(serializeSystemMembership(buildSystemMembership(permuted).membership))
      .toBe(serializeSystemMembership(buildSystemMembership(base).membership));
  });
});

describe('lentDistanceRecords', () => {
  it('marks a minted companion, a lent sibling parallax and a member moved onto its anchor', () => {
    const own = { flags: 0, distVia: 'bailer_jones' as DistVia };
    const moved = { flags: 0, distVia: 'gaia_dr3_inversion' as DistVia };
    const records = [own, { flags: FLAG_BINARY_COMPANION_ONLY, distVia: 'bailer_jones' as DistVia }, { flags: 0, distVia: 'pair_member_parallax' as DistVia }, moved];
    expect([...lentDistanceRecords(records, new Set([moved]))]).toEqual([1, 2, 3]);
  });
});
