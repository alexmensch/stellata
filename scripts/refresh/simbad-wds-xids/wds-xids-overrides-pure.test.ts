import { describe, expect, it } from 'vitest';

import { assertOverridesOnComponents, parseWdsXidsOverrides } from './wds-xids-overrides-pure';

const FROM = { file: 'overrides.tsv', hint: 'h' };
const HEADER = 'wds_id\tcomponent\tsimbad_oid\treason\n';
const SIRIUS_B = '06451-1643\tB\t930049\tSirius B\n';

describe('parseWdsXidsOverrides', () => {
  it('reads each row, skipping comments and blank lines around the header', () => {
    const text = `# top\n\n# another\n${HEADER}\n# between rows\n${SIRIUS_B}12345+6789\tC\t111\tfake\n`;
    expect(parseWdsXidsOverrides(text, FROM)).toEqual([
      { wdsId: '06451-1643', component: 'B', oid: 930049 },
      { wdsId: '12345+6789', component: 'C', oid: 111 },
    ]);
  });

  it('refuses a missing column, an oid that is not an integer, an empty reason and a second row for one component', () => {
    expect(() => parseWdsXidsOverrides('wds_id\tcomponent\toid\treason\n', FROM)).toThrow(/simbad_oid/);
    expect(() => parseWdsXidsOverrides(`${HEADER}06451-1643\tB\tnotanint\tbad\n`, FROM)).toThrow(/overrides\.tsv:2/);
    expect(() => parseWdsXidsOverrides(`${HEADER}06451-1643\tB\t930049\t\n`, FROM)).toThrow(/reason is empty/);
    expect(() => parseWdsXidsOverrides(`${HEADER}${SIRIUS_B}06451-1643\tB\t999\tagain\n`, FROM)).toThrow(/a second override for 06451-1643 B \(oid 930049, then 999\)/);
  });
});

describe('assertOverridesOnComponents', () => {
  const components = [{ wdsId: '06451-1643', component: 'A' }, { wdsId: '06451-1643', component: 'B' }];

  it('passes overrides on WDS components, and none', () => {
    expect(() => assertOverridesOnComponents([{ wdsId: '06451-1643', component: 'B', oid: 930049 }], components, 'o.tsv')).not.toThrow();
    expect(() => assertOverridesOnComponents([], components, 'o.tsv')).not.toThrow();
  });

  it('names every orphan, and only the orphans', () => {
    const overrides = [{ wdsId: '99999+9999', component: 'Z', oid: 42 }, { wdsId: '06451-1643', component: 'B', oid: 930049 }];
    expect(() => assertOverridesOnComponents(overrides, components, 'o.tsv')).toThrow(/o\.tsv names 1 components .*: 99999\+9999 Z$/);
  });
});
