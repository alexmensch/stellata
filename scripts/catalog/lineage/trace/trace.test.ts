import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LAUNCHER } from '../../../util/import-closure-pure';
import { REPO_ROOT } from '../../../util/paths';
import { identityRows } from '../identity/identity-pure';
import { gzipText } from '../lineage-io';
import { lineageRows } from '../lineage-row-pure';
import { matchName, parseTraceQuery, queryTerms, traceRecords, traceText, type TraceLookups } from './trace-pure';
import {
  ANCHORS_LINEAGE, ASTROMETRY_LINEAGE, BINDING_LINEAGE, BRIGHTNESS_COLOUR_LINEAGE, CLASSIC_IDS_LINEAGE, CLOUDS_ALLOCATION_LINEAGE, COHERENCE_LINEAGE,
  MASSES_LINEAGE, ORBITS_LINEAGE, RESOLVE_LINEAGE, SIZE_LINEAGE,
  stageFile,
} from '../../../../src/catalog-format/pipeline-outputs/lineage-files';

const REFUSED_ONLY = '4000000000000000009';
const PARKED = '5000000000000000001';

/** Three records: HD 5 bound to 222 after refusing a source on no identity
 *  row; a record folded onto it; a magnitude-term star the catalogue parks. */
const IDENTITY = [
  'key\ttyc\thip\thd\tgl\tgaia_source_id\tdesignations',
  `gaia-dr3:${PARKED}\t\t\t\t\t${PARKED}\tgaia_dr3:${PARKED}`,
  'spine:3\t1-2-1\t\t5\t\t222\thd:5|gaia_dr3:222',
  'spine:4\t1-2-2\t\t5\t\t\thd:5',
].join('\n') + '\n';

const MEMBERSHIP = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  `membership\tgaia-dr3:${PARKED}\toutcome\tmembership.admit.magnitude\t\t`,
  'membership\tspine:3\toutcome\tmembership.admit.spine\t\t',
  'membership\tspine:3\toutcome\tmembership.binding.bound\t{"derived_source_id":"222"}\t',
  `membership\tspine:3\trefused\tmembership.binding.gate-mag\t{"source_id":"${REFUSED_ONLY}","via":"tyc"}\t`,
  'membership\tspine:4\toutcome\tmembership.fold\t\tspine:3',
].join('\n') + '\n';

/** spine:3's placement: Gaia's fit passed over for Hipparcos-2's on its proper
 *  motion; the magnitude-term star parks, unlit. */
const PLACEMENT = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  `placement\tgaia-dr3:${PARKED}\toutcome\tplacement.parallax.gaia-dr3-inversion\t\t`,
  `placement\tgaia-dr3:${PARKED}\toutcome\tplacement.park.no-v-magnitude\t{"tyc":"","hip":"","hd":"","gl":"","gaia_source_id":"${PARKED}"}\t`,
  'placement\tspine:3\toutcome\tplacement.direction.hip2-pm-discrepant\t\ti311:37',
  'placement\tspine:3\toutcome\tplacement.parallax.gaia-dr3-inversion\t\tgaia-dr3-astrometry:222',
  'placement\tspine:3\toutcome\tplacement.rv.none\t\t',
  'placement\tspine:3\trefused\tplacement.direction.refused.pm-disagrees-with-hip2\t{"tier":"gaia_5p"}\tgaia-dr3-astrometry:222',
].join('\n') + '\n';

/** spine:3's brightness and colour: V printed by Hipparcos past a saturated
 *  Gaia row, a SIMBAD type after one row refused on another star's Gaia id,
 *  a printed colour, and the A_V it was de-extincted by. */
const BRIGHTNESS_COLOUR = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'brightness-colour\tspine:3\toutcome\tbrightness-colour.ci.printed-hip-bv\t\ti239:37',
  'brightness-colour\tspine:3\toutcome\tbrightness-colour.dust.edenhofer2024.absmag-and-ci\t{"av":"0.0412"}\t',
  'brightness-colour\tspine:3\toutcome\tbrightness-colour.spectral.simbad\t{"namespace":"hip"}\tsimbad-sptype:42',
  'brightness-colour\tspine:3\toutcome\tbrightness-colour.v.printed-hip\t\ti239:37',
  'brightness-colour\tspine:3\trefused\tbrightness-colour.spectral.refused.gaia-id-contradicts\t{"tier":"simbad","namespace":"source_id"}\tsimbad-sptype:43',
  'brightness-colour\tspine:3\trefused\tbrightness-colour.v.refused.uncalibrated\t{"tier":"gaia_riello"}\tgaia-dr3-astrometry:222',
].join('\n') + '\n';

const SIZE = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'size\tspine:3\toutcome\tsize.apsis-teff\t{"absmag":"1.2345","solution":"gspspec","class_index":"stated"}\tgaia-dr3-apsis:222|simbad-sptype:42',
  'size\tspine:3\trefused\tsize.refused.apsis-teff-out-of-window\t{"solution":"gspphot"}\tgaia-dr3-apsis:222',
].join('\n') + '\n';

const BACKGROUND = '5877748442128924544';
const REFUSED_FACTS = '"hip":"71681","v_mag":"1.33","v_via":"printed_hip","g_mag":"20.95"';

/** α Cen B's designations: HD 128621 and HR 5460 both reach the G = 20.95
 *  background source beside the saturated star, which the gate refuses. */
const CLASSIC_IDS = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'classic-ids\tiv25:9007-5849-1\toutcome\tclassic-ids.hd.gated\t{"hd":"hd:128621"}\t',
  `classic-ids\tiv25:9007-5849-1\trefused\tclassic-ids.gate-mag\t{"source_id":"${BACKGROUND}","via":"tyc",${REFUSED_FACTS}}\t`,
  'classic-ids\tv50:5460\toutcome\tclassic-ids.hr.gated\t{"hr":"hr:5460","hd":"hd:128621"}\t',
  `classic-ids\tv50:5460\trefused\tclassic-ids.gate-mag\t{"source_id":"${BACKGROUND}","via":"hd",${REFUSED_FACTS}}\t`,
].join('\n') + '\n';

const identity = [...identityRows(IDENTITY, 'fixture/identity.tsv')];
const stages = [
  { stage: 'classic-ids', rows: () => lineageRows(CLASSIC_IDS, 'fixture/classic-ids.tsv') },
  { stage: 'membership', rows: () => lineageRows(MEMBERSHIP, 'fixture/membership.tsv') },
];
/** SID 7's canonical key is HD 5; record 0, "Fixture Star", "Yunü" or "Yunu", is the
 *  record on HD 5; records 1 and 2 are case-only designation twins; records 3
 *  and 4 both display "54 Leo". */
const NAMES = new Map([
  ['Fixture Star', [0]], ['Yunü', [0]], ['Yunu', [0]], ['a Car', [1]], ['A Car', [2]], ['54 Leo', [3, 4]],
]);
const DESIGNATIONS = [['hd:5', 'gaia_dr3:222'], ['hd:9'], ['hd:10'], ['hd:11'], ['hd:12']];
const CANONICAL = new Map([[7, 'hd:5'], [9, 'gaia_dr3:333'], [11, `gaia_dr3:${PARKED}`]]);
const LOOKUPS: TraceLookups = {
  canonicalKey: (sid) => CANONICAL.get(sid) ?? null,
  successor: (sid) => (sid === 9 ? 7 : null),
  names: () => NAMES,
  designations: (i) => DESIGNATIONS[i],
};
const trace = (query: string) => traceRecords(queryTerms(parseTraceQuery(query), LOOKUPS), identity, [], stages);

describe('parseTraceQuery', () => {
  it('reads a Gaia id, a SID, a designation and a name apart', () => {
    expect(parseTraceQuery(PARKED)).toEqual({ kind: 'gaia', sourceId: PARKED });
    expect(parseTraceQuery(`gaia_dr3:${PARKED}`)).toEqual({ kind: 'gaia', sourceId: PARKED });
    expect(parseTraceQuery('12345')).toEqual({ kind: 'sid', sid: 12345 });
    expect(parseTraceQuery('sid:7')).toEqual({ kind: 'sid', sid: 7 });
    expect(parseTraceQuery('hd:5')).toEqual({ kind: 'designation', designation: 'hd:5' });
    expect(parseTraceQuery('Sirius')).toEqual({ kind: 'name', name: 'Sirius' });
  });
});

describe('matchName', () => {
  it('takes an exact hit over a fold, then folds case and accents', () => {
    expect(matchName(NAMES, 'a Car')).toEqual({ kind: 'found', i: 1 });
    expect(matchName(NAMES, 'A Car')).toEqual({ kind: 'found', i: 2 });
    expect(matchName(NAMES, 'FIXTURE STAR')).toEqual({ kind: 'found', i: 0 });
    expect(matchName(NAMES, 'yunu')).toEqual({ kind: 'found', i: 0 });
    expect(matchName(NAMES, 'YUNU')).toEqual({ kind: 'found', i: 0 });
    expect(matchName(NAMES, 'Nobody')).toEqual({ kind: 'missing' });
  });

  it('refuses a folded key reaching two records, naming both', () => {
    expect(matchName(NAMES, 'A CAR')).toEqual({ kind: 'ambiguous', candidates: [['a Car', 1], ['A Car', 2]] });
  });

  it('refuses one string reaching two records, exact or folded', () => {
    const both = { kind: 'ambiguous', candidates: [['54 Leo', 3], ['54 Leo', 4]] };
    expect(matchName(NAMES, '54 Leo')).toEqual(both);
    expect(matchName(NAMES, '54 leo')).toEqual(both);
  });
});

describe('traceRecords over the fixture lineage', () => {
  it('finds a record the catalogue parks, since every admitted record has lineage', () => {
    const [parked] = trace(PARKED);
    expect(parked.key).toBe(`gaia-dr3:${PARKED}`);
    expect(parked.rows.map((r) => r.code)).toEqual(['membership.admit.magnitude']);
  });

  it('finds the record that refused a source no identity row carries', () => {
    const records = trace(`gaia_dr3:${REFUSED_ONLY}`);
    expect(records.map((r) => r.key)).toEqual(['spine:3']);
    expect(records[0].rows.map((r) => r.code)).toContain('membership.binding.gate-mag');
  });

  it('finds every record a designation names, the folded one by its evidence too', () => {
    expect(trace('hd:5').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
    expect(trace('spine:3').map((r) => r.key)).toEqual(['spine:4']);
  });

  it('finds a SID through its canonical key and a name through its record\'s designations', () => {
    expect(trace('sid:7').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
    expect(trace('Fixture Star').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
    expect(() => trace('sid:8')).toThrow(/SID 8 is not in the ledger/);
    expect(() => trace('Nobody')).toThrow(/no catalogue record is named "Nobody"/);
  });

  it('finds a name ignoring case and accents, refusing a fold that reaches two records', () => {
    expect(trace('fixture star').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
    expect(trace('Yunu').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
    expect(() => trace('a car')).toThrow(/"a car" reaches more than one record: "a Car" \(record 1\), "A Car" \(record 2\)/);
  });

  it('finds every designation row a designation reaches, the binding the gate refused included', () => {
    const records = trace('hd:128621');
    expect(records.map((r) => r.key)).toEqual(['iv25:9007-5849-1', 'v50:5460']);
    expect(records.every((r) => r.identity === null)).toBe(true);
    expect(records[0].rows.map((r) => `${r.role} ${r.code}`)).toEqual([
      'outcome classic-ids.hd.gated', 'refused classic-ids.gate-mag',
    ]);
  });

  it('finds every designation that reached a refused source from its Gaia id', () => {
    expect(trace(BACKGROUND).map((r) => r.key)).toEqual(['iv25:9007-5849-1', 'v50:5460']);
  });

  it('says so when nothing names the query', () => {
    expect(traceText(trace('hd:9'))).toBe('no lineage row names it\n');
  });
});

const MINTED = '6000000000000000001';

/** A system anchored on HD 5's record, which anchor dimming re-sized: its AB
 *  pair's rows, the minted B's size, and a CD sub-pair whose primary is a
 *  record of its own (spine:9) under the same system anchor. Another system's
 *  row cites spine:99 only. */
const PROMOTION = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'promotion\tmultiples:S-AB/A\toutcome\tpromotion.not-applicable.pair-anchor\t{"via":"primary"}\tspine:3',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.brightness.dmag-imputed\t\t',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.colour.spectral-derived\t\t',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.dust.edenhofer2024.absmag-only\t{"av":"0.0123"}\t',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.minted.keyed\t{"via":"secondary"}\tspine:3',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.size.mint\t{"route":"class-teff","absmag":"4.5600","class_index":"stated"}\t',
  'promotion\tmultiples:S-CD/C\toutcome\tpromotion.not-applicable.pair-anchor\t{"via":"primary"}\tspine:9|spine:3',
  'promotion\tmultiples:S-CD/D\toutcome\tpromotion.adopted.earlier-mint\t{"record":"spine:9","via":"secondary"}\tspine:9|spine:3',
  'promotion\tmultiples:T-AB/B\toutcome\tpromotion.minted.synthetic\t{"via":"secondary"}\tspine:99',
  'promotion\tspine:3\toutcome\tpromotion.existing.anchor-dimmed\t{"absmag":"1.4000"}\tmultiples:S-AB/B',
  'promotion\tspine:3\toutcome\tpromotion.size.anchor-dimmed\t{"route":"class-teff","absmag":"1.4000","class_index":"stated"}\t',
].join('\n') + '\n';

/** The system's distance coherence: spine:9 snapped onto its anchor spine:3. */
const COHERENCE = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'coherence\tspine:3\toutcome\tcoherence.anchor.anchor-won\t{"root":"S","tier":"gaia-clean","anchor_pc":"50"}\tgaia-dr3-astrometry:222',
  'coherence\tspine:9\toutcome\tcoherence.brightness.held\t{"root":"S","absmag":"4.1000"}\t',
  'coherence\tspine:9\toutcome\tcoherence.size.rescaled\t{"root":"S","factor":"1.041400"}\t',
  'coherence\tspine:9\toutcome\tcoherence.snapped\t{"root":"S","anchor":"spine:3","anchor_tier":"gaia-clean","from_pc":"52","to_pc":"50"}\tgaia-dr3-astrometry:222',
].join('\n') + '\n';

const PROMOTION_IDENTITY = [
  'key\ttyc\thip\thd\tgl\tgaia_source_id\tdesignations',
  `multiples:S-AB/B\t\t\t\t\t${MINTED}\tsynth:S-B|gaia_dr3:${MINTED}`,
].join('\n') + '\n';

/** The system's components' bindings: A's and B's Gaia sources their own, D's
 *  copied from C across their ρ = 0 pair. */
const BINDING = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'component-binding\tmultiples:S-AB/A\toutcome\tcomponent-binding.gaia.own\t{"gaia":"222"}\t',
  'component-binding\tmultiples:S-AB/A\toutcome\tcomponent-binding.hip.unbound\t\t',
  `component-binding\tmultiples:S-AB/B\toutcome\tcomponent-binding.gaia.own\t{"gaia":"${MINTED}"}\t`,
  'component-binding\tmultiples:S-AB/B\toutcome\tcomponent-binding.hip.unbound\t\t',
  'component-binding\tmultiples:S-CD/C\toutcome\tcomponent-binding.gaia.own\t{"gaia":"999"}\t',
  'component-binding\tmultiples:S-CD/C\toutcome\tcomponent-binding.hip.unbound\t\t',
  'component-binding\tmultiples:S-CD/D\toutcome\tcomponent-binding.gaia.inherited.blend\t{"gaia":"999","from":"C"}\t',
  'component-binding\tmultiples:S-CD/D\toutcome\tcomponent-binding.hip.unbound\t\t',
].join('\n') + '\n';

const REBOUND_FROM = '4000000000000000044';

/** A rebound on the audit's letter verdict: its donor's tier, and the source it lost. */
const RESOLVE = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'resolve\tmultiples:S-AB/A\toutcome\tresolve.tier.simbad-xid\t{"gaia":"222"}\t',
  `resolve\tmultiples:S-AB/A\trefused\tresolve.audit.letter-sources.geometric.refused\t{"wds":"S","contested":"A:222/${REBOUND_FROM}","gaia":"${REBOUND_FROM}","reference":"B","reference_gaia":"4000000000000000045","winner":"222"}\t`,
].join('\n') + '\n';

/** Stage 3's route for the rebound component, citing the row it read. */
const ASTROMETRY = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'astrometry\tmultiples:S-AB/A\toutcome\tastrometry.route.gaia-5p\t{"gaia":"222"}\tgaia-dr3-astrometry:222',
].join('\n') + '\n';

/** Stage 4's source for the pair, and the NSS solution it outranked. */
const ORBITS = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'orbits\twds:S/STF   1/AB\toutcome\torbits.source.orb6\t{"primary":"A","primary_gaia":"222","secondary":"B"}\torb6:S/STF   1/AB',
  'orbits\twds:S/STF   1/AB\trefused\torbits.passed.gaia-nss.outranked\t{"primary":"A","primary_gaia":"222","secondary":"B"}\tgaia-dr3-nss:222',
].join('\n') + '\n';

const RANKED_OUT = '4000000000000000046';

/** Stage 6's anchor for the system, the primary it outranked, and its binding. */
const ANCHORS = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'anchors\tmultiples:S-AB/A\toutcome\tanchors.binding.bound\t\t',
  'anchors\tmultiples:S-AB/A\toutcome\tanchors.chosen.letter\t{"anchor":"A","gaia":"222"}\t',
  `anchors\tmultiples:S-AB/A\trefused\tanchors.ranked-out.letter\t{"candidate":"C","gaia":"${RANKED_OUT}"}\tmultiples:S-CD/C`,
].join('\n') + '\n';

/** Stage 6's mass read for the anchor. */
const MASSES = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'masses\tmultiples:S-AB/A\toutcome\tmasses.read.main-sequence\t{"gaia":"222","spect":"G2V","for":"q"}\t',
].join('\n') + '\n';

describe('traceRecords over a promoted system', () => {
  const withPromotion = [
    { stage: 'component-binding', rows: () => lineageRows(BINDING, 'fixture/component-binding.tsv') },
    { stage: 'resolve', rows: () => lineageRows(RESOLVE, 'fixture/resolve.tsv') },
    ...stages, { stage: 'promotion', rows: () => lineageRows(PROMOTION, 'fixture/promotion.tsv') },
  ];
  const promotionIdentity = [...identityRows(PROMOTION_IDENTITY, 'fixture/promotion.identity.tsv')];
  const traceSystem = (query: string) => traceRecords(
    queryTerms(parseTraceQuery(query), LOOKUPS), [...identity, ...promotionIdentity], [], withPromotion,
  );

  it('finds every component row that cites the anchor\'s record, its own pair or as system anchor', () => {
    expect(traceSystem('hd:5').map((r) => r.key)).toEqual([
      'multiples:S-AB/A', 'multiples:S-AB/B', 'multiples:S-CD/C', 'multiples:S-CD/D', 'spine:3', 'spine:4',
    ]);
  });

  it('says whether each component\'s identifiers were its own or copied, and from which token', () => {
    const d = traceSystem('hd:5').find((r) => r.key === 'multiples:S-CD/D');
    expect(d?.rows.filter((r) => r.stage === 'component-binding').map((r) => `${r.code} ${r.params}`)).toEqual([
      'component-binding.gaia.inherited.blend {"gaia":"999","from":"C"}', 'component-binding.hip.unbound ',
    ]);
  });

  it('shows a rebound component\'s donor tier and the source the audit refused it, after its binding rows', () => {
    const a = traceSystem(REBOUND_FROM);
    expect(a.map((r) => r.key)).toEqual(['multiples:S-AB/A']);
    expect(a[0].rows.map((r) => `${r.role} ${r.code}`)).toEqual([
      'outcome component-binding.gaia.own', 'outcome component-binding.hip.unbound',
      'outcome resolve.tier.simbad-xid', 'refused resolve.audit.letter-sources.geometric.refused',
      'outcome promotion.not-applicable.pair-anchor',
    ]);
  });

  it('finds every component holding a Gaia source, its own or copied, from the source alone', () => {
    expect(traceSystem('gaia_dr3:999').map((r) => r.key)).toEqual(['multiples:S-CD/C', 'multiples:S-CD/D']);
  });

  it('finds a pair the binaries pipeline rejected from a Gaia source one of its sides carries', () => {
    const pairs = [
      'stage\tkey\trole\tcode\tparams\tevidence',
      'pairs\twds:S/STF   1/CE\toutcome\tpairs.optical.sep-limit-rejected\t{"primary":"C","primary_gaia":"999","secondary":"E"}\t',
    ].join('\n') + '\n';
    const withPairs = [...withPromotion, { stage: 'pairs', rows: () => lineageRows(pairs, 'fixture/pairs.tsv') }];
    const traced = traceRecords(
      queryTerms(parseTraceQuery('gaia_dr3:999'), LOOKUPS), [...identity, ...promotionIdentity], [], withPairs,
    );
    expect(traced.find((r) => r.key === 'wds:S/STF   1/CE')?.rows.map((r) => r.code)).toEqual(['pairs.optical.sep-limit-rejected']);
  });

  it('finds a minted companion through the identity row promotion writes for it', () => {
    const [minted] = traceSystem(MINTED);
    expect(minted.key).toBe('multiples:S-AB/B');
    expect(minted.rows.map((r) => r.code)).toEqual([
      'component-binding.gaia.own', 'component-binding.hip.unbound',
      'promotion.brightness.dmag-imputed', 'promotion.colour.spectral-derived',
      'promotion.dust.edenhofer2024.absmag-only', 'promotion.minted.keyed', 'promotion.size.mint',
    ]);
  });
});

/** SID 9 (gaia_dr3:333) merged into 7 by spine:4's fold; SID 11 parks with the magnitude-term star. */
const ALLOCATION = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  `allocation\tgaia-dr3:${PARKED}\toutcome\tallocation.parked\t{"sid":"11","canonical_key":"gaia_dr3:${PARKED}","cause":"placement.park.no-v-magnitude"}\t`,
  'allocation\tspine:3\toutcome\tallocation.resolved\t\t',
  'allocation\tspine:4\toutcome\tallocation.merged\t{"sid":"9","canonical_key":"gaia_dr3:333","cause":"membership.fold","successor":"7"}\t',
].join('\n') + '\n';

describe('traceRecords through allocation', () => {
  const withAllocation = [...stages, { stage: 'allocation', rows: () => lineageRows(ALLOCATION, 'fixture/allocation.tsv') }];
  const traceSid = (query: string) => traceRecords(
    queryTerms(parseTraceQuery(query), LOOKUPS), identity, [{ key: 'spine:3', sid: 7 }], withAllocation,
  );

  it('follows a merged SID to the decision that merged it and on to its successor\'s record', () => {
    expect(traceSid('sid:9').map((r) => r.key)).toEqual(['spine:3', 'spine:4']);
  });

  it('finds a parked SID under the origin of the decision that parked it', () => {
    const [parked] = traceSid('sid:11');
    expect(parked.key).toBe(`gaia-dr3:${PARKED}`);
    expect(parked.rows.map((r) => r.code)).toContain('allocation.parked');
  });
});

const CLOUD_IDENTITY = [
  'key\ttyc\thip\thd\tgl\tgaia_source_id\tdesignations',
  'clouds:orion-a\t\t\t\t\t\tcloud:orion-a',
].join('\n') + '\n';

const CLOUD_ALLOCATION = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'allocation-clouds\tclouds:orion-a\toutcome\tallocation-clouds.resolved\t\t',
].join('\n') + '\n';

describe('pnpm run trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lineage-trace-'));
  writeFileSync(stageFile(dir, CLOUDS_ALLOCATION_LINEAGE.identity!), gzipText(CLOUD_IDENTITY));
  writeFileSync(stageFile(dir, CLOUDS_ALLOCATION_LINEAGE.stage), gzipText(CLOUD_ALLOCATION));
  writeFileSync(stageFile(dir, 'identity'), gzipText(IDENTITY));
  writeFileSync(stageFile(dir, BINDING_LINEAGE.stage), gzipText(BINDING));
  writeFileSync(stageFile(dir, RESOLVE_LINEAGE.stage), gzipText(RESOLVE));
  writeFileSync(stageFile(dir, ASTROMETRY_LINEAGE.stage), gzipText(ASTROMETRY));
  writeFileSync(stageFile(dir, ORBITS_LINEAGE.stage), gzipText(ORBITS));
  writeFileSync(stageFile(dir, ANCHORS_LINEAGE.stage), gzipText(ANCHORS));
  writeFileSync(stageFile(dir, MASSES_LINEAGE.stage), gzipText(MASSES));
  writeFileSync(stageFile(dir, CLASSIC_IDS_LINEAGE.stage), gzipText(CLASSIC_IDS));
  writeFileSync(stageFile(dir, 'membership'), gzipText(MEMBERSHIP));
  writeFileSync(stageFile(dir, 'placement'), gzipText(PLACEMENT));
  writeFileSync(stageFile(dir, BRIGHTNESS_COLOUR_LINEAGE.stage), gzipText(BRIGHTNESS_COLOUR));
  writeFileSync(stageFile(dir, SIZE_LINEAGE.stage), gzipText(SIZE));
  writeFileSync(stageFile(dir, COHERENCE_LINEAGE.stage), gzipText(COHERENCE));
  writeFileSync(stageFile(dir, 'promotion'), gzipText(PROMOTION));
  writeFileSync(stageFile(dir, 'promotion.identity'), gzipText(PROMOTION_IDENTITY));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (query: string): string => execFileSync(
    'pnpm', ['exec', 'tsx', LAUNCHER, 'scripts/catalog/lineage/trace/trace.ts', query, '--dir', dir],
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  );

  it('prints every stage\'s rows for the record a Gaia id names', () => {
    const out = run(REFUSED_ONLY);
    expect(out.split('\n')[0]).toBe('spine:3');
    expect(out).toMatch(/refused  membership\.binding\.gate-mag/);
  });

  it('prints a record\'s placement chain after its membership rows, refused tiers included', () => {
    const out = run('hd:5');
    expect(out).toMatch(/membership\.admit\.spine[\s\S]*placement\.direction\.hip2-pm-discrepant/);
    expect(out).toMatch(/refused  placement\.direction\.refused\.pm-disagrees-with-hip2/);
    expect(out).toMatch(/placement\.parallax\.gaia-dr3-inversion/);
  });

  it('prints a record\'s V, spectral and colour provenance after its placement, refused tiers included', () => {
    const out = run('hd:5');
    expect(out).toMatch(/placement\.rv\.none[\s\S]*brightness-colour\.v\.printed-hip/);
    expect(out).toMatch(/refused  brightness-colour\.v\.refused\.uncalibrated/);
    expect(out).toMatch(/refused  brightness-colour\.spectral\.refused\.gaia-id-contradicts/);
    expect(out).toMatch(/brightness-colour\.ci\.printed-hip-bv/);
    expect(out).toMatch(/brightness-colour\.dust\.edenhofer2024\.absmag-and-ci/);
  });

  it('prints how a record\'s radius was derived after its colour, the refused Apsis solution included', () => {
    const out = run('hd:5');
    expect(out).toMatch(/brightness-colour\.v\.printed-hip[\s\S]*size\.apsis-teff/);
    expect(out).toMatch(/size\.apsis-teff +\{"absmag":"1\.2345","solution":"gspspec","class_index":"stated"\}/);
    expect(out).toMatch(/refused  size\.refused\.apsis-teff-out-of-window/);
  });

  it('prints a designation\'s classic-id rows, the refused binding included', () => {
    const out = run('hd:128621');
    expect(out.split('\n')[0]).toBe('iv25:9007-5849-1');
    expect(out).toMatch(/outcome  classic-ids\.hd\.gated/);
    expect(out).toContain(`refused  classic-ids.gate-mag  {"source_id":"${BACKGROUND}","via":"tyc",`);
    expect(out).toMatch(/v50:5460\n  outcome  classic-ids\.hr\.gated/);
  });

  it('reads the promotion stage and its identity file', () => {
    expect(run(MINTED).split('\n')[0]).toBe('multiples:S-AB/B');
  });

  it('prints a component\'s binding provenance before its promotion rows', () => {
    expect(run(MINTED)).toMatch(/multiples:S-AB\/B\n.*\n {2}outcome  component-binding\.gaia\.own +\{"gaia":"6000000000000000001"\}[\s\S]*promotion\.minted\.keyed/);
  });

  it('prints a component\'s resolve tier and the candidate the audit refused, after its binding provenance', () => {
    expect(run(REBOUND_FROM)).toMatch(
      /multiples:S-AB\/A\n[\s\S]*component-binding\.gaia\.own[\s\S]*outcome  resolve\.tier\.simbad-xid[\s\S]*refused  resolve\.audit\.letter-sources\.geometric\.refused/,
    );
  });

  it('prints a component\'s astrometry route after its resolve rows, citing the row it read', () => {
    expect(run(REBOUND_FROM)).toMatch(
      /multiples:S-AB\/A\n[\s\S]*resolve\.audit\.letter-sources\.geometric\.refused[\s\S]*outcome  astrometry\.route\.gaia-5p +\{"gaia":"222"\} +evidence gaia-dr3-astrometry:222/,
    );
  });

  it('prints a pair\'s orbit source and the candidate it passed over, from a Gaia source one side carries', () => {
    expect(run('gaia_dr3:222')).toMatch(
      /wds:S\/STF   1\/AB\n {2}outcome  orbits\.source\.orb6 .* +evidence orb6:S\/STF   1\/AB\n {2}refused  orbits\.passed\.gaia-nss\.outranked .* +evidence gaia-dr3-nss:222/,
    );
  });

  it('prints a system\'s anchor and each candidate it outranked with the rank step, from the outranked primary\'s Gaia source', () => {
    expect(run(RANKED_OUT)).toMatch(
      /multiples:S-AB\/A\n[\s\S]*outcome  anchors\.chosen\.letter +\{"anchor":"A","gaia":"222"\}\n {2}refused  anchors\.ranked-out\.letter +\{"candidate":"C","gaia":"4000000000000000046"\} +evidence multiples:S-CD\/C/,
    );
  });

  it('prints a component\'s mass source after its anchor rows', () => {
    expect(run('gaia_dr3:222')).toMatch(/anchors\.ranked-out\.letter[\s\S]*outcome  masses\.read\.main-sequence +\{"gaia":"222","spect":"G2V","for":"q"\}/);
  });

  it('prints a minted companion\'s absmag-source, colour and A_V provenance', () => {
    const out = run(MINTED);
    expect(out).toMatch(/promotion\.brightness\.dmag-imputed/);
    expect(out).toMatch(/promotion\.colour\.spectral-derived/);
    expect(out).toMatch(/promotion\.dust\.edenhofer2024\.absmag-only +\{"av":"0\.0123"\}/);
  });

  it('names the pass that set each component\'s shipped radius and absmag, with its inputs', () => {
    const out = run('hd:5');
    expect(out).toMatch(/spine:3\n[\s\S]*size\.apsis-teff[\s\S]*promotion\.existing\.anchor-dimmed +\{"absmag":"1\.4000"\} +evidence multiples:S-AB\/B/);
    expect(out).toMatch(/promotion\.size\.anchor-dimmed +\{"route":"class-teff","absmag":"1\.4000","class_index":"stated"\}/);
    expect(out).toMatch(/spine:9\n[\s\S]*coherence\.brightness\.held +\{"root":"S","absmag":"4\.1000"\}/);
    expect(out).toMatch(/coherence\.size\.rescaled +\{"root":"S","factor":"1\.041400"\}/);
    expect(out).toMatch(/multiples:S-AB\/B\n[\s\S]*promotion\.size\.mint +\{"route":"class-teff","absmag":"4\.5600","class_index":"stated"\}/);
  });

  it('finds a cloud by its slug and prints its allocation row', () => {
    const out = run('cloud:orion-a').split('\n');
    expect(out[0]).toBe('clouds:orion-a');
    expect(out).toContain('  outcome  allocation-clouds.resolved  ');
  });
});
