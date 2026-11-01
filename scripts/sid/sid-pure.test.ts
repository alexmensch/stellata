import { describe, expect, it } from 'vitest';

import {
  LEDGER_HEADER,
  SAMEAS_HEADER,
  canonicalKeyOf,
  checkAppendOnly,
  compareDesignations,
  computeLedgerHead,
  syntheticGaiaBridges,
  sameAsClasses,
  isValidDesignation,
  namespaceRank,
  parseDesignation,
  parseSameasTsv,
  parseSolObjectsTsv,
  starDesignations,
  validateLedger,
  type LedgerRow,
} from './sid-pure';
import { EVENT_COLUMNS } from './events-pure';
import { eventsFile } from './events-tsv';
import { LEDGER, ledgerFile } from './ledger-tsv';

describe('designation grammar', () => {
  it('accepts namespace:key with no whitespace', () => {
    expect(parseDesignation('hip:32349')).toEqual({ ns: 'hip', key: '32349' });
    expect(parseDesignation('synth:04357+1010-Aa,Ab')).toEqual({
      ns: 'synth',
      key: '04357+1010-Aa,Ab',
    });
    expect(parseDesignation('gaia_dr3:294:x')).toEqual({ ns: 'gaia_dr3', key: '294:x' });
  });

  it('rejects bad namespaces, empty and whitespace keys', () => {
    expect(isValidDesignation('HIP:1')).toBe(false);
    expect(isValidDesignation('hip')).toBe(false);
    expect(isValidDesignation(':1')).toBe(false);
    expect(isValidDesignation('hip:')).toBe(false);
    expect(isValidDesignation('gl:Gl 804')).toBe(false);
    expect(isValidDesignation('hip:1\t2')).toBe(false);
  });
});

describe('canonical-key ladder', () => {
  it('orders namespaces sol > hip > hd > hr > gl > gaia_* > synth > cloud > lg > shell', () => {
    const ladder = [
      'sol:sun',
      'hip:99999',
      'hd:1',
      'hr:1',
      'gl:Gl_1',
      'gaia_dr3:1',
      'synth:a',
      'cloud:orion-a',
      'lg:lmc',
      'shell:local_bubble',
    ];
    for (let i = 1; i < ladder.length; i++) {
      expect(compareDesignations(ladder[i - 1], ladder[i])).toBeLessThan(0);
    }
  });

  it('orders gaia releases ascending, including two-digit releases', () => {
    expect(compareDesignations('gaia_dr3:9', 'gaia_dr4:1')).toBeLessThan(0);
    expect(compareDesignations('gaia_dr4:9', 'gaia_dr10:1')).toBeLessThan(0);
  });

  it('compares all-digit keys numerically (bigint-safe), others lexicographically', () => {
    expect(compareDesignations('hip:2', 'hip:10')).toBeLessThan(0);
    expect(
      compareDesignations('gaia_dr3:4472832130942575872', 'gaia_dr3:594599568167552'),
    ).toBeGreaterThan(0);
    expect(compareDesignations('gl:Gl_10', 'gl:Gl_2')).toBeLessThan(0);
  });

  it('canonicalKeyOf picks the ladder minimum', () => {
    expect(canonicalKeyOf(['gaia_dr3:1', 'hd:5', 'hip:7'])).toBe('hip:7');
    expect(canonicalKeyOf(['synth:x', 'gl:Gl_1'])).toBe('gl:Gl_1');
  });

  it('rejects namespaces without a ladder position', () => {
    expect(() => namespaceRank('pgc')).toThrow(/ladder position/);
  });
});

const T = { file: 't.tsv', hint: 'h' };
const EVENTS_HEADER = EVENT_COLUMNS.join('\t');
describe('TSV codecs', () => {
  const ledgerText = `${LEDGER_HEADER}\n1\thip:32349\tstar\t2026-07-10\n2\tcloud:orion-a\tcloud\t2026-07-10\n`;

  it('parses and re-serializes ledger rows', () => {
    const rows = LEDGER.parse(ledgerText);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sid: 1,
      canonicalKey: 'hip:32349',
      kind: 'star',
      firstSeen: '2026-07-10',
    });
    expect(LEDGER.serialize(rows)).toBe(ledgerText);
  });

  it('refuses a signed sid, a short row and an unknown kind', () => {
    expect(() => LEDGER.parse(`${LEDGER_HEADER}\n+1\thip:1\tstar\t2026-07-10\n`)).toThrow(/sid: "\+1" is not an identifier/);
    expect(() => LEDGER.parse(`${LEDGER_HEADER}\n1\thip:1\tstar\n`)).toThrow(/expected 4/);
    expect(() => LEDGER.parse(`${LEDGER_HEADER}\n1\thip:1\tcomet\t2026-07-10\n`)).toThrow(/kind/);
  });

  it('parses same-as edges and validates both designations', () => {
    expect(parseSameasTsv(`${SAMEAS_HEADER}\nhip:1\tgaia_dr3:2\tnote\n`, T)).toEqual([
      { a: 'hip:1', b: 'gaia_dr3:2' },
    ]);
    expect(() => parseSameasTsv(`${SAMEAS_HEADER}\nhip:1\tbad key\t\n`, T)).toThrow();
  });

  it('parses sol-objects rows', () => {
    expect(parseSolObjectsTsv('key\tkind\nsun\tstar\npluto\tplanet\n', T)).toEqual([
      { key: 'sun', kind: 'star' },
      { key: 'pluto', kind: 'planet' },
    ]);
    expect(() => parseSolObjectsTsv('key\tkind\nsun\tcomet\n', T)).toThrow(/kind: "comet"/);
  });

  it('every registry file refuses CR line endings, a missing final newline, a blank line and a foreign header', () => {
    const line = '5\t2026-07-10\tretire\tc\t\t\t7.1.6';
    const ok = `${EVENTS_HEADER}\n${line}\n`;
    expect(eventsFile(ok).rows).toHaveLength(1);
    expect(() => eventsFile(ok.replace(/\n/g, '\r\n'))).toThrow(/CR line ending/);
    expect(() => eventsFile(ok.slice(0, -1))).toThrow(/missing final newline/);
    expect(() => eventsFile(`${EVENTS_HEADER}\n\n${line}\n`)).toThrow(/:2: blank line/);
    expect(() => LEDGER.parse(`${LEDGER_HEADER}\n1\thip:1\tstar\t2026-07-10`)).toThrow(/missing final newline/);
    expect(() => parseSolObjectsTsv('kind\tkey\n', T)).toThrow(/header mismatch/);
  });

  it('a registry file carries each data row as written', () => {
    expect(ledgerFile(`${LEDGER_HEADER}\n1\thip:1\tstar\t2026-07-10\n`).lines)
      .toEqual(['1\thip:1\tstar\t2026-07-10']);
  });
});

describe('structural validation', () => {
  const row = (sid: number, key: string): LedgerRow => ({
    sid,
    canonicalKey: key,
    kind: 'star',
    firstSeen: '2026-07-10',
  });

  it('passes a dense, unique, grammar-valid ledger', () => {
    expect(validateLedger([row(1, 'hip:1'), row(2, 'hd:2')])).toEqual([]);
  });

  it('catches sid reuse, gaps, and rollback', () => {
    expect(validateLedger([row(1, 'hip:1'), row(1, 'hd:2')])[0]).toMatch(/dense and ascending/);
    expect(validateLedger([row(1, 'hip:1'), row(3, 'hd:2')])[0]).toMatch(/dense and ascending/);
    expect(validateLedger([row(2, 'hip:1')])[0]).toMatch(/dense and ascending/);
  });

  it('catches duplicate keys, bad grammar, bad kind, bad date', () => {
    expect(validateLedger([row(1, 'hip:1'), row(2, 'hip:1')])[0]).toMatch(/duplicate/);
    expect(validateLedger([row(1, 'bad key:1')])[0]).toMatch(/grammar/);
    expect(validateLedger([{ ...row(1, 'hip:1'), kind: 'nebula' as never }])[0]).toMatch(
      /bad kind/,
    );
    expect(validateLedger([{ ...row(1, 'hip:1'), firstSeen: 'July 10' }])[0]).toMatch(
      /bad first_seen/,
    );
  });

});

describe('head snapshot + append-only', () => {
  const ledgerText = `${LEDGER_HEADER}\n1\thip:1\tstar\t2026-07-10\n2\thd:2\tstar\t2026-07-10\n`;
  const noEvents = eventsFile(`${EVENTS_HEADER}\n`);

  it('computes the head triple for both files', () => {
    const head = computeLedgerHead(ledgerFile(ledgerText), noEvents);
    expect(head.ledger.rows).toBe(2);
    expect(head.ledger.max_sid).toBe(2);
    expect(head.events).toEqual({
      rows: 0,
      max_sid: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    const withEvent = computeLedgerHead(
      ledgerFile(ledgerText), eventsFile(`${EVENTS_HEADER}\n1\t2026-07-12\tretire\tc\t\t\t7.1.6\n`),
    );
    expect(withEvent.events!.rows).toBe(1);
    expect(withEvent.events!.max_sid).toBe(1);
  });

  it('accepts pure appends with ascending sids', () => {
    const base = computeLedgerHead(ledgerFile(ledgerText), noEvents).ledger;
    const lines = ['1\thip:1\tstar\t2026-07-10', '2\thd:2\tstar\t2026-07-10', '3\tgl:Gl_1\tstar\t2026-07-11'];
    expect(checkAppendOnly(base, lines, 'ledger.tsv', { newSidsPastBaseMax: true })).toEqual([]);
  });

  it('rejects prefix edits, deletions, and sid counter rollback', () => {
    const base = computeLedgerHead(ledgerFile(ledgerText), noEvents).ledger;
    const edited = ['1\thip:1\tstar\t2026-07-10', '2\thd:999\tstar\t2026-07-10'];
    expect(checkAppendOnly(base, edited, 'ledger.tsv', { newSidsPastBaseMax: true })[0]).toMatch(
      /frozen prefix/,
    );
    expect(
      checkAppendOnly(base, edited.slice(0, 1), 'ledger.tsv', { newSidsPastBaseMax: true })[0],
    ).toMatch(/rows deleted/);
    const rollback = [...edited.slice(0, 1), '2\thd:2\tstar\t2026-07-10', '2\tgl:Gl_1\tstar\t2026-07-11'];
    expect(checkAppendOnly(base, rollback, 'ledger.tsv', { newSidsPastBaseMax: true })[0]).toMatch(
      /not > frozen max_sid/,
    );
  });

  it('allows a new event on an old sid (no sid-monotonicity there)', () => {
    const line = '9\t2026-07-10\tmerge\tc\t\t3\t7.1.6';
    const base = computeLedgerHead(ledgerFile(ledgerText), eventsFile(`${EVENTS_HEADER}\n${line}\n`)).events!;
    const lines = [line, '2\t2026-07-11\tretire\tc\t\t\t7.1.6'];
    expect(checkAppendOnly(base, lines, 'events.tsv', { newSidsPastBaseMax: false })).toEqual([]);
  });
});

describe('sameAsClasses', () => {
  it('drops a designation carried by two objects; both keep their own', () => {
    const { kept, ambiguous, classes } = sameAsClasses([['hip:1', 'hd:100'], ['hip:2', 'hd:100']], []);
    expect(ambiguous).toEqual([{ designation: 'hd:100', objects: [0, 1] }]);
    expect(kept).toEqual([['hip:1'], ['hip:2']]);
    expect(classes.find('hip:1')).not.toBe(classes.find('hip:2'));
  });

  it('a stored edge joins two objects into one class', () => {
    const { classes } = sameAsClasses([['hip:1'], ['gaia_dr3:9']], [{ a: 'hip:1', b: 'gaia_dr3:9' }]);
    expect(classes.find('hip:1')).toBe(classes.find('gaia_dr3:9'));
  });

  it('refuses a stored edge naming a designation two objects carry', () => {
    expect(() =>
      sameAsClasses([['hip:1', 'hd:100'], ['hip:2', 'hd:100']], [{ a: 'hd:100', b: 'gaia_dr3:9' }]),
    ).toThrow('hd:100 = gaia_dr3:9');
  });

  it('an object whose only designation is ambiguous keeps none', () => {
    const { kept, objectsByClass } = sameAsClasses([['hip:1', 'hd:100'], ['hd:100']], []);
    expect(kept[1]).toEqual([]);
    expect([...objectsByClass.values()]).toEqual([[0]]);
  });
});

describe('starDesignations', () => {
  it('emits the full class in ladder order, gl whitespace collapsed', () => {
    expect(
      starDesignations({
        isSol: false,
        hip: 32349,
        hd: 48915,
        hr: 2491,
        hdAlt: [],
        hrAlt: [],
        gl: 'Gl 244 A',
        gaiaSourceId: '2947050466531873024',
        syntheticId: null,
      }),
    ).toEqual([
      'hip:32349',
      'hd:48915',
      'hr:2491',
      'gl:Gl_244_A',
      'gaia_dr3:2947050466531873024',
    ]);
  });

  it('emits an alternative HD/HR straight after the field it extends', () => {
    expect(
      starDesignations({
        isSol: false,
        hip: null,
        hd: 281098,
        hr: null,
        hdAlt: [35908],
        hrAlt: [],
        gl: null,
        gaiaSourceId: null,
        syntheticId: null,
      }),
    ).toEqual(['hd:281098', 'hd:35908']);
  });

  it('prepends sol:sun for the Sol record and strips the synth- prefix', () => {
    expect(
      starDesignations({
        isSol: true,
        hip: 0,
        hd: null,
        hr: null,
        hdAlt: [],
        hrAlt: [],
        gl: null,
        gaiaSourceId: null,
        syntheticId: 'synth-01234+5678-Ab',
      }),
    ).toEqual(['sol:sun', 'synth:01234+5678-Ab']);
  });

  it('throws when a synthetic id lacks the runtime prefix', () => {
    expect(() =>
      starDesignations({
        isSol: false, hip: null, hd: null, hr: null, hdAlt: [], hrAlt: [], gl: null,
        gaiaSourceId: null, syntheticId: '01234+5678-Ab',
      }),
    ).toThrow(/synth-/);
  });
});

describe('syntheticGaiaBridges', () => {
  it('maps a synthetic key to its Gaia source in either edge direction', () => {
    const bridges = syntheticGaiaBridges([
      { a: 'synth:20450+1244-B', b: 'gaia_dr3:1755189379660877312' },
      { a: 'gaia_dr3:4109030160308317312', b: 'synth:17153-2636-B' },
    ]);
    expect(bridges.get('synth-20450+1244-B')).toBe('1755189379660877312');
    expect(bridges.get('synth-17153-2636-B')).toBe('4109030160308317312');
  });

  it('ignores edges that are not synth↔gaia', () => {
    const bridges = syntheticGaiaBridges([
      { a: 'gl:277A', b: 'gl:277B' },
      { a: 'hip:32349', b: 'gaia_dr3:2947050466531873024' },
    ]);
    expect(bridges.size).toBe(0);
  });
});
