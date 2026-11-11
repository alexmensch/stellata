import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LAUNCHER } from '../../../util/import-closure-pure';
import { REPO_ROOT } from '../../../util/paths';
import { identityRows } from '../identity-pure';
import { gzipText } from '../lineage-io';
import { lineageRows } from '../lineage-row-pure';
import { matchName, parseTraceQuery, queryTerms, traceRecords, traceText, type TraceLookups } from './trace-pure';
import {
  BRIGHTNESS_COLOUR_LINEAGE, CLOUDS_ALLOCATION_LINEAGE, SIZE_LINEAGE, stageFile,
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

const identity = [...identityRows(IDENTITY, 'fixture/identity.tsv')];
const stages = [{ stage: 'membership', rows: [...lineageRows(MEMBERSHIP, 'fixture/membership.tsv')] }];
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

  it('says so when nothing names the query', () => {
    expect(traceText(trace('hd:9'))).toBe('no lineage row names it\n');
  });
});

const MINTED = '6000000000000000001';

/** A system anchored on HD 5's record: its AB pair's rows, and a CD sub-pair
 *  whose primary is a record of its own (spine:9) under the same system
 *  anchor. Another system's row cites spine:99 only. */
const PROMOTION = [
  'stage\tkey\trole\tcode\tparams\tevidence',
  'promotion\tmultiples:S-AB/A\toutcome\tpromotion.not-applicable.pair-anchor\t{"via":"primary"}\tspine:3',
  'promotion\tmultiples:S-AB/B\toutcome\tpromotion.minted\t{"via":"secondary"}\tspine:3',
  'promotion\tmultiples:S-CD/C\toutcome\tpromotion.not-applicable.pair-anchor\t{"via":"primary"}\tspine:9|spine:3',
  'promotion\tmultiples:S-CD/D\toutcome\tpromotion.adopted.earlier-mint\t{"record":"spine:9","via":"secondary"}\tspine:9|spine:3',
  'promotion\tmultiples:T-AB/B\toutcome\tpromotion.minted\t{"via":"secondary"}\tspine:99',
].join('\n') + '\n';

const PROMOTION_IDENTITY = [
  'key\ttyc\thip\thd\tgl\tgaia_source_id\tdesignations',
  `multiples:S-AB/B\t\t\t\t\t${MINTED}\tsynth:S-B|gaia_dr3:${MINTED}`,
].join('\n') + '\n';

describe('traceRecords over a promoted system', () => {
  const withPromotion = [
    ...stages, { stage: 'promotion', rows: [...lineageRows(PROMOTION, 'fixture/promotion.tsv')] },
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

  it('finds a minted companion through the identity row promotion writes for it', () => {
    const [minted] = traceSystem(MINTED);
    expect(minted.key).toBe('multiples:S-AB/B');
    expect(minted.rows.map((r) => r.code)).toEqual(['promotion.minted']);
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
  const withAllocation = [...stages, { stage: 'allocation', rows: [...lineageRows(ALLOCATION, 'fixture/allocation.tsv')] }];
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
  writeFileSync(stageFile(dir, 'membership'), gzipText(MEMBERSHIP));
  writeFileSync(stageFile(dir, 'placement'), gzipText(PLACEMENT));
  writeFileSync(stageFile(dir, BRIGHTNESS_COLOUR_LINEAGE.stage), gzipText(BRIGHTNESS_COLOUR));
  writeFileSync(stageFile(dir, SIZE_LINEAGE.stage), gzipText(SIZE));
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

  it('reads the promotion stage and its identity file', () => {
    expect(run(MINTED).split('\n')[0]).toBe('multiples:S-AB/B');
  });

  it('finds a cloud by its slug and prints its allocation row', () => {
    const out = run('cloud:orion-a').split('\n');
    expect(out[0]).toBe('clouds:orion-a');
    expect(out).toContain('  outcome  allocation-clouds.resolved  ');
  });
});
