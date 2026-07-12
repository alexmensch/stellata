import { describe, expect, it } from 'vitest';

import {
  LEDGER_HEADER,
  REINSTATEMENTS_HEADER,
  RETIREMENTS_HEADER,
  SAMEAS_HEADER,
  allocate,
  canonicalKeyOf,
  checkAppendOnly,
  compareDesignations,
  computeLedgerHead,
  dropAmbiguousDesignations,
  isLfsPointer,
  isValidDesignation,
  namespaceRank,
  parseDesignation,
  effectiveRetirements,
  parseLedgerTsv,
  parseReinstatementsTsv,
  parseRetirementsTsv,
  parseSameasTsv,
  parseSolObjectsTsv,
  resolveSids,
  serializeLedgerRow,
  splitTsv,
  starDesignations,
  validateLedger,
  validateReinstatements,
  validateRetirements,
  type LedgerRow,
  type RetirementRow,
  type SidObject,
} from './sid-pure';

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
  it('orders namespaces sol > hip > hd > hr > gl > gaia_* > synth > cloud > lg', () => {
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

describe('TSV codecs', () => {
  const ledgerText = `${LEDGER_HEADER}\n1\thip:32349\tstar\t2026-07-10\n2\tcloud:orion-a\tcloud\t2026-07-10\n`;

  it('parses and re-serializes ledger rows', () => {
    const rows = parseLedgerTsv(ledgerText);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sid: 1,
      canonicalKey: 'hip:32349',
      kind: 'star',
      firstSeen: '2026-07-10',
    });
    expect(serializeLedgerRow(rows[0])).toBe('1\thip:32349\tstar\t2026-07-10');
  });

  it('parses retirements with and without successor', () => {
    const rows = parseRetirementsTsv(
      `${RETIREMENTS_HEADER}\n5\t2026-07-10\tmerged into 3\t3\n7\t2026-07-10\tdissolved\t\n`,
    );
    expect(rows[0].successorSid).toBe(3);
    expect(rows[1].successorSid).toBeNull();
  });

  it('parses same-as edges and validates both designations', () => {
    expect(parseSameasTsv(`${SAMEAS_HEADER}\nhip:1\tgaia_dr3:2\tnote\n`, 't')).toEqual([
      { a: 'hip:1', b: 'gaia_dr3:2' },
    ]);
    expect(() => parseSameasTsv(`${SAMEAS_HEADER}\nhip:1\tbad key\t\n`, 't')).toThrow();
  });

  it('parses sol-objects rows', () => {
    expect(parseSolObjectsTsv('key\tkind\nsun\tstar\npluto\tplanet\n')).toEqual([
      { key: 'sun', kind: 'star' },
      { key: 'pluto', kind: 'planet' },
    ]);
    expect(() => parseSolObjectsTsv('key\tkind\nsun\tcomet\n')).toThrow(/bad kind/);
  });

  it('splitTsv enforces LF, trailing newline, header, and no blank lines', () => {
    expect(() => splitTsv('a\n1\r\n', 'a', 't')).toThrow(/CR/);
    expect(() => splitTsv('a\n1', 'a', 't')).toThrow(/trailing newline/);
    expect(() => splitTsv('b\n1\n', 'a', 't')).toThrow(/bad header/);
    expect(() => splitTsv('a\n\n1\n', 'a', 't')).toThrow(/blank/);
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

  it('validates retirements against the ledger', () => {
    const ledger = [row(1, 'hip:1'), row(2, 'hd:2')];
    const ret = (sid: number, successorSid: number | null): RetirementRow => ({
      sid,
      retired: '2026-07-10',
      reason: 'merged',
      successorSid,
    });
    expect(validateRetirements([ret(1, 2)], ledger)).toEqual([]);
    expect(validateRetirements([ret(3, null)], ledger)[0]).toMatch(/not in ledger/);
    expect(validateRetirements([ret(1, null), ret(1, 2)], ledger)[0]).toMatch(/duplicate/);
    expect(validateRetirements([ret(1, 1)], ledger)[0]).toMatch(/successor is itself/);
    expect(validateRetirements([{ ...ret(1, null), reason: ' ' }], ledger)[0]).toMatch(
      /empty reason/,
    );
    // A second retirement is legal once a reinstatement cancelled the first.
    expect(
      validateRetirements([ret(1, null), ret(1, 2)], ledger, [
        { sid: 1, reinstated: '2026-07-11', reason: 'came back' },
      ]),
    ).toEqual([]);
  });

  it('validates reinstatements against the ledger and retirements', () => {
    const ledger = [row(1, 'hip:1'), row(2, 'hd:2')];
    const retirements: RetirementRow[] = [
      { sid: 1, retired: '2026-07-10', reason: 'parked', successorSid: null },
    ];
    const rein = (sid: number) => ({ sid, reinstated: '2026-07-12', reason: 'came back' });
    expect(validateReinstatements([rein(1)], ledger, retirements)).toEqual([]);
    expect(validateReinstatements([rein(3)], ledger, retirements)[0]).toMatch(/not in ledger/);
    expect(validateReinstatements([rein(2)], ledger, retirements)[0]).toMatch(
      /nothing to reinstate/,
    );
    expect(validateReinstatements([rein(1), rein(1)], ledger, retirements)[0]).toMatch(
      /nothing to reinstate/,
    );
    expect(
      validateReinstatements([{ ...rein(1), reason: '' }], ledger, retirements)[0],
    ).toMatch(/empty reason/);
  });
});

describe('head snapshot + append-only', () => {
  const ledgerText = `${LEDGER_HEADER}\n1\thip:1\tstar\t2026-07-10\n2\thd:2\tstar\t2026-07-10\n`;
  const emptyRetirements = `${RETIREMENTS_HEADER}\n`;

  it('computes the head triple for all three files', () => {
    const head = computeLedgerHead(ledgerText, emptyRetirements);
    expect(head.ledger.rows).toBe(2);
    expect(head.ledger.max_sid).toBe(2);
    expect(head.retirements).toEqual({
      rows: 0,
      max_sid: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    expect(head.reinstatements).toEqual(head.retirements);
    const withRein = computeLedgerHead(
      ledgerText, emptyRetirements,
      `${REINSTATEMENTS_HEADER}\n1\t2026-07-12\tcame back\n`,
    );
    expect(withRein.reinstatements!.rows).toBe(1);
    expect(withRein.reinstatements!.max_sid).toBe(1);
  });

  it('parses reinstatement rows', () => {
    const rows = parseReinstatementsTsv(
      `${REINSTATEMENTS_HEADER}\n5\t2026-07-12\tobject reappeared\n`,
    );
    expect(rows).toEqual([{ sid: 5, reinstated: '2026-07-12', reason: 'object reappeared' }]);
  });

  it('accepts pure appends with ascending sids', () => {
    const base = computeLedgerHead(ledgerText, emptyRetirements).ledger;
    const lines = ['1\thip:1\tstar\t2026-07-10', '2\thd:2\tstar\t2026-07-10', '3\tgl:Gl_1\tstar\t2026-07-11'];
    expect(checkAppendOnly(base, lines, 'ledger.tsv', { newSidsPastBaseMax: true })).toEqual([]);
  });

  it('rejects prefix edits, deletions, and sid counter rollback', () => {
    const base = computeLedgerHead(ledgerText, emptyRetirements).ledger;
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

  it('allows a new retirement of an old sid (no sid-monotonicity there)', () => {
    const retText = `${RETIREMENTS_HEADER}\n9\t2026-07-10\tmerged\t3\n`;
    const base = computeLedgerHead(ledgerText, retText).retirements;
    const lines = ['9\t2026-07-10\tmerged\t3', '2\t2026-07-11\tdissolved\t'];
    expect(checkAppendOnly(base, lines, 'retirements.tsv', { newSidsPastBaseMax: false })).toEqual(
      [],
    );
  });

  it('detects git-lfs pointer stubs', () => {
    expect(isLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:abc\n')).toBe(true);
    expect(isLfsPointer(`${LEDGER_HEADER}\n`)).toBe(false);
  });
});

describe('ambiguous-designation drop', () => {
  const star = (label: string, ...designations: string[]): SidObject => ({
    designations,
    kind: 'star',
    label,
  });

  it('drops a designation carried by two objects; both keep their own', () => {
    const { kept, ambiguous } = dropAmbiguousDesignations([
      star('a', 'hip:1', 'hd:100'),
      star('b', 'hip:2', 'hd:100'),
    ]);
    expect(ambiguous).toEqual([{ designation: 'hd:100', objects: [0, 1] }]);
    expect(kept).toEqual([['hip:1'], ['hip:2']]);
  });

  it('an object whose only designation is ambiguous becomes keyless', () => {
    const objects = [star('a', 'hip:1', 'hd:100'), star('b', 'hd:100')];
    const { kept } = dropAmbiguousDesignations(objects);
    expect(kept[1]).toEqual([]);
    const result = allocate({
      objects,
      storedEdges: [],
      ledger: [],
      retirements: [],
      today: '2026-07-10',
    });
    expect(result.keyless).toEqual([1]);
  });
});

describe('allocation', () => {
  const today = '2026-07-10';
  const objects: SidObject[] = [
    { designations: ['sol:sun', 'hd:1'], kind: 'star', label: 'record 0 (Sol)' },
    { designations: ['hip:32349', 'hd:48915', 'gaia_dr3:9'], kind: 'star', label: 'record 1' },
    { designations: ['gaia_dr3:594599568167552'], kind: 'star', label: 'record 2' },
    { designations: ['synth:04357+1010-Aa,Ab'], kind: 'star', label: 'record 3' },
    { designations: ['cloud:orion-a'], kind: 'cloud', label: 'cloud Orion A' },
    { designations: ['lg:lmc'], kind: 'galaxy', label: 'local-group LMC' },
    { designations: ['sol:pluto'], kind: 'planet', label: 'sol pluto' },
  ];

  it('mints in object order with ladder canonical keys and kinds', () => {
    const r = allocate({ objects, storedEdges: [], ledger: [], retirements: [], today });
    expect(r.errors).toEqual([]);
    expect(r.minted.map((m) => [m.sid, m.canonicalKey, m.kind])).toEqual([
      [1, 'sol:sun', 'star'],
      [2, 'hip:32349', 'star'],
      [3, 'gaia_dr3:594599568167552', 'star'],
      [4, 'synth:04357+1010-Aa,Ab', 'star'],
      [5, 'cloud:orion-a', 'cloud'],
      [6, 'lg:lmc', 'galaxy'],
      [7, 'sol:pluto', 'planet'],
    ]);
    expect(r.objectSids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.minted.every((m) => m.firstSeen === today)).toBe(true);
  });

  it('is idempotent: a second run resolves everything and mints nothing', () => {
    const first = allocate({ objects, storedEdges: [], ledger: [], retirements: [], today });
    const second = allocate({
      objects,
      storedEdges: [],
      ledger: first.minted,
      retirements: [],
      today: '2026-08-01',
    });
    expect(second.minted).toEqual([]);
    expect(second.resolvedExisting).toBe(7);
    expect(second.objectSids).toEqual(first.objectSids);
  });

  it('never re-keys: a later-acquired stronger designation joins the class', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'gaia_dr3:594599568167552', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [
        {
          designations: ['hip:7', 'gaia_dr3:594599568167552'],
          kind: 'star',
          label: 'record 0',
        },
      ],
      storedEdges: [],
      ledger,
      retirements: [],
      today,
    });
    expect(r.minted).toEqual([]);
    expect(r.objectSids).toEqual([1]);
  });

  it('a stored edge resolves a re-lettered synth key to its frozen sid', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'synth:04357+1010-Aa,Ab', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['synth:04357+1010-Aa1,2'], kind: 'star', label: 'record 0' }],
      storedEdges: [{ a: 'synth:04357+1010-Aa,Ab', b: 'synth:04357+1010-Aa1,2' }],
      ledger,
      retirements: [],
      today,
    });
    expect(r.minted).toEqual([]);
    expect(r.objectSids).toEqual([1]);
    expect(r.orphaned.size).toBe(0);
  });

  it('reports an orphaned synth ledger key when no bridge covers it', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'synth:04357+1010-Aa,Ab', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['synth:04357+1010-Aa1,2'], kind: 'star', label: 'record 0' }],
      storedEdges: [],
      ledger,
      retirements: [],
      today,
    });
    expect(r.orphaned.get('synth')).toEqual(['synth:04357+1010-Aa,Ab']);
    expect(r.minted).toHaveLength(1);
  });

  it('a retired synth key is not an orphan (dissolved component)', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'synth:04357+1010-Aa,Ab', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [],
      storedEdges: [],
      ledger,
      retirements: [{ sid: 1, retired: '2026-07-09', reason: 'dissolved', successorSid: null }],
      today,
    });
    expect(r.orphaned.size).toBe(0);
  });

  it('errors when a class spans two active sids (unresolved merge)', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-07-01' },
      { sid: 2, canonicalKey: 'hd:2', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['hip:1', 'hd:2'], kind: 'star', label: 'record 0' }],
      storedEdges: [],
      ledger,
      retirements: [],
      today,
    });
    expect(r.errors[0]).toMatch(/2 active sids/);
  });

  it('resolves to the survivor when the merge is recorded as a retirement', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-07-01' },
      { sid: 2, canonicalKey: 'hd:2', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['hip:1', 'hd:2'], kind: 'star', label: 'record 0' }],
      storedEdges: [],
      ledger,
      retirements: [{ sid: 2, retired: '2026-07-09', reason: 'merged into 1', successorSid: 1 }],
      today,
    });
    expect(r.errors).toEqual([]);
    expect(r.objectSids).toEqual([1]);
  });

  it('errors when a retired object reappears with no active sid', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['hip:1'], kind: 'star', label: 'record 0' }],
      storedEdges: [],
      ledger,
      retirements: [{ sid: 1, retired: '2026-07-09', reason: 'parked', successorSid: null }],
      today,
    });
    expect(r.errors[0]).toMatch(/retired object reappeared/);
  });

  it('a reinstated sid resolves the reappeared object to its original sid', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['hip:1'], kind: 'star', label: 'record 0' }],
      storedEdges: [],
      ledger,
      retirements: [{ sid: 1, retired: '2026-07-09', reason: 'parked', successorSid: null }],
      reinstatements: [{ sid: 1, reinstated: '2026-07-12', reason: 'object reappeared' }],
      today,
    });
    expect(r.errors).toEqual([]);
    expect(r.objectSids).toEqual([1]);
    expect(r.minted).toEqual([]);
  });

  it('a re-retired sid (retire, reinstate, retire) reads as retired', () => {
    const retirements = [
      { sid: 1, retired: '2026-07-09', reason: 'parked', successorSid: null },
      { sid: 1, retired: '2026-07-13', reason: 're-parked', successorSid: null },
    ];
    const reinstatements = [{ sid: 1, reinstated: '2026-07-12', reason: 'came back' }];
    expect(effectiveRetirements(retirements, reinstatements).get(1)?.reason).toBe('re-parked');
    expect(effectiveRetirements(retirements.slice(0, 1), reinstatements).size).toBe(0);
  });

  it('errors on a kind conflict with the frozen ledger row', () => {
    const ledger: LedgerRow[] = [
      { sid: 1, canonicalKey: 'cloud:orion-a', kind: 'cloud', firstSeen: '2026-07-01' },
    ];
    const r = allocate({
      objects: [{ designations: ['cloud:orion-a'], kind: 'galaxy', label: 'lg orion-a' }],
      storedEdges: [],
      ledger,
      retirements: [],
      today,
    });
    expect(r.errors[0]).toMatch(/kind "galaxy" conflicts/);
  });

  it('reports classes merged across objects by stored edges', () => {
    const r = allocate({
      objects: [
        { designations: ['hip:1'], kind: 'star', label: 'record 0' },
        { designations: ['gaia_dr3:5'], kind: 'star', label: 'record 1' },
      ],
      storedEdges: [{ a: 'hip:1', b: 'gaia_dr3:5' }],
      ledger: [],
      retirements: [],
      today,
    });
    expect(r.minted).toHaveLength(1);
    expect(r.minted[0].canonicalKey).toBe('hip:1');
    expect(r.mergedClasses).toEqual([{ sid: 1, objects: [0, 1] }]);
    expect(r.objectSids).toEqual([1, 1]);
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

  it('prepends sol:sun for the Sol record and strips the synth- prefix', () => {
    expect(
      starDesignations({
        isSol: true,
        hip: 0,
        hd: null,
        hr: null,
        gl: null,
        gaiaSourceId: null,
        syntheticId: 'synth-01234+5678-Ab',
      }),
    ).toEqual(['sol:sun', 'synth:01234+5678-Ab']);
  });

  it('throws when a synthetic id lacks the runtime prefix', () => {
    expect(() =>
      starDesignations({
        isSol: false, hip: null, hd: null, hr: null, gl: null,
        gaiaSourceId: null, syntheticId: '01234+5678-Ab',
      }),
    ).toThrow(/synth-/);
  });
});

describe('resolveSids', () => {
  const ledger: LedgerRow[] = [
    { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-01-01' },
    { sid: 2, canonicalKey: 'cloud:orion-a', kind: 'cloud', firstSeen: '2026-01-01' },
  ];

  it('resolves existing objects and never mints', () => {
    const r = resolveSids({
      objects: [
        { designations: ['hip:1', 'gaia_dr3:9'], kind: 'star', label: 'star' },
        { designations: ['cloud:orion-a'], kind: 'cloud', label: 'orion' },
      ],
      storedEdges: [],
      ledger,
      retirements: [],
    });
    expect(r.errors).toEqual([]);
    expect(r.objectSids).toEqual([1, 2]);
  });

  it('flags an unallocated object (one that would mint) as an error and leaves its sid at NO_SID', () => {
    const r = resolveSids({
      objects: [
        { designations: ['hip:1'], kind: 'star', label: 'existing' },
        { designations: ['hip:99'], kind: 'star', label: 'record 42' },
      ],
      storedEdges: [],
      ledger,
      retirements: [],
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/record 42: unallocated/);
    expect(r.objectSids).toEqual([1, 0]);
  });

  it('resolves via a stored slug-rename bridge to the frozen canonical key', () => {
    const r = resolveSids({
      objects: [{ designations: ['cloud:orion-molecular'], kind: 'cloud', label: 'renamed' }],
      storedEdges: [{ a: 'cloud:orion-a', b: 'cloud:orion-molecular' }],
      ledger,
      retirements: [],
    });
    expect(r.errors).toEqual([]);
    expect(r.objectSids).toEqual([2]);
  });
});
