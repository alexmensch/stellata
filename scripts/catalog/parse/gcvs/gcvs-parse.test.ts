import { describe, it, expect, vi } from 'vitest';

import {
  applyVariability,
  gcvsSummary,
  bridgeGcvsByGaia,
  classifyGcvsVarType,
  gcvsDesignationConIndex,
  isPlanetaryTransitOnly,
  normalizeGcvsName,
  parseGcvsMain,
  parseGcvsNumber,
  splitPipeDelimited,
  type VarStarData,
  type VarStarXref,
} from './gcvs-parse';
import {
  NO_CONSTELLATION_INDEX,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_DSCT,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_MIRA,
  VAR_TYPE_OTHER,
  VAR_TYPE_PULSATING,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_UNKNOWN,
} from '../../../../src/catalog-format/record/catalog-pure';
import { CONSTELLATIONS } from '../constellations/constellations';
import { makeStar } from '../star-fixture';
import { NO_DESIGNATION_CON } from '../../classic-ids/designation-constellation-pure';

const conIndexOf = (code: string): number =>
  CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === code);

const GCVS: Map<string, VarStarData> = new Map([
  ['R And', { periodDays: 409.2, amplitudeMag: 9.4, varType: 1 }],
  ['S Aql', { periodDays: 146.5, amplitudeMag: 3.6, varType: 1 }],
  ['T Vul', { periodDays: 4.4, amplitudeMag: 0.5, varType: 1 }],
]);

function gcvsMain(lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('gcvs-parse / parseGcvsMain amplitude notation', () => {
  it('reads a parenthesised min-mag cell as the full amplitude', () => {
    // β Cen shape: "( 0.045 )" means amplitude 0.045, min unknown —
    // NOT a minimum magnitude of 0.045.
    const text = gcvsMain([
      '199002 |bet   Cen *|140349.40 -602222.9 |BCEP      |  0.61   |(  0.045   )|            |V |            |     |     0.300          |     |B1III',
    ]);
    const out = parseGcvsMain(text);
    expect(out.get('bet Cen')).toEqual({
      periodDays: 0.3,
      amplitudeMag: 0.045,
      varType: VAR_TYPE_DSCT, // BCEP → low-amplitude p-mode bucket
    });
  });

  it('keeps computing amp = min - max for normal min-mag rows', () => {
    const text = gcvsMain([
      '860001 |R     Vir *|123829.94 +065919.0 |M         |  6.1    |  12.1      |            |V |45872.      |     |   145.63           |50   |M3.5IIIe-M8.5e',
    ]);
    const out = parseGcvsMain(text);
    expect(out.get('R Vir')).toEqual({
      periodDays: 145.63,
      amplitudeMag: 6.0,
      varType: VAR_TYPE_MIRA, // M → Mira
    });
  });

  it('still drops a parenthesised row without a period', () => {
    const text = gcvsMain([
      '059001 |alf   Aql *|195047.00 +085206.0 |DSCTC     |  0.77   |(  0.004 * )|            |V |            |     |                    |     |',
    ]);
    expect(parseGcvsMain(text).size).toBe(0);
  });
});

describe('gcvs-parse / bridgeGcvsByGaia', () => {
  it('promotes every byHip xref onto gaia_source_id when the walk knows the HIP', () => {
    const xref: VarStarXref = {
      byHip: new Map([
        [1, 'R And'],
        [2, 'S Aql'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([
      [1, '11111111'],
      [2, '22222222'],
    ]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(2);
    expect(xref.byGaia.get('11111111')).toBe('R And');
    expect(xref.byGaia.get('22222222')).toBe('S Aql');
  });

  it('skips byHip xrefs whose HIP is not in the walk', () => {
    const xref: VarStarXref = {
      byHip: new Map([
        [1, 'R And'],
        [2, 'S Aql'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([[1, '11111111']]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(1);
    expect(xref.byGaia.get('11111111')).toBe('R And');
  });

  it('clears any pre-existing byGaia entries before rebuilding', () => {
    const xref: VarStarXref = {
      byHip: new Map([[1, 'R And']]),
      byHd: new Map(),
      byGaia: new Map([['stale', 'Z Whatever']]),
    };
    bridgeGcvsByGaia(xref, new Map([[1, '11111111']]));
    expect(xref.byGaia.has('stale')).toBe(false);
    expect(xref.byGaia.get('11111111')).toBe('R And');
  });

  it('keeps the lowest HIP and warns when two HIPs share a gaia_source_id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Insert the higher HIP first so a nondeterministic insertion-order
    // walk would keep the wrong name.
    const xref: VarStarXref = {
      byHip: new Map([
        [67890, 'S Aql'],
        [12345, 'R And'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([
      [67890, '99999999'],
      [12345, '99999999'],
    ]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(1);
    expect(xref.byGaia.get('99999999')).toBe('R And');
    expect(warn).toHaveBeenCalledWith(
      'GCVS bridge: gaia_source_id 99999999 reached from HIPs [12345, 67890] — keeping first.',
    );
    warn.mockRestore();
  });
});

describe('gcvs-parse / applyVariability priority', () => {
  it('resolves via gaia first when a star has gaia_source_id', () => {
    const star = makeStar({ gaiaSourceId: '11111111', hip: 99, hd: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[99, 'S Aql']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatched).toBe(1);
    expect(r.gcvsMatchedByGaia).toBe(1);
    expect(r.gcvsMatchedByHip).toBe(0);
    expect(r.gcvsMatchedByHd).toBe(0);
    // The gaia path won, so the star's period matches R And.
    expect(star.periodDays).toBe(409.2);
  });

  it('applies the gaia-named entry when all three xref maps name the star differently', () => {
    // True triple match: every map resolves, each to a DIFFERENT GCVS
    // designation. Pins that the gaia name's period/amplitude is what
    // lands — swapping the lookup order in applyVariability fails here.
    const star = makeStar({ gaiaSourceId: '11111111', hip: 99, hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[88, 'T Vul']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatchedByGaia).toBe(1);
    expect(r.gcvsMatchedByHip).toBe(0);
    expect(r.gcvsMatchedByHd).toBe(0);
    expect(star.gcvsName).toBe('R And');
    expect(star.periodDays).toBe(409.2);
    expect(star.amplitudeMag).toBe(9.4);
  });

  it('falls back to hip when gaia is absent', () => {
    const star = makeStar({ hip: 99, hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[88, 'R And']]),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatchedByGaia).toBe(0);
    expect(r.gcvsMatchedByHip).toBe(1);
    expect(r.gcvsMatchedByHd).toBe(0);
    expect(star.periodDays).toBe(146.5); // S Aql
  });

  it('falls back to hd when neither gaia nor hip matches', () => {
    const star = makeStar({ hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map(),
      byHd: new Map([[88, 'T Vul']]),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatchedByGaia).toBe(0);
    expect(r.gcvsMatchedByHip).toBe(0);
    expect(r.gcvsMatchedByHd).toBe(1);
    expect(star.periodDays).toBe(4.4);
  });

  it('falls through to hip when the gaia lookup misses', () => {
    // Star has a gaia_source_id, but it's not in the bridged byGaia. HIP
    // still resolves the variability — exercises the fallthrough.
    const star = makeStar({ gaiaSourceId: '00000000', hip: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'R And']]),
      byHd: new Map(),
      byGaia: new Map([['7777', 'S Aql']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatchedByGaia).toBe(0);
    expect(r.gcvsMatchedByHip).toBe(1);
    expect(star.periodDays).toBe(409.2);
  });

  it('skips stars whose resolved GCVS name lacks a period entry', () => {
    const star = makeStar({ hip: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'Unknown Variable']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.gcvsMatched).toBe(0);
    expect(star.periodDays).toBe(0);
    expect(star.amplitudeMag).toBe(0);
  });

  it('attaches the resolved GCVS designation for the search index', () => {
    const matched = makeStar({ hip: 99 });
    const unmatched = makeStar({ hip: 1 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'R And']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    applyVariability([matched, unmatched], GCVS, xref);
    expect(matched.gcvsName).toBe('R And');
    // No cross-match → the field stays null so nothing is emitted for it.
    expect(unmatched.gcvsName).toBeNull();
  });

  it('names aperiodic variables for search without giving them a period', () => {
    // "V0645 Cen" (Proxima) resolves a designation but has no GCVS period
    // entry — searchable by name, never rendered as a pulsator.
    const aperiodic = makeStar({ hip: 42 });
    const xref: VarStarXref = {
      byHip: new Map([[42, 'V0645 Cen']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const r = applyVariability([aperiodic], GCVS, xref);
    expect(aperiodic.gcvsName).toBe('V0645 Cen');
    expect(aperiodic.periodDays).toBe(0);
    expect(aperiodic.varType).toBe(0);
    expect(r.gcvsNamed).toBe(1);
    expect(r.gcvsMatched).toBe(0);
  });

  it('returns disjoint per-source counts that sum to total matched', () => {
    const stars = [
      makeStar({ gaiaSourceId: '11111111' }),  // gaia
      makeStar({ hip: 50 }),                    // hip
      makeStar({ hd: 60 }),                     // hd
      makeStar({}),                             // no IDs, no match
    ];
    const xref: VarStarXref = {
      byHip: new Map([[50, 'S Aql']]),
      byHd: new Map([[60, 'T Vul']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability(stars, GCVS, xref);
    expect(r.gcvsMatchedByGaia).toBe(1);
    expect(r.gcvsMatchedByHip).toBe(1);
    expect(r.gcvsMatchedByHd).toBe(1);
    expect(r.gcvsMatched).toBe(3);
  });
});

describe('gcvs-parse / the designation as its own constellation authority', () => {
  it('reads the constellation off the trailing abbreviation', () => {
    expect(gcvsDesignationConIndex('LT Vul')).toBe(conIndexOf('vul'));
    expect(gcvsDesignationConIndex('V0645 Cen')).toBe(conIndexOf('cen'));
    expect(gcvsDesignationConIndex('R CrB')).toBe(conIndexOf('crb'));
  });

  it('has no opinion on a designation that names no constellation', () => {
    // Thousands of the named variables are these: an NSV serial or an
    // LMC/SMC field number, where the trailing token is a number.
    expect(gcvsDesignationConIndex('NSV 04199')).toBe(NO_CONSTELLATION_INDEX);
    expect(gcvsDesignationConIndex('LMC V0471')).toBe(NO_CONSTELLATION_INDEX);
    expect(gcvsDesignationConIndex('')).toBe(NO_CONSTELLATION_INDEX);
  });

  it('names its own constellation where nothing upstream does (LT Vul, RY Cen)', () => {
    // LT Vul: filed under Sagitta once, sits in Vulpecula, named for Vulpecula.
    // RY Cen: cell and position both Lupus, designation Centaurus — a mover no
    // check reading a positional or editorial cell can see. Neither carries a
    // Bayer or Flamsteed designation, so IV/27A has no row and the variable
    // name is the only nomenclature there is.
    const ltVul = makeStar({ hip: 93603, desigCon: NO_DESIGNATION_CON });
    const ryCen = makeStar({ hip: 71, desigCon: NO_DESIGNATION_CON });
    applyVariability([ltVul, ryCen], new Map<string, VarStarData>(), {
      byHip: new Map([[93603, 'LT Vul'], [71, 'RY Cen']]),
      byHd: new Map(),
      byGaia: new Map(),
    });
    expect(ltVul.desigCon).toEqual({ via: 'gcvs', index: conIndexOf('vul') });
    expect(ryCen.desigCon).toEqual({ via: 'gcvs', index: conIndexOf('cen') });
  });

  it('yields to IV/27A where a Bayer/Flamsteed designation disagrees (TY Crv)', () => {
    // 8 records carry both a Bayer/Flamsteed designation and a variable name in
    // DIFFERENT constellations (HD 104337 is Crater's Flamsteed star and
    // Corvus's TY). One uint8 serves one of them: IV/27A wins because its
    // consumers compose the label out of this field, while a GCVS label reads
    // the constellation out of the designation string and loses only its
    // expanded alias.
    const tyCrv = makeStar({ hip: 58587, desigCon: { via: 'iv27a', index: conIndexOf('crt') } });
    applyVariability([tyCrv], new Map<string, VarStarData>(), {
      byHip: new Map([[58587, 'TY Crv']]), byHd: new Map(), byGaia: new Map(),
    });
    expect(tyCrv.desigCon).toEqual({ via: 'iv27a', index: conIndexOf('crt') });
  });

  it('fills an absent designation constellation rather than only correcting one', () => {
    // The shape every spine-driven record now arrives in: the walk sets no
    // designation constellation, so the GCVS name is the only source there is.
    const orphan = makeStar({ hip: 74, desigCon: NO_DESIGNATION_CON });
    applyVariability([orphan], new Map<string, VarStarData>(), {
      byHip: new Map([[74, 'DX Aqr']]), byHd: new Map(), byGaia: new Map(),
    });
    expect(orphan.desigCon).toEqual({ via: 'gcvs', index: conIndexOf('aqr') });
  });

  it('leaves an already-set index alone when the designation agrees or is silent', () => {
    // The dominant post-IV/27A shape: 698 records where the two agree.
    const agreeing = makeStar({ hip: 72, desigCon: { via: 'iv27a', index: conIndexOf('and') } });
    const silent = makeStar({ hip: 73, desigCon: { via: 'iv27a', index: conIndexOf('dor') } });
    applyVariability([agreeing, silent], new Map<string, VarStarData>(), {
      byHip: new Map([[72, 'R And'], [73, 'LMC V0471']]),
      byHd: new Map(),
      byGaia: new Map(),
    });
    expect(agreeing.desigCon).toEqual({ via: 'iv27a', index: conIndexOf('and') });
    expect(silent.desigCon).toEqual({ via: 'iv27a', index: conIndexOf('dor') });
  });
});

describe('gcvs-parse / splitPipeDelimited', () => {
  it('splits lines on | and trims each cell', () => {
    expect(splitPipeDelimited('R     And  |M   | 5.8 ')).toEqual([['R     And', 'M', '5.8']]);
  });

  it('skips blank and whitespace-only lines', () => {
    expect(splitPipeDelimited('a|b\n\n   \nc|d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('accepts CRLF line endings', () => {
    expect(splitPipeDelimited('a|b\r\nc|d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns empty for empty input', () => {
    expect(splitPipeDelimited('')).toEqual([]);
  });

  it('keeps empty interior cells', () => {
    expect(splitPipeDelimited('a| |b||')).toEqual([['a', '', 'b', '', '']]);
  });
});

describe('gcvs-parse / normalizeGcvsName', () => {
  it('collapses internal whitespace to a single space', () => {
    expect(normalizeGcvsName('R     And')).toBe('R And');
    expect(normalizeGcvsName('V0640    Cas')).toBe('V0640 Cas');
  });

  it('strips trailing asterisks', () => {
    expect(normalizeGcvsName('R And *')).toBe('R And');
    expect(normalizeGcvsName('R And **')).toBe('R And');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeGcvsName('  R And  ')).toBe('R And');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeGcvsName('   ')).toBe('');
  });
});

describe('gcvs-parse / parseGcvsNumber', () => {
  it('parses a plain number', () => {
    expect(parseGcvsNumber('5.5')).toBe(5.5);
    expect(parseGcvsNumber('100')).toBe(100);
  });

  it('strips uncertainty markers and brackets', () => {
    expect(parseGcvsNumber('<5.5')).toBe(5.5);
    expect(parseGcvsNumber('5.5:')).toBe(5.5);
    expect(parseGcvsNumber('(5.5)')).toBe(5.5);
    expect(parseGcvsNumber('5.5*')).toBe(5.5);
    expect(parseGcvsNumber('>5.5')).toBe(5.5);
  });

  it('returns null for empty / whitespace input', () => {
    expect(parseGcvsNumber('')).toBeNull();
    expect(parseGcvsNumber('   ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseGcvsNumber('abc')).toBeNull();
    expect(parseGcvsNumber('---')).toBeNull();
  });

  it('returns null for input that strips down to nothing', () => {
    expect(parseGcvsNumber('()')).toBeNull();
    expect(parseGcvsNumber(':*')).toBeNull();
  });
});

describe('gcvs-parse / classifyGcvsVarType', () => {
  it('classifies eclipsing prefixes: EA / EB / EW / ELL / E', () => {
    expect(classifyGcvsVarType('EA')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EB')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EW')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('ELL')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('E')).toBe(VAR_TYPE_ECLIPSING);
  });

  it('classifies EP (eclipsing-by-planet) as OTHER, not eclipsing', () => {
    // A transiting-planet host is not a stellar multiple: it must earn
    // no wings and no cosmetic-pulsation suppression as a "binary".
    expect(classifyGcvsVarType('EP')).toBe(VAR_TYPE_OTHER);
  });

  it('flags bare EP hosts as planetary-transit-only; keeps a superimposed pulsator', () => {
    expect(isPlanetaryTransitOnly('EP')).toBe(true);
    expect(isPlanetaryTransitOnly('EP:')).toBe(true);
    // A real intrinsic pulsator superimposed keeps its ring/pulse.
    expect(isPlanetaryTransitOnly('EP+DSCT')).toBe(false);
    // Non-EP types are never dropped by this gate.
    expect(isPlanetaryTransitOnly('EA')).toBe(false);
    expect(isPlanetaryTransitOnly('M')).toBe(false);
  });

  it('classifies composite eclipsing-+-rotational/RS as eclipsing', () => {
    // Algol's "EA/RS" should keep the eclipsing tag — the geometric
    // occlusion is the dominant photometric signal, and superimposing
    // GCVS-amplitude pulsation would double-count the eclipse.
    expect(classifyGcvsVarType('EA/RS')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EA+RS')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EB/DM')).toBe(VAR_TYPE_ECLIPSING);
  });

  it('refines intrinsic pulsators into families: M / SR / DCEP / RRAB / RV / DSCT', () => {
    expect(classifyGcvsVarType('M')).toBe(VAR_TYPE_MIRA);
    expect(classifyGcvsVarType('SR')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('SRA')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('DCEP')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('CEP')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('RR')).toBe(VAR_TYPE_RR_LYRAE);
    expect(classifyGcvsVarType('RRAB')).toBe(VAR_TYPE_RR_LYRAE);
    // RV Tauri has no dedicated family bucket → generic pulsating fallback.
    expect(classifyGcvsVarType('RV')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('DSCT')).toBe(VAR_TYPE_DSCT);
  });

  it('maps pulsator subtypes with trailing letters to their family (DCEPS/Polaris, CWA, RVA, LB, DSCTC)', () => {
    // Subtype letters after the family prefix — the tail gate must accept
    // them, not fall through to OTHER.
    expect(classifyGcvsVarType('DCEPS')).toBe(VAR_TYPE_CEPHEID);   // Polaris
    expect(classifyGcvsVarType('DSCTC')).toBe(VAR_TYPE_DSCT);
    expect(classifyGcvsVarType('CWA')).toBe(VAR_TYPE_CEPHEID);     // Type II Cepheid
    expect(classifyGcvsVarType('CWB')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('RVA')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('RVB')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('LB')).toBe(VAR_TYPE_SEMIREGULAR);  // slow irregular red giant
    expect(classifyGcvsVarType('LC')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('ZZA')).toBe(VAR_TYPE_DSCT);        // ZZ Ceti (low-amp)
    expect(classifyGcvsVarType('BCEP')).toBe(VAR_TYPE_DSCT);       // β Cep (low-amp p-mode)
    // Uncertainty-flagged subtype (GCVS ':' after the subtype letter).
    expect(classifyGcvsVarType('SRA:')).toBe(VAR_TYPE_SEMIREGULAR);
    // Composite: rotating + pulsator → the pulsator component wins.
    expect(classifyGcvsVarType('ACV+DSCTC')).toBe(VAR_TYPE_DSCT);
  });

  it('classifies cataclysmic / eruptive / rotating as OTHER', () => {
    expect(classifyGcvsVarType('UGSU')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ZAND')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('GCAS')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ACV')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('BY')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('CST')).toBe(VAR_TYPE_OTHER);
    // Non-pulsators that share an initial with a pulsator family must not
    // be promoted by the letter-tail gate (RCB≠RR/RV, RS≠RR, SDOR≠SR).
    expect(classifyGcvsVarType('RCB')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('RS')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('SDOR')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ACVO')).toBe(VAR_TYPE_OTHER);
  });

  it('returns UNKNOWN for blank, null, or whitespace input', () => {
    expect(classifyGcvsVarType(null)).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType(undefined)).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType('')).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType('   ')).toBe(VAR_TYPE_UNKNOWN);
  });

  it('is case-insensitive', () => {
    expect(classifyGcvsVarType('ea')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('dcep')).toBe(VAR_TYPE_CEPHEID);
  });
});

describe('applyVariability count block', () => {
  it('states the table sizes it was handed', () => {
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql'], [98, 'T Vul']]),
      byHd: new Map([[88, 'T Vul']]),
      byGaia: new Map(),
    };
    const r = applyVariability([], GCVS, xref);
    expect([r.gcvsEntries, r.gcvsHipXrefs, r.gcvsHdXrefs, r.gcvsGaiaXrefs]).toEqual([GCVS.size, 2, 1, 0]);
    expect(gcvsSummary(r)).toBe(
      `${GCVS.size} GCVS entries, 2 Hip + 1 HD + 0 Gaia xrefs, 0 named for search (0 with a renderable period: gaia=0, hip=0, hd=0)`,
    );
  });
});
