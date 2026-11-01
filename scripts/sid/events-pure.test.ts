import { describe, expect, it } from 'vitest';

import { EVENT_COLUMNS, retiredSids, sidSuccessorPairs, validateEvents, type EventRow } from './events-pure';
import { EVENTS } from './events-tsv';

const ev = (sid: number, event: EventRow['event'], successor: number | null = null, date = '2026-07-10'): EventRow => (
  { sid, date, event, code: 'c', params: '', successor, buildVersion: '7.1.6' }
);
const isCode = (code: string): boolean => code === 'c';

describe('events codec', () => {
  it('round-trips a merge and a retire', () => {
    const rows = [ev(5, 'merge', 3), { ...ev(7, 'retire'), params: '{"reason":"x"}' }];
    const text = EVENTS.serialize(rows);
    expect(text.split('\n')[0]).toBe(EVENT_COLUMNS.join('\t'));
    expect(EVENTS.parse(text)).toEqual(rows);
  });

  it('refuses an unknown event and a padded successor', () => {
    const head = EVENT_COLUMNS.join('\t');
    expect(() => EVENTS.parse(`${head}\n5\t2026-07-10\tpark\tc\t\t\t7.1.6\n`)).toThrow(/event/);
    expect(() => EVENTS.parse(`${head}\n5\t2026-07-10\tmerge\tc\t\t03\t7.1.6\n`)).toThrow(/successor/);
  });
});

describe('validateEvents', () => {
  it('passes a retire → reinstate → merge cycle', () => {
    expect(validateEvents([ev(1, 'retire'), ev(1, 'reinstate'), ev(1, 'merge', 2)], 2, isCode)).toEqual([]);
  });

  it('refuses a sid or successor outside the ledger, and a self-merge', () => {
    expect(validateEvents([ev(3, 'retire')], 2, isCode)[0]).toMatch(/sid not in ledger/);
    expect(validateEvents([ev(1, 'merge', 3)], 2, isCode)[0]).toMatch(/successor 3 not in ledger/);
    expect(validateEvents([ev(1, 'merge', 1)], 2, isCode)[0]).toMatch(/successor is itself/);
  });

  it('a merge names its successor and nothing else does', () => {
    expect(validateEvents([ev(1, 'merge')], 2, isCode)[0]).toMatch(/names its successor/);
    expect(validateEvents([ev(1, 'retire', 2)], 2, isCode)[0]).toMatch(/only a merge/);
  });

  it('refuses an unlisted code, a bad date, a bad version and non-object params', () => {
    expect(validateEvents([{ ...ev(1, 'retire'), code: 'x' }], 2, isCode)[0]).toMatch(/not in the reason-code list/);
    expect(validateEvents([ev(1, 'retire', null, 'July')], 2, isCode)[0]).toMatch(/bad date/);
    expect(validateEvents([{ ...ev(1, 'retire'), buildVersion: 'v7' }], 2, isCode)[0]).toMatch(/bad build version/);
    expect(validateEvents([{ ...ev(1, 'retire'), params: '[1]' }], 2, isCode)[0]).toMatch(/params/);
  });

  it('refuses taking a sid out twice, reinstating one in service, and a second mint', () => {
    expect(validateEvents([ev(1, 'retire'), ev(1, 'merge', 2)], 2, isCode)[0]).toMatch(/already out/);
    expect(validateEvents([ev(1, 'reinstate')], 2, isCode)[0]).toMatch(/reinstated while in service/);
    expect(validateEvents([ev(1, 'mint'), ev(1, 'mint')], 2, isCode)[0]).toMatch(/minted twice/);
  });
});

describe('retired state', () => {
  it('a retire → reinstate → retire sid is out, carrying its last removal', () => {
    const rows = [ev(1, 'merge', 2), ev(1, 'reinstate'), ev(1, 'retire', null, '2026-07-13')];
    expect(retiredSids(rows).get(1)?.date).toBe('2026-07-13');
    expect(retiredSids(rows.slice(0, 2)).size).toBe(0);
  });

  it('successor pairs come from merges still in force, sorted by sid', () => {
    expect(sidSuccessorPairs([ev(5, 'merge', 2), ev(3, 'retire'), ev(1, 'merge', 4)])).toEqual([[1, 4], [5, 2]]);
    expect(sidSuccessorPairs([ev(1, 'merge', 2), ev(1, 'reinstate')])).toEqual([]);
    expect(sidSuccessorPairs([ev(1, 'mint')])).toEqual([]);
  });
});
