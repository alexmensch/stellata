import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../util/paths';
import { MULTIPLES_HEADER, multiplesLine } from './multiples-tsv-fixture';
import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import { MULTIPLES_TSV } from './multiples-tsv';
import { INHERITANCE_KINDS, ORBIT_VIA, ORBIT_VIA_ON_FILE, ORBIT_VIA_PROPERTIES, OWN, formatIdOrigin, inheritedFrom, parseIdOrigin } from './multiples-record-pure';

describeCommittedRoundTrip(MULTIPLES_TSV);

describe('ORBIT_VIA_PROPERTIES', () => {
  it('names every route but none as carrying elements, in route order', () => {
    expect(ORBIT_VIA_ON_FILE).toEqual(ORBIT_VIA.filter((v) => v !== 'none'));
  });

  const path = resolve(REPO_ROOT, MULTIPLES_TSV.file);
  it.skipIf(!lfsContentReadable(path))('gives every committed row its orbit_via\'s regime', () => {
    const rows = MULTIPLES_TSV.parse(readFileSync(path, 'utf8'));
    expect(rows.filter((r) => r.regime !== ORBIT_VIA_PROPERTIES[r.orbitVia].regime)).toEqual([]);
  });
});

describe('multiples.tsv codec', () => {

  it('keeps a negative zero the writer printed', () => {
    const text = `${MULTIPLES_HEADER}\n${multiplesLine({ x_pc: '-0.000000' })}\n`;
    expect(MULTIPLES_TSV.serialize(MULTIPLES_TSV.parse(text))).toBe(text);
  });

  it('rejects a value outside a closed column', () => {
    expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine({ photometry_via: 'athyg' })}\n`))
      .toThrow(/photometry_via: "athyg" is not one of/);
  });

  it('rejects a source_id that is not digits', () => {
    expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine({ gaia_source_id: '12a' })}\n`))
      .toThrow(/multiples\.tsv:2: gaia_source_id: "12a" is not a source_id/);
  });

  it('rejects a row no synthetic key composes from', () => {
    expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine({ system_id: '03082+4057-AB', comp: ' ' })}\n`))
      .toThrow(/comp is empty/);
    expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine({ system_id: 'NODASH', comp: 'A' })}\n`))
      .toThrow(/system_id "NODASH" names no WDS id/);
  });

  it('rejects orbital elements no bound orbit has', () => {
    for (const [over, message] of [
      [{ P_days: '0.000000' }, /P_days 0 is not positive/],
      [{ a_AU: '-1.000000' }, /a_AU -1 is not positive/],
      [{ e: '1.000000' }, /e 1 is not a bound orbit/],
      [{ e: '-0.100000' }, /e -0.1 is not a bound orbit/],
    ] as const) {
      expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine(over)}\n`)).toThrow(message);
    }
    expect(MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine({ P_days: '2.867000', a_AU: '0.060000', e: '0.000000' })}\n`)[0])
      .toMatchObject({ pDays: 2.867, aAU: 0.06, e: 0 });
  });

  it('round-trips each identifier\'s origin', () => {
    const text = `${MULTIPLES_HEADER}\n${multiplesLine({ gaia_source_id: '42', gaia_origin: 'letter:Aa', hip: '7', hip_origin: 'own' })}\n`;
    const [row] = MULTIPLES_TSV.parse(text);
    expect([row.gaiaOrigin, row.hipOrigin]).toEqual([inheritedFrom('Aa', 'letter'), OWN]);
    expect(MULTIPLES_TSV.serialize([row])).toBe(text);
  });

  it('rejects an origin without its identifier, an identifier without its origin, and an unknown kind', () => {
    for (const [over, message] of [
      [{ hip_origin: 'own' }, /hip_origin "own" names the origin of no identifier/],
      [{ gaia_source_id: '42', gaia_origin: '' }, /gaia_origin "" is not own or <kind>:<token>/],
      [{ hip: '7', hip_origin: 'cousin:A' }, /hip_origin "cousin:A" is not own/],
      [{ hip: '7', hip_origin: 'blend:' }, /hip_origin "blend:" is not own/],
      [{ hip: '7', hip_origin: 'blend:a:b' }, /hip_origin "blend:a:b" is not own/],
      [{ hip: '7', hip_origin: 'parent:foo bar' }, /hip_origin "parent:foo bar" is not own/],
      [{ hip: '7', hip_origin: 'letter:42' }, /hip_origin "letter:42" is not own/],
    ] as const) {
      expect(() => MULTIPLES_TSV.parse(`${MULTIPLES_HEADER}\n${multiplesLine(over)}\n`)).toThrow(message);
    }
  });
});

describe('IdOrigin cells', () => {
  it('formats and parses every kind', () => {
    for (const origin of [OWN, ...INHERITANCE_KINDS.map((how) => inheritedFrom('Aa1', how))]) {
      expect(parseIdOrigin(formatIdOrigin(origin))).toEqual(origin);
    }
  });
});
