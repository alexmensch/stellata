import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../util/paths';
import { identityRows } from './identity-pure';
import { gzipText, stageFile } from './lineage-io';
import { lineageRows } from './lineage-row-pure';
import { parseTraceQuery, queryTerms, traceRecords, traceText, type TraceLookups } from './trace-pure';

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

const identity = [...identityRows(IDENTITY, 'fixture/identity.tsv')];
const stages = [{ stage: 'membership', rows: [...lineageRows(MEMBERSHIP, 'fixture/membership.tsv')] }];
/** SID 7's canonical key is HD 5; "Fixture Star" is the record on HD 5. */
const LOOKUPS: TraceLookups = {
  canonicalKey: (sid) => (sid === 7 ? 'hd:5' : null),
  nameDesignations: (name) => (name === 'Fixture Star' ? ['hd:5', 'gaia_dr3:222'] : null),
};
const trace = (query: string) => {
  const { designations, terms } = queryTerms(parseTraceQuery(query), LOOKUPS);
  return traceRecords(designations, terms, identity, stages);
};

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

  it('says so when nothing names the query', () => {
    expect(traceText(trace('hd:9'))).toBe('no lineage row names it\n');
  });
});

describe('pnpm run trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lineage-trace-'));
  writeFileSync(stageFile(dir, 'identity'), gzipText(IDENTITY));
  writeFileSync(stageFile(dir, 'membership'), gzipText(MEMBERSHIP));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints every stage\'s rows for the record a Gaia id names', () => {
    const out = execFileSync('pnpm', ['exec', 'tsx', 'scripts/catalog/lineage/trace.ts', REFUSED_ONLY, '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf-8',
    });
    expect(out.split('\n')[0]).toBe('spine:3');
    expect(out).toMatch(/refused  membership\.binding\.gate-mag/);
  });
});
