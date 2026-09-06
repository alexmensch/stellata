import { DIST_VIA_VALUES } from './distance/parallax/parallax-cascade';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliseGjKey,
  simbadHipKey,
  SIMBAD_NAMESPACE_VALUES,
  emptySimbadNamespaceIndex,
  indexSimbadRow,
  walkSimbadNamespaces,
  type SimbadNamespace,
  type SimbadNamespaceIndex,
  type SimbadRecordKeys,
  GAIA_BINDING_G_MINUS_V_REJECT_MAG,
  normalizeGcvsName,
  parseGcvsNumber,
  splitPipeDelimited,
  classifyGcvsVarType,
  isPlanetaryTransitOnly,
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_PULSATING,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_OTHER,
  VAR_TYPE_MIRA,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_DSCT,
  inferBinaries,
  pickBrightest,
  markPrimary,
  markPrimaryIfUnflagged,
  applyDoublesFlag,
  hasGaiaQualityDistance,
  isOpticalDoublePrimary,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleStar,
  type OpticalDoubleContext,
  type SearchEntry,
  type SearchEntrySource,
  buildSearchEntry,
  NO_CONSTELLATION_INDEX,
  designationConIndex,
  buildHipToIndex,
  BINARY_MAX_SEP_PC,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  FLAG_BINARY_PRIMARY,
  FLAGS,
  RESERVED_FLAG_BITS,
  HEADER_LAYOUT,
  RECORD_LAYOUT,
  HEADER_FIELD_SIZES,
  RECORD_FIELD_SIZES,
  RECORD_RESERVED_TAIL_BYTES,
  MULTIPLICITY_SINGLE,
  MULTIPLICITY_RESOLVED,
  MULTIPLICITY_UNRESOLVED,
  HEADER_SIZE,
  RECORD_SIZE,
  MAGIC,
  BINARY_VERSION,
  NO_APSIS,
  NAME_TABLE_PADDING,
  NAME_LENGTH_PREFIX_BYTES,
  AMP_MAG_PER_UNIT,
  PERIOD_DAYS_PER_UNIT,
  RECORD_FIELD_KINDS,
  encodeAmpUnits,
  encodePeriodUnits,
  decodeRecordColumn,
  decodeRecordColumnBig,
  readCatalogHeader,
  readNameTable,
  readRecordField,
  readRecordFieldBig,
  writeCatalogHeader,
  writeStarRecord,
  type NumericRecordField,
  type WireStarRecord,
  planCatalogChunks,
  assembleCatalogChunks,
  type CatalogManifest,
  parseGaiaApsisTsv,
  type BinaryStar,
  type DoublesStar,
  parseBailerJonesTsv,
  apparentToAbsoluteMagnitude,
  applyBailerJonesOverride,
  isBailerJonesEligible,
  resolveGaiaSourceId,
  parseGaiaSourceIdStr,
  parseSimbadWdsXidsTsv,
  isSiblingLetterAttribution,
  applyLmcKinematicOverride,
  isInLmcCone,
  angularSeparationDeg,
  LMC_DISTANCE_PC,
  LMC_CENTRE_RA_HOURS,
  LMC_CENTRE_DEC_DEG,
  LMC_CONE_HALF_ANGLE_DEG,
  LMC_PM_RA_CENTRE,
  LMC_PM_DEC_CENTRE,
  LMC_PM_TOLERANCE,
} from './catalog-pure';
import { MAX_DIST_PC } from './parse/stars-parse';

describe('catalog-pure / normaliseGjKey', () => {
  // The spine spells the catalogue word both ways and SIMBAD stores its own
  // spacing; one folded key is what lets the two meet.
  it('folds both catalogue words and SIMBAD spacing onto one key', () => {
    expect(normaliseGjKey('Gl 165A')).toBe('165A');
    expect(normaliseGjKey('GJ 165A')).toBe('165A');
    expect(normaliseGjKey('165 A')).toBe('165A');
    expect(normaliseGjKey('gj 9728 a')).toBe('9728A');
  });

  it('keeps a bare designation and rejects an empty cell', () => {
    expect(normaliseGjKey('4246')).toBe('4246');
    expect(normaliseGjKey('  ')).toBeNull();
    expect(normaliseGjKey(null)).toBeNull();
    expect(normaliseGjKey('GJ ')).toBeNull();
  });
});

describe('catalog-pure / SIMBAD namespace ladder', () => {
  const ALL_KEYS: SimbadRecordKeys = {
    sourceId: '99', hip: 22, tyc: '1-2-1', gl: 'Gl 165A',
  };

  const indexOneRowPerNamespace = (): SimbadNamespaceIndex<string> => {
    const index = emptySimbadNamespaceIndex<string>();
    index.bySourceId.set('99', 'source_id');
    index.byHip.set(22, 'hip');
    index.byGj.set('165A', 'gj');
    index.byTyc.set('1-2-1', 'tyc');
    return index;
  };

  // The array is the only statement of walk order; withdrawing the winning
  // namespace's key one at a time must surface the rest in exactly its order.
  it('walks namespaces in SIMBAD_NAMESPACE_VALUES order', () => {
    const index = indexOneRowPerNamespace();
    const keys: SimbadRecordKeys = { ...ALL_KEYS };
    const withdraw: Record<SimbadNamespace, () => void> = {
      source_id: () => { keys.sourceId = null; },
      hip: () => { keys.hip = null; },
      gj: () => { keys.gl = null; },
      tyc: () => { keys.tyc = null; },
    };
    const seen: SimbadNamespace[] = [];
    for (let i = 0; i < SIMBAD_NAMESPACE_VALUES.length; i++) {
      const hit = walkSimbadNamespaces(index, keys, (row) => row);
      seen.push(hit!.namespace);
      withdraw[hit!.namespace]();
    }
    expect(seen).toEqual([...SIMBAD_NAMESPACE_VALUES]);
    expect(walkSimbadNamespaces(index, keys, (row) => row)).toBeNull();
  });

  // indexSimbadRow and walkSimbadNamespaces derive each key from one binding
  // table, so a row written under a namespace is reachable by it.
  it('reaches an indexed row under every namespace that keyed it', () => {
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'row', () => {
      throw new Error('unexpected duplicate');
    });
    for (const namespace of SIMBAD_NAMESPACE_VALUES) {
      const only: SimbadRecordKeys = {
        sourceId: namespace === 'source_id' ? ALL_KEYS.sourceId : null,
        hip: namespace === 'hip' ? ALL_KEYS.hip : null,
        tyc: namespace === 'tyc' ? ALL_KEYS.tyc : null,
        gl: namespace === 'gj' ? ALL_KEYS.gl : null,
      };
      expect(walkSimbadNamespaces(index, only, (row) => row)).toEqual({
        value: 'row', namespace,
      });
    }
  });

  it('hands every colliding namespace to the resolver', () => {
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'first', () => {
      throw new Error('unexpected duplicate');
    });
    const collisions: SimbadNamespace[] = [];
    indexSimbadRow(index, ALL_KEYS, 'second', (namespace, _key, incumbent) => {
      collisions.push(namespace);
      return incumbent;
    });
    expect(collisions).toEqual([...SIMBAD_NAMESPACE_VALUES]);
    expect(walkSimbadNamespaces(index, ALL_KEYS, (row) => row)?.value).toBe('first');
  });

  it('indexes the row the resolver picks, under every shared key', () => {
    // A pull that unions namespaces reaches one star under two objects, so
    // the consumer that knows which cell it came for decides.
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'first', () => {
      throw new Error('unexpected duplicate');
    });
    indexSimbadRow(index, ALL_KEYS, 'second', (_ns, _key, _incumbent, candidate) => candidate);
    expect(walkSimbadNamespaces(index, ALL_KEYS, (row) => row)?.value).toBe('second');
  });

  // A bogus HIP cell must be no key at all rather than a key nothing looks
  // up, which is what would make an indexed row unreachable but present.
  it('takes only a positive integer HIP as a key', () => {
    expect(simbadHipKey(22)).toBe(22);
    expect(simbadHipKey(0)).toBeNull();
    expect(simbadHipKey(-1)).toBeNull();
    expect(simbadHipKey(22.5)).toBeNull();
    expect(simbadHipKey(Number.NaN)).toBeNull();
    expect(simbadHipKey(null)).toBeNull();
  });

  it('indexes nowhere for a row carrying no namespace key', () => {
    const index = emptySimbadNamespaceIndex<string>();
    const none: SimbadRecordKeys = { sourceId: '', hip: 0, tyc: '', gl: '  ' };
    indexSimbadRow(index, none, 'row', () => {
      throw new Error('unexpected duplicate');
    });
    expect(index.bySourceId.size + index.byHip.size + index.byGj.size + index.byTyc.size)
      .toBe(0);
  });
});

describe('catalog-pure / splitPipeDelimited', () => {
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

describe('catalog-pure / normalizeGcvsName', () => {
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

describe('catalog-pure / parseGcvsNumber', () => {
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

describe('catalog-pure / classifyGcvsVarType', () => {
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

describe('catalog-pure / inferBinaries', () => {
  function makeStar(opts: Partial<BinaryStar> & { x: number; y: number; z: number; absmag: number }): BinaryStar {
    return { flags: 0, companionIdx: -1, ...opts };
  }

  it('flags a single close pair as a binary', () => {
    // Two stars at 0.001 pc apart — well under BINARY_MAX_SEP_PC (0.005 pc).
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(2); // both record the other as companion
    expect(stats.mutualPairs).toBe(1);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(0);
  });

  it('flags the brighter (lower absmag) star as the primary', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 6 }),       // dimmer
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 4 }),   // brighter
    ];
    inferBinaries(stars);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not pair stars that are further apart than BINARY_MAX_SEP_PC', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC * 2, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
    expect(stars[1].companionIdx).toBe(-1);
  });

  it('ignores stars exactly at the cutoff (strict less-than)', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC, y: 0, z: 0, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('picks the nearest neighbour when several are within range', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0008, y: 0, z: 0, absmag: 6 }),
      makeStar({ x: 0.003,  y: 0, z: 0, absmag: 5 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1); // nearest, not brightest
  });

  it('does not pair a star with itself', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('handles a triple system by pairing each member with its nearest', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),    // A — brightest
      makeStar({ x: 0.001,  y: 0, z: 0, absmag: 5 }),    // B
      makeStar({ x: 0.0009, y: 0, z: 0, absmag: 6 }),    // C
    ];
    const stats = inferBinaries(stars);
    // Distances: A-B=0.001, A-C=0.0009, B-C=0.0001.
    //   A's nearest is C (0.0009). C's nearest is B (0.0001). B's nearest is C.
    // Only B↔C is mutual; A→C is one-way (C points back to B).
    expect(stars[0].companionIdx).toBe(2);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stats.mutualPairs).toBe(1);
    // Primary = brighter of mutual pair B↔C → B (absmag=5 < C's 6).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    // A is not part of any mutual pair, so it is NOT flagged primary
    // even though it is the brightest of the three.
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not flag stars in non-mutual chains as primary', () => {
    // 1D chain A-B-C-D where the inner B-C gap is the tightest, so
    // A→B and D→C (the outer stars point inward) but neither A nor D
    // is the nearest of anyone — they're chain ends. Only B↔C is
    // mutual.
    //   A=0, B=0.0030, C=0.0040, D=0.0070
    //   distances: A-B=0.0030, B-C=0.0010, C-D=0.0030,
    //              A-C=0.0040, A-D=0.0070 (above cutoff), B-D=0.0040.
    //   A→B (closer than C), B→C (0.0010 beats A's 0.0030),
    //   C→B (0.0010 beats D's 0.0030), D→C (closer than B).
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 3 }),
      makeStar({ x: 0.0030, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0040, y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 0.0070, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stars[3].companionIdx).toBe(2);
    expect(stats.mutualPairs).toBe(1);
    // Primary = brighter of B↔C → B (absmag=4).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('flags one primary per mutual pair when there are several', () => {
    // Two well-separated mutual pairs.
    const stars: BinaryStar[] = [
      makeStar({ x: 0,         y: 0, z: 0, absmag: 4 }),  // pair 1
      makeStar({ x: 0.001,     y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 100,       y: 0, z: 0, absmag: 3 }),  // pair 2 (brightest in catalog)
      makeStar({ x: 100.001,   y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.mutualPairs).toBe(2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 1 brighter
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 2 brighter
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('returns zero counts for an empty input', () => {
    expect(inferBinaries([])).toEqual({ pairs: 0, mutualPairs: 0 });
  });

  it('uses 3D distance, not 2D', () => {
    // Two stars separated only along z; would be 0 in xy projection.
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0,     absmag: 4 }),
      makeStar({ x: 0, y: 0, z: 0.001, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
  });
});

describe("catalog-pure / markPrimary", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("flags the brightest (lowest absmag) of a group", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimary(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimary(stars, [])).toBe(-1);
    expect(stars[0].flags).toBe(0);
  });

  it("preserves pre-existing flag bits via OR", () => {
    const stars: Slim[] = [star(4, 0x01)];
    markPrimary(stars, [0]);
    expect(stars[0].flags & 0x01).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("is idempotent under re-application to the same group", () => {
    const stars: Slim[] = [star(4), star(6)];
    markPrimary(stars, [0, 1]);
    const before = stars.map(s => s.flags);
    markPrimary(stars, [0, 1]);
    expect(stars.map(s => s.flags)).toEqual(before);
  });

  it("breaks ties on the first-encountered index", () => {
    // Both equally bright — the helper picks whichever it sees first
    // (matching the prior `i <= j ? i : j` behaviour for mutual pairs).
    const stars: Slim[] = [star(4), star(4)];
    expect(markPrimary(stars, [0, 1])).toBe(0);
  });
});

describe("catalog-pure / markPrimaryIfUnflagged", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("delegates to markPrimary when no member is pre-flagged", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -2 (skip sentinel) when any member is already flagged", () => {
    // Geometric pass already picked stars[2] (e.g. mutual pair primary).
    // CCDM pass should not re-flag stars[0] even though it is brighter.
    const stars: Slim[] = [star(4), star(6), star(5, FLAG_BINARY_PRIMARY)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(-2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimaryIfUnflagged(stars, [])).toBe(-1);
  });

  it("is idempotent: a group whose primary it just flagged returns -2 next time", () => {
    const stars: Slim[] = [star(4), star(6)];
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(0);
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(-2);
  });

  it("does not flag any star when bailing on the pre-flagged check", () => {
    const stars: Slim[] = [star(4), star(6, FLAG_BINARY_PRIMARY)];
    markPrimaryIfUnflagged(stars, [0, 1]);
    // stars[0] was brighter but must remain unflagged because stars[1]
    // already carried the bit.
    expect(stars[0].flags).toBe(0);
  });
});

describe('catalog-pure / buildHipToIndex', () => {
  it('maps positive HIPs to their record index and skips null / non-positive', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: null },
      { hip: 0 },
      { hip: 200 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get(100)).toBe(0);
    expect(m.get(200)).toBe(3);
  });

  it('keeps the FIRST occurrence on duplicate HIPs (brightest under absmag-sorted input)', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: 100 },
      { hip: 100 },
    ]);
    expect(m.get(100)).toBe(0);
  });
});

describe('catalog-pure / applyDoublesFlag', () => {
  // Mini Star fixture with just the fields applyDoublesFlag reads/writes.
  function s(absmag: number, hip: number | null, flags = 0): DoublesStar {
    return { absmag, hip, flags };
  }

  it('flags the brightest in-catalog member of each group', () => {
    // Three stars; the group covers them all. Lowest absmag (=brightest)
    // should get FLAG_BINARY_PRIMARY; the others stay clean.
    const stars: DoublesStar[] = [s(4, 100), s(2, 200), s(6, 300)];
    const r = applyDoublesFlag(stars, [[100, 200, 300]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(1);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[0].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('silently drops groups whose HIPs are all missing from the catalog', () => {
    const stars: DoublesStar[] = [s(4, 100), s(5, 200)];
    const r = applyDoublesFlag(stars, [[999, 1000]], buildHipToIndex(stars));
    expect(r.systems).toBe(0);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('counts a system but does not re-flag when a member already has the bit', () => {
    // Geometric pass already flagged the dimmer star; CCDM pass would
    // pick the brighter one but must defer per markPrimaryIfUnflagged's
    // contract.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);                    // not re-flagged
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);  // pre-existing bit preserved
  });

  it('flags one primary per group across multiple groups', () => {
    const stars: DoublesStar[] = [
      s(2, 100), s(3, 101), // group A — 100 brightest
      s(5, 200), s(4, 201), // group B — 201 brightest
    ];
    const r = applyDoublesFlag(stars, [[100, 101], [200, 201]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY); // 100 won group A
    expect(stars[3].flags).toBe(FLAG_BINARY_PRIMARY); // 201 won group B
    expect(stars[1].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('handles override-style groups (curated visual doubles) the same as CCDM groups', () => {
    // The build-catalog wrapper unions CCDM-from-file groups and the
    // KNOWN_VISUAL_DOUBLES list before calling this; here we verify both
    // sources behave identically once unioned.
    const stars: DoublesStar[] = [s(3, 100), s(2, 101)];
    // Pretend the CCDM pass produced one group, the override another.
    const r = applyDoublesFlag(stars, [[100], [101]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    // Each single-member group flags its own brightest (and only)
    // component.
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
  });

  it('skips HIP=0 / null records when building the lookup', () => {
    const stars: DoublesStar[] = [s(2, null), s(4, 0), s(3, 100)];
    const r = applyDoublesFlag(stars, [[100]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(stars[2].flags).toBe(FLAG_BINARY_PRIMARY);
    // The 0/null-HIP rows must never be hit by HIP→index lookup.
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('is idempotent under re-application', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const idx = buildHipToIndex(stars);
    applyDoublesFlag(stars, [[100, 200]], idx);
    const flagsBefore = stars.map((x) => x.flags);
    applyDoublesFlag(stars, [[100, 200]], idx);
    // Second pass sees the existing primary bit and bails — no
    // additional bits set.
    expect(stars.map((x) => x.flags)).toEqual(flagsBefore);
  });

  it('reports suppressed=0 when no suppress predicate is supplied', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.suppressed).toBe(0);
  });

  it('vetoes the fresh flag when the suppress predicate fires', () => {
    // Group {100, 200}; 100 is brightest. A predicate that suppresses the
    // picked primary leaves both stars unflagged and counts one suppression.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = applyDoublesFlag(
      stars,
      [[100, 200]],
      buildHipToIndex(stars),
      (primaryIdx) => primaryIdx === 0,
    );
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('never runs the suppress predicate on an already-flagged group', () => {
    // 200 already winged by a prior pass; the group short-circuits to a
    // no-op before the predicate would see the picked primary.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    let called = false;
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars), () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(0);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
  });
});

describe('catalog-pure / pickBrightest', () => {
  const s = (absmag: number) => ({ absmag });
  it('returns the lowest-absmag index', () => {
    expect(pickBrightest([s(4), s(2), s(6)], [0, 1, 2])).toBe(1);
  });
  it('returns -1 for an empty index list', () => {
    expect(pickBrightest([s(4)], [])).toBe(-1);
  });
  it('does not mutate — markPrimary is the flag-setting wrapper', () => {
    const stars = [{ absmag: 2, flags: 0 }];
    pickBrightest(stars, [0]);
    expect(stars[0].flags).toBe(0);
  });
});

describe('catalog-pure / markPrimaryIfUnflagged suppress hook', () => {
  const s = (absmag: number, flags = 0) => ({ absmag, flags });
  it('returns -3 and sets no bit when suppress vetoes the pick', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], (i) => i === 0)).toBe(-3);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });
  it('flags normally when suppress returns false', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => false)).toBe(0);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
  });
  it('short-circuits (-2) before consulting suppress on an already-flagged member', () => {
    const stars = [s(2), s(5, FLAG_BINARY_PRIMARY)];
    let called = false;
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => { called = true; return true; })).toBe(-2);
    expect(called).toBe(false);
  });
});

describe('catalog-pure / hasGaiaQualityDistance', () => {
  it('accepts the two tiers that rest on a Gaia parallax', () => {
    expect(hasGaiaQualityDistance('gaia_dr3_inversion')).toBe(true);
    expect(hasGaiaQualityDistance('bailer_jones')).toBe(true);
  });
  it('rejects every tier resting on someone else\'s measurement', () => {
    for (const via of [
      'hip2_parallax', 'cns5_plx', 'gliese_plx', 'simbad_plx',
      'pair_member_parallax', 'lmc_kinematic', 'curated', 'none',
    ] as const) {
      expect(hasGaiaQualityDistance(via), via).toBe(false);
    }
  });
});

describe('catalog-pure / isOpticalDoublePrimary', () => {
  // Two components 3 pc apart on the x-axis, both Gaia-quality, no physical
  // evidence — the canonical optical double.
  function make(overrides: Partial<OpticalDoubleStar>[] = []): OpticalDoubleStar[] {
    const base: OpticalDoubleStar = {
      absmag: 0, x: 0, y: 0, z: 0, hip: null, gaiaSourceId: null,
      distVia: 'bailer_jones', varType: VAR_TYPE_UNKNOWN,
    };
    const stars: OpticalDoubleStar[] = [
      { ...base, hip: 100 },
      { ...base, hip: 200, x: 3 },
    ];
    overrides.forEach((o, i) => Object.assign(stars[i], o));
    return stars;
  }
  const ctx = (over: Partial<OpticalDoubleContext> = {}): OpticalDoubleContext => ({
    physicalHips: new Set(), physicalGaia: new Set(),
    minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC, ...over,
  });

  it('suppresses when the nearest Gaia-quality sibling is beyond the limit', () => {
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx())).toBe(true);
  });
  it('keeps when the nearest sibling is within the limit', () => {
    const stars = make([{}, { x: 0.5 }]); // 0.5 pc apart
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary is a component of a physical pair (by HIP)', () => {
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx({ physicalHips: new Set([100]) }))).toBe(false);
  });
  it('keeps when the primary is a physical-pair member by Gaia source_id', () => {
    const stars = make([{ gaiaSourceId: 'g1' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx({ physicalGaia: new Set(['g1']) }))).toBe(false);
  });
  it('keeps eclipsing primaries (extrinsic wings earned)', () => {
    const stars = make([{ varType: VAR_TYPE_ECLIPSING }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary lacks a Gaia-quality distance', () => {
    const stars = make([{ distVia: 'hip2_parallax' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when no sibling has a Gaia-quality distance to measure against', () => {
    const stars = make([{}, { x: 3, distVia: 'hip2_parallax' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('measures the NEAREST sibling — a near Gaia-quality partner keeps the wings even beside a far one', () => {
    const stars: OpticalDoubleStar[] = [
      { absmag: 0, x: 0, y: 0, z: 0, hip: 100, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 },
      { absmag: 1, x: 0.3, y: 0, z: 0, hip: 200, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // bound
      { absmag: 2, x: 900, y: 0, z: 0, hip: 300, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // background
    ];
    expect(isOpticalDoublePrimary(0, [0, 1, 2], stars, ctx())).toBe(false);
  });
});

// Pin the v5 byte layout. The writer (build-catalog.ts) and the readers
// (catalog-loader.ts, verify-catalog.ts) all index off these constants;
// drift between the two would silently produce a corrupt binary, so the
// constants themselves get the regression coverage.
describe('catalog-pure / binary-format constants', () => {
  it('header offsets are non-overlapping uint32 slots within HEADER_SIZE', () => {
    const fields = Object.entries(HEADER_LAYOUT) as [keyof typeof HEADER_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(HEADER_FIELD_SIZES[name]).toBeDefined();
      expect(off + HEADER_FIELD_SIZES[name]).toBeLessThanOrEqual(HEADER_SIZE);
    }
    // Pairwise non-overlap.
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + HEADER_FIELD_SIZES[na];
        const eb = ob + HEADER_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${HEADER_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${HEADER_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('record offsets are non-overlapping and fit within RECORD_SIZE', () => {
    const fields = Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(RECORD_FIELD_SIZES[name]).toBeDefined();
      expect(off + RECORD_FIELD_SIZES[name]).toBeLessThanOrEqual(RECORD_SIZE);
    }
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + RECORD_FIELD_SIZES[na];
        const eb = ob + RECORD_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${RECORD_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${RECORD_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('layout and size maps cover identical key sets', () => {
    expect(Object.keys(HEADER_FIELD_SIZES).sort()).toEqual(Object.keys(HEADER_LAYOUT).sort());
    expect(Object.keys(RECORD_FIELD_SIZES).sort()).toEqual(Object.keys(RECORD_LAYOUT).sort());
  });

  it('record fields tile the record contiguously (kind-derived sizes + reserved tail sum to RECORD_SIZE)', () => {
    const fields = (Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][])
      .sort((a, b) => a[1] - b[1]);
    let expected = 0;
    for (const [name, off] of fields) {
      expect(off, `${name} leaves a gap or overlaps`).toBe(expected);
      expected = off + RECORD_FIELD_SIZES[name];
    }
    expect(expected + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
  });

  it('magic + version identify the v9 format', () => {
    expect(MAGIC).toBe('HYG9');
    expect(BINARY_VERSION).toBe(9);
  });

  it('record fields cover the v9 byte plan (Apsis 7×float32 at 52..79, sid uint32 at 80, velocity 3×float32 at 84..95, multiplicity uint8 at 96)', () => {
    expect(RECORD_LAYOUT.gaiaSourceId).toBe(44);
    expect(RECORD_LAYOUT.gaiaSourceId + 8).toBe(52); // gaiaSourceId end
    expect(RECORD_SIZE).toBe(100);
    // varType uint8 sits between ampUnits (36) and period (38).
    expect(RECORD_LAYOUT.ampUnits + 1).toBe(RECORD_LAYOUT.varType);
    expect(RECORD_LAYOUT.varType).toBe(37);
    expect(RECORD_LAYOUT.varType + 1).toBe(RECORD_LAYOUT.period);
    expect(RECORD_LAYOUT.period).toBe(38);
    // hip (uint32 at 40) immediately precedes gaiaSourceId.
    expect(RECORD_LAYOUT.hip + 4).toBe(RECORD_LAYOUT.gaiaSourceId);
    // Apsis bank: gspphot (4 floats) then gspspec (3 floats), each 4 bytes,
    // starting immediately after gaiaSourceId at byte 52 and filling the
    // record to RECORD_SIZE.
    expect(RECORD_LAYOUT.teffGspphot).toBe(52);
    expect(RECORD_LAYOUT.loggGspphot).toBe(56);
    expect(RECORD_LAYOUT.mhGspphot).toBe(60);
    expect(RECORD_LAYOUT.azeroGspphot).toBe(64);
    expect(RECORD_LAYOUT.teffGspspec).toBe(68);
    expect(RECORD_LAYOUT.loggGspspec).toBe(72);
    expect(RECORD_LAYOUT.mhGspspec).toBe(76);
    // sid uint32 immediately after the Apsis bank, then the velocity bank.
    expect(RECORD_LAYOUT.mhGspspec + 4).toBe(RECORD_LAYOUT.sid);
    expect(RECORD_LAYOUT.sid).toBe(80);
    // v8 velocity bank: 3 float32 pc/yr appended after sid.
    expect(RECORD_LAYOUT.sid + 4).toBe(RECORD_LAYOUT.vx);
    expect(RECORD_LAYOUT.vx).toBe(84);
    expect(RECORD_LAYOUT.vy).toBe(88);
    expect(RECORD_LAYOUT.vz).toBe(92);
    // v9 multiplicity uint8 after the velocity bank; the reserved tail pads
    // the stride back to a multiple of 4.
    expect(RECORD_LAYOUT.vz + 4).toBe(RECORD_LAYOUT.multiplicityStatus);
    expect(RECORD_LAYOUT.multiplicityStatus).toBe(96);
    expect(RECORD_LAYOUT.multiplicityStatus + 1 + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
    expect(RECORD_SIZE % 4).toBe(0);
  });

  it('multiplicity enum values are distinct and fit the uint8 field', () => {
    const values = [MULTIPLICITY_SINGLE, MULTIPLICITY_RESOLVED, MULTIPLICITY_UNRESOLVED];
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xff);
    }
    expect(MULTIPLICITY_SINGLE).toBe(0); // zero-fill default = single
  });

  it('FLAGS registry entries are distinct single-bit values', () => {
    const values = Object.values(FLAGS);
    for (const f of values) {
      expect(f).toBeGreaterThan(0);
      expect(f & (f - 1)).toBe(0); // single-bit
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('FLAG_* aliases match the FLAGS registry', () => {
    expect(FLAG_HAS_NAME).toBe(FLAGS.hasName);
    expect(FLAG_IS_SOL).toBe(FLAGS.isSol);
    expect(FLAG_HAS_BAYER).toBe(FLAGS.hasBayer);
    expect(FLAG_BINARY_COMPANION_ONLY).toBe(FLAGS.binaryCompanionOnly);
    expect(FLAG_BINARY_PRIMARY).toBe(FLAGS.binaryPrimary);
    expect(FLAG_BINARY_COMPANION_SYNTHETIC).toBe(FLAGS.binaryCompanionSynthetic);
  });

  it('RESERVED_FLAG_BITS does not collide with any registered FLAGS value', () => {
    for (const v of Object.values(FLAGS)) {
      expect(v & RESERVED_FLAG_BITS, `FLAGS value 0x${v.toString(16)} collides with RESERVED_FLAG_BITS`).toBe(0);
    }
  });

  it('reserved + used flag bits stay within the uint8 envelope', () => {
    const used = Object.values(FLAGS).reduce((acc, v) => acc | v, 0);
    expect((used | RESERVED_FLAG_BITS) & ~0xff).toBe(0);
  });

  it('name-table layout is two zero padding bytes + (uint16 len, utf-8 bytes) entries', () => {
    expect(NAME_TABLE_PADDING).toBe(2);
    expect(NAME_LENGTH_PREFIX_BYTES).toBe(2);
    // Round-trip a writer-shaped table inline and verify the reader's
    // pointer-walk lands on the right names. Pins the contract without
    // depending on build-catalog.ts or catalog-loader.ts.
    const encoder = new TextEncoder();
    const names = ['Sol', 'α Cen', '日本']; // ascii + 2-byte + 3-byte UTF-8
    const chunks: Uint8Array[] = [new Uint8Array(NAME_TABLE_PADDING)];
    let len = NAME_TABLE_PADDING;
    const expectedOffsets: number[] = [];
    for (const n of names) {
      const bytes = encoder.encode(n);
      expectedOffsets.push(len);
      const lenHeader = new Uint8Array(NAME_LENGTH_PREFIX_BYTES);
      new DataView(lenHeader.buffer).setUint16(0, bytes.length, true);
      chunks.push(lenHeader);
      chunks.push(bytes);
      len += NAME_LENGTH_PREFIX_BYTES + bytes.length;
    }
    const table = new Uint8Array(len);
    let p = 0;
    for (const c of chunks) { table.set(c, p); p += c.length; }
    // Sentinel padding is zero.
    for (let i = 0; i < NAME_TABLE_PADDING; i++) expect(table[i]).toBe(0);
    // Reader walk — the shared decode both readers use.
    const recovered = readNameTable(table.buffer, 0, len);
    expect([...recovered.values()]).toEqual(names);
    expect([...recovered.keys()]).toEqual(expectedOffsets);
    expect(recovered.has(0)).toBe(false); // offset 0 stays the no-name sentinel
  });
});

describe('catalog-pure / record reader surface', () => {
  const DISTINCT: WireStarRecord = {
    x: 1.5, y: -2.25, z: 3.125,
    vx: 1e-5, vy: -2e-5, vz: 3e-5,
    absmag: -1.75, ci: 0.5, physRadius: 12.5,
    companionIdx: 4242, nameOffset: 18,
    spectClass: 3, lumClass: 4, conIndex: 87, flags: 0x15,
    ampUnits: 200, periodUnits: 40_000, varType: VAR_TYPE_ECLIPSING,
    hip: 120_404, gaiaSourceId: 4_658_107_884_688_023_040n,
    apsis: {
      teffGspphot: 5772, loggGspphot: 4.44, mhGspphot: -0.5, azeroGspphot: 0.25,
      teffGspspec: 5800, loggGspspec: 4.5, mhGspspec: 0.1,
    },
    sid: 99_999,
    multiplicityStatus: MULTIPLICITY_RESOLVED,
  };

  function writeOne(record: WireStarRecord, count = 1): DataView {
    const view = new DataView(new ArrayBuffer(HEADER_SIZE + count * RECORD_SIZE));
    for (let i = 0; i < count; i++) writeStarRecord(view, HEADER_SIZE + i * RECORD_SIZE, record);
    return view;
  }

  it('reads back every field writeStarRecord emits', () => {
    const view = writeOne(DISTINCT);
    const off = HEADER_SIZE;
    expect(readRecordField(view, off, 'x')).toBeCloseTo(DISTINCT.x, 5);
    expect(readRecordField(view, off, 'vy')).toBeCloseTo(DISTINCT.vy, 10);
    expect(readRecordField(view, off, 'absmag')).toBeCloseTo(DISTINCT.absmag, 5);
    expect(readRecordField(view, off, 'companion')).toBe(DISTINCT.companionIdx);
    expect(readRecordField(view, off, 'nameOffset')).toBe(DISTINCT.nameOffset);
    expect(readRecordField(view, off, 'conIndex')).toBe(DISTINCT.conIndex);
    expect(readRecordField(view, off, 'flags')).toBe(DISTINCT.flags);
    expect(readRecordField(view, off, 'ampUnits')).toBe(DISTINCT.ampUnits);
    expect(readRecordField(view, off, 'period')).toBe(DISTINCT.periodUnits);
    expect(readRecordField(view, off, 'varType')).toBe(DISTINCT.varType);
    expect(readRecordField(view, off, 'hip')).toBe(DISTINCT.hip);
    expect(readRecordField(view, off, 'sid')).toBe(DISTINCT.sid);
    expect(readRecordField(view, off, 'multiplicityStatus')).toBe(DISTINCT.multiplicityStatus);
    expect(readRecordFieldBig(view, off, 'gaiaSourceId')).toBe(DISTINCT.gaiaSourceId);
  });

  it('every numeric field reads through the getter its declared kind implies', () => {
    // A u8 field read as u16 (or an f32 read as u32) would return a value
    // outside the kind's range or a NaN-shaped float; walking every field
    // catches a LAYOUT/KINDS pair that drifted apart.
    const view = writeOne(DISTINCT);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const v = readRecordField(view, HEADER_SIZE, field as NumericRecordField);
      expect(Number.isFinite(v), `${field} decoded as ${v}`).toBe(true);
      if (kind === 'u8') expect(v, field).toBeLessThanOrEqual(0xff);
      if (kind === 'u16') expect(v, field).toBeLessThanOrEqual(0xffff);
      if (kind === 'u32') expect(v, field).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('decodeRecordColumn agrees with readRecordField field for field', () => {
    const count = 4;
    const view = writeOne(DISTINCT, count);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const out = new Float32Array(count);
      decodeRecordColumn(view, count, field as NumericRecordField, out);
      for (let i = 0; i < count; i++) {
        const scalar = readRecordField(view, HEADER_SIZE + i * RECORD_SIZE, field as NumericRecordField);
        expect(out[i], `${field}[${i}]`).toBe(Math.fround(scalar));
      }
    }
    const big = new BigUint64Array(count);
    decodeRecordColumnBig(view, count, 'gaiaSourceId', big);
    expect([...big]).toEqual(Array(count).fill(DISTINCT.gaiaSourceId));
  });

  it('decodeRecordColumn interleaves a triple at the given stride + component', () => {
    const count = 3;
    const view = writeOne(DISTINCT, count);
    const positions = new Float32Array(count * 3);
    decodeRecordColumn(view, count, 'x', positions, { stride: 3, component: 0 });
    decodeRecordColumn(view, count, 'y', positions, { stride: 3, component: 1 });
    decodeRecordColumn(view, count, 'z', positions, { stride: 3, component: 2 });
    for (let i = 0; i < count; i++) {
      expect(positions[i * 3 + 0]).toBeCloseTo(DISTINCT.x, 5);
      expect(positions[i * 3 + 1]).toBeCloseTo(DISTINCT.y, 5);
      expect(positions[i * 3 + 2]).toBeCloseTo(DISTINCT.z, 5);
    }
  });

  it('scale de-quantises the amplitude + period bytes back to physical units', () => {
    const view = writeOne(DISTINCT);
    const amp = new Float32Array(1);
    const period = new Float32Array(1);
    decodeRecordColumn(view, 1, 'ampUnits', amp, { scale: AMP_MAG_PER_UNIT });
    decodeRecordColumn(view, 1, 'period', period, { scale: PERIOD_DAYS_PER_UNIT });
    expect(amp[0]).toBeCloseTo(10, 6);      // 200 × 0.05 mag
    expect(period[0]).toBeCloseTo(4000, 3); // 40000 × 0.1 d
  });

  it('the quantisation steps are the exact inverse of the encoders', () => {
    // AMP_MAG_PER_UNIT / PERIOD_DAYS_PER_UNIT are the decode-side spelling
    // of encodeAmpUnits / encodePeriodUnits' factors; a drift in either
    // silently rescales every shipped variability value.
    for (const mag of [0, 0.05, 0.35, 1.2, 9.4, 12.75]) {
      expect(encodeAmpUnits(mag) * AMP_MAG_PER_UNIT).toBeCloseTo(mag, 10);
    }
    for (const days of [0, 0.1, 4.4, 146.5, 409.2, 6553.5]) {
      expect(encodePeriodUnits(days) * PERIOD_DAYS_PER_UNIT).toBeCloseTo(days, 10);
    }
  });

  it('readCatalogHeader returns the written header and rejects foreign buffers', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(buffer), {
      count: 7, nameTableOffset: 32, nameTableLength: 2,
    });
    expect(readCatalogHeader(buffer)).toEqual({
      magic: MAGIC,
      version: BINARY_VERSION,
      count: 7,
      nameTableOffset: 32,
      nameTableLength: 2,
    });

    const badMagic = new ArrayBuffer(HEADER_SIZE);
    new Uint8Array(badMagic).set([0x4e, 0x4f, 0x50, 0x45]); // "NOPE"
    expect(() => readCatalogHeader(badMagic)).toThrow(/Bad magic/);

    const oldVersion = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(oldVersion), {
      count: 1, nameTableOffset: 32, nameTableLength: 0,
    });
    new DataView(oldVersion).setUint32(HEADER_LAYOUT.version, BINARY_VERSION - 1, true);
    expect(() => readCatalogHeader(oldVersion)).toThrow(/Unsupported catalog version/);
  });
});

describe('catalog-pure / search-index wire contract', () => {
  // The SearchEntry field names ARE the on-disk keys of search-index.json.
  // buildSearchEntry (writer) and src/client/typeahead/search.ts (reader)
  // share the type, so tsc keeps their field access in lockstep — but
  // main.ts ingests the file through an unchecked `as SearchEntry[]` cast,
  // so a rename silently reshapes the persisted wire format (breaking any
  // cached index / external consumer) with no red test. Pin the literal
  // key strings so a rename trips here, mirroring the binary
  // record-layout pin above.
  const SEARCH_ENTRY_KEYS = [
    'i', 'p', 'b', 'bx', 'bc', 'f', 'gd', 'gh', 'c', 'dc', 's', 'g', 'hip',
    'hd', 'hr', 'hda', 'hra', 'gl', 'cl', 'cp', 'al',
  ];

  it('SearchEntry exposes exactly the documented wire keys', () => {
    // Excess-property checking makes a renamed or dropped interface key a
    // compile error on this literal; the runtime assertion pins the names.
    const full: Required<SearchEntry> = {
      i: 0, p: 'Sirius', b: 'α', bx: 1, bc: 'A', f: 9, gd: 268, gh: 'Cau', c: 34,
      dc: 3, s: 'A1V', g: 'R CrB', hip: 32349, hd: 48915, hr: 2491,
      hda: [48916], hra: [2492], gl: 'GJ 244', cl: 'B', cp: 5,
      al: ['Alhabor'],
    };
    expect(Object.keys(full).sort()).toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  const source = (over: Partial<SearchEntrySource>): SearchEntrySource => ({
    proper: null, bayer: null, bayerSup: null, bayerComponent: null,
    gould: null, gouldHalf: null,
    aliases: [], flam: null, hip: null, hd: null, hr: null,
    hdAlt: [], hrAlt: [], gl: null, gcvsName: null, conIndex: NO_CONSTELLATION_INDEX,
    desigConIndex: NO_CONSTELLATION_INDEX, spectDisplay: null, ...over,
  });

  it('buildSearchEntry emits every populated wire key', () => {
    const entry = buildSearchEntry(
      source({
        proper: 'Sirius', bayer: 'α', bayerSup: 1, bayerComponent: 'A',
        flam: 9, gould: 268,
        gouldHalf: 'Cau', aliases: ['Alhabor'], hip: 32349, hd: 48915,
        hr: 2491, hdAlt: [48916], hrAlt: [2492],
        gl: 'GJ 244', gcvsName: 'R CrB', conIndex: 34,
        desigConIndex: 3, spectDisplay: 'A1V',
      }),
      0,
      { comp: 'B', primaryIdx: 5 },
    );
    expect(entry).not.toBeNull();
    expect(Object.keys(entry as SearchEntry).sort())
      .toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  it('buildSearchEntry omits absent fields — no null/undefined on the wire', () => {
    const entry = buildSearchEntry(source({ hip: 7 }), 3, undefined);
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ i: 3, hip: 7 });
    expect(Object.keys(entry as SearchEntry)).toEqual(['i', 'hip']);
  });

  it('buildSearchEntry drops the unclassified constellation sentinel', () => {
    const entry = buildSearchEntry(
      source({ hip: 7, conIndex: NO_CONSTELLATION_INDEX }), 0, undefined,
    );
    expect(entry).not.toHaveProperty('c');
  });

  it('buildSearchEntry returns null for a star with no typable identifier', () => {
    expect(buildSearchEntry(source({ conIndex: 34 }), 0, undefined)).toBeNull();
  });

  it('buildSearchEntry emits dc only where the designation constellation differs', () => {
    // Agreeing (the overwhelming majority) and unknown-designation records
    // both ride the reader's `dc ?? c` fallback, so neither pays wire cost.
    const agreeing = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigConIndex: 34 }), 0, undefined,
    );
    expect(agreeing).not.toHaveProperty('dc');
    const unknown = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigConIndex: NO_CONSTELLATION_INDEX }), 0, undefined,
    );
    expect(unknown).not.toHaveProperty('dc');
    // ρ Aql's shape: positional Delphinus, designation Aquila.
    const diverging = buildSearchEntry(
      source({ bayer: 'Rho', flam: 67, hip: 99742, conIndex: 31, desigConIndex: 3 }),
      0, undefined,
    );
    expect(diverging?.c).toBe(31);
    expect(diverging?.dc).toBe(3);
  });

  it('buildSearchEntry withholds dc from an entry with no constellation-relative designation', () => {
    // A star findable only by HIP/HD/HR/Gl never renders "<designation>
    // <Con>", so carrying the field would be 60-odd bytes of wire for a
    // reader that cannot consult it.
    const byNumber = buildSearchEntry(
      source({ hip: 7, hd: 9, conIndex: 31, desigConIndex: 3 }), 0, undefined,
    );
    expect(byNumber).not.toHaveProperty('dc');
    // A component alias composes "<primary designation> <letter>" against
    // this entry's constellation, so it does need it (Fomalhaut C sits in
    // Aquarius but is "α PsA C").
    const component = buildSearchEntry(
      source({ proper: 'Fomalhaut C', conIndex: 4, desigConIndex: 65 }),
      0, { comp: 'C', primaryIdx: 5 },
    );
    expect(component?.dc).toBe(65);
  });

  it('designationConIndex prefers the editorial index and falls back to the positional one', () => {
    expect(designationConIndex(3, 31)).toBe(3);
    expect(designationConIndex(NO_CONSTELLATION_INDEX, 31)).toBe(31);
    expect(designationConIndex(undefined, 31)).toBe(31);
    expect(designationConIndex(undefined, undefined)).toBe(NO_CONSTELLATION_INDEX);
  });
});

// ─── Bailer-Jones (DR3) distance override ──────────────────────────────

describe('catalog-pure / parseBailerJonesTsv', () => {
  it('parses source_id as string and prefers r_med_photogeo', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '204531088580182016\t6366.668\t6300\t6420\t6244.791\t6200\t6280\t10033\n' +
      '4773096563064098432\t93.528\t92\t94\t92.871\t92\t93\t10023\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.size).toBe(2);
    expect(map.get('204531088580182016')).toBe(6244.791);
    expect(map.get('4773096563064098432')).toBe(92.871);
  });

  it('falls back to r_med_geo when r_med_photogeo is empty', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '123\t250.0\t245\t255\t\t\t\t33333\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.get('123')).toBe(250.0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseBailerJonesTsv('source_id\tr_med_geo\n1\t10\n'))
      .toThrow(/r_med_photogeo/);
  });

  it('skips rows with non-positive distance and blank source_ids', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '\t10\t9\t11\t10\t9\t11\t1\n' +
      '999\t-1\t-1\t-1\t\t\t\t1\n' +
      '111\t100\t99\t101\t99\t98\t100\t1\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.size).toBe(1);
    expect(map.get('111')).toBe(99);
  });
});

describe('catalog-pure / parseGaiaApsisTsv', () => {
  const HDR =
    'source_id\tteff_gspphot\tlogg_gspphot\tmh_gspphot\tazero_gspphot\t' +
    'teff_gspspec\tlogg_gspspec\tmh_gspspec\tspectraltype_esphs\n';

  it('parses source_id as string, both gspphot and gspspec triples, plus the esphs enum', () => {
    const tsv = HDR +
      '7632157690368\t5028.8\t3.1614\t-0.1016\t0.2131\t4864.0\t2.6600\t-0.2000\tK\n' +
      '44358422235136\t5787.8\t4.3140\t0.3385\t0.0648\t\t\t\tG\n';
    const map = parseGaiaApsisTsv(tsv);
    expect(map.size).toBe(2);
    const a = map.get('7632157690368')!;
    expect(a.teffGspphot).toBe(5028.8);
    expect(a.loggGspphot).toBe(3.1614);
    expect(a.mhGspphot).toBe(-0.1016);
    expect(a.azeroGspphot).toBe(0.2131);
    expect(a.teffGspspec).toBe(4864.0);
    expect(a.loggGspspec).toBe(2.6600);
    expect(a.mhGspspec).toBe(-0.2000);
    expect(a.spectraltypeEsphs).toBe('K');
    const b = map.get('44358422235136')!;
    expect(b.teffGspphot).toBe(5787.8);
    expect(b.teffGspspec).toBeNull();
    expect(b.loggGspspec).toBeNull();
    expect(b.mhGspspec).toBeNull();
    expect(b.spectraltypeEsphs).toBe('G');
  });

  it('decodes blank cells as null without dropping the row', () => {
    const tsv = HDR + '999\t\t\t\t\t6000\t4.0\t0.0\t\n';
    const map = parseGaiaApsisTsv(tsv);
    const r = map.get('999')!;
    expect(r.teffGspphot).toBeNull();
    expect(r.loggGspphot).toBeNull();
    expect(r.mhGspphot).toBeNull();
    expect(r.azeroGspphot).toBeNull();
    expect(r.teffGspspec).toBe(6000);
    expect(r.loggGspspec).toBe(4.0);
    expect(r.mhGspspec).toBe(0.0);
    expect(r.spectraltypeEsphs).toBeNull();
  });

  it('skips rows with a blank source_id', () => {
    const tsv = HDR + '\t5000\t4\t0\t0\t5000\t4\t0\tG\n';
    const map = parseGaiaApsisTsv(tsv);
    expect(map.size).toBe(0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseGaiaApsisTsv('source_id\tteff_gspphot\n1\t5000\n'))
      .toThrow(/azero_gspphot|logg_gspphot|mh_gspphot|teff_gspspec|spectraltype_esphs/);
  });
});

describe('catalog-pure / NO_APSIS sentinel', () => {
  it('is NaN, distinguishable from every finite Apsis value', () => {
    expect(Number.isNaN(NO_APSIS)).toBe(true);
  });

  it('round-trips through Float32 DataView as NaN', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, NO_APSIS, true);
    expect(Number.isNaN(view.getFloat32(0, true))).toBe(true);
  });

  it('finite values survive Float32 round-trip without becoming the sentinel', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    // Pick values from the bead spec's spot-check stars (Sirius-region
    // Teff ~10000K, K-dwarf logg ~4.5, halo [M/H] ~-1.5, mild A0 ~0.2).
    for (const v of [10000.0, 4.5, -1.5, 0.2]) {
      view.setFloat32(0, v, true);
      const r = view.getFloat32(0, true);
      expect(Number.isNaN(r)).toBe(false);
      expect(r).toBeCloseTo(v, 3);
    }
  });
});

describe('catalog-pure / apparentToAbsoluteMagnitude', () => {
  it('is identity at 10 pc', () => {
    expect(apparentToAbsoluteMagnitude(5.0, 10)).toBe(5.0);
  });

  it('M = m − 5·log₁₀(d/10)', () => {
    // 100 pc is 5 magnitudes dimmer than 10 pc.
    expect(apparentToAbsoluteMagnitude(15, 100)).toBeCloseTo(10, 10);
    // 1000 pc is 10 magnitudes dimmer than 10 pc.
    expect(apparentToAbsoluteMagnitude(20, 1000)).toBeCloseTo(10, 10);
  });
});

describe('catalog-pure / applyBailerJonesOverride', () => {
  // Tier-A fixtures: real pre-override + Bailer-Jones DR3 values for the
  // four catastrophic parallax-inversion supergiants and a
  // well-measured F-dwarf control. Numbers pin the override outcome:
  // drift here means the override changed semantics or the upstream
  // catalogues drifted.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number; sourceId: string;
    preOverrideDist: number;       // the parallax inversion, pre-override
    bjDist: number;          // r_med_photogeo from data/bailer-jones-dr3.tsv
  }
  const FIVE_HIPS: Fixture[] = [
    { label: 'HIP 22365', ra: 4.81481859, dec:  43.27557981, mag:  7.7,  sourceId: '204531088580182016', preOverrideDist:  9963.4514, bjDist: 6244.791 },
    { label: 'HIP 25733', ra: 5.49517982, dec:  35.37501942, mag:  6.78, sourceId: '183255985260080896', preOverrideDist: 14326.6476, bjDist: 5466.246 },
    { label: 'HIP 38430', ra: 7.87230124, dec: -26.42963691, mag:  9.19, sourceId: '5602025904044961536', preOverrideDist: 12658.2278, bjDist: 6215.232 },
    { label: 'HIP 46144', ra: 9.41038175, dec:  62.43823034, mag: 10.14, sourceId: '1040043514891491968', preOverrideDist:  9189.7878, bjDist: 7515.496 },
    { label: 'HIP 23785', ra: 5.11164486, dec: -50.94139857, mag:  8.39, sourceId: '4773096563064098432', preOverrideDist:    93.1801, bjDist:   92.871 },
  ];
  const bjMap = new Map(FIVE_HIPS.map((f) => [f.sourceId, f.bjDist] as const));

  it('returns null when source_id is missing or absent from the map', () => {
    expect(applyBailerJonesOverride(null, bjMap)).toBeNull();
    expect(applyBailerJonesOverride('', bjMap)).toBeNull();
    expect(applyBailerJonesOverride('0000', bjMap)).toBeNull();
  });

  it('pins the BJ distance', () => {
    for (const f of FIVE_HIPS) {
      const out = applyBailerJonesOverride(f.sourceId, bjMap);
      expect(out, f.label).not.toBeNull();
      expect(out, f.label).toBe(f.bjDist);
    }
  });

  it('pulls the three highest-S/N supergiants back by 37%-62%', () => {
    // HIP 22365 / 25733 / 38430 are the showcase catastrophic-parallax
    // pullbacks (37%, 62%, 51%). HIP 46144 is the fourth flagged outlier
    // but only drops 18% — the test caps at three for the ≥25% headline,
    // and HIP 46144's pullback is asserted separately below.
    for (const label of ['HIP 22365', 'HIP 25733', 'HIP 38430']) {
      const f = FIVE_HIPS.find((x) => x.label === label)!;
      const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
      const drop = (f.preOverrideDist - out) / f.preOverrideDist;
      expect(drop, `${label} drop ratio`).toBeGreaterThan(0.25);
    }
  });

  it('HIP 46144 pulls back ~18% (lower-S/N outlier)', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 46144')!;
    const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
    const drop = (f.preOverrideDist - out) / f.preOverrideDist;
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeLessThan(0.20);
  });

  it('leaves the well-measured F-dwarf HIP 23785 within 5%', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 23785')!;
    const out = applyBailerJonesOverride(f.sourceId, bjMap)!;
    expect(Math.abs(f.preOverrideDist - out) / f.preOverrideDist).toBeLessThan(0.05);
  });

});

describe('catalog-pure / isBailerJonesEligible', () => {
  it('admits only the tier whose parallax B-J is a posterior over', () => {
    expect(isBailerJonesEligible('123', 'gaia_dr3_inversion')).toBe(true);
  });

  it('refuses every non-Gaia parallax tier — B-J would substitute its Galactic '
    + 'prior for a measurement', () => {
    for (const via of DIST_VIA_VALUES) {
      if (via === 'gaia_dr3_inversion') continue;
      expect(isBailerJonesEligible('123', via)).toBe(false);
    }
  });

  it('rejects rows without a Gaia source_id even on the Gaia tier', () => {
    expect(isBailerJonesEligible(null, 'gaia_dr3_inversion')).toBe(false);
    expect(isBailerJonesEligible('', 'gaia_dr3_inversion')).toBe(false);
  });

  it('gates on the resolved tier alone — no editorial source cell '
    + 'steers it, and the manifest carries none', () => {
    // Only the resolved tier decides.
    expect(isBailerJonesEligible('123', 'hip2_parallax')).toBe(false);
    expect(isBailerJonesEligible('123', 'gaia_dr3_inversion')).toBe(true);
  });
});

describe('catalog-pure / parseGaiaSourceIdStr', () => {
  it('returns the trimmed decimal string for a valid Gaia source_id', () => {
    expect(parseGaiaSourceIdStr('5877748442128924544')).toBe('5877748442128924544');
    expect(parseGaiaSourceIdStr('  5877748442128924544  ')).toBe('5877748442128924544');
  });

  it('preserves digits beyond 2^53 verbatim (never coerces to Number)', () => {
    // The whole point: a value above 2^53 would lose bits if parsed
    // numerically. Round-trip via BigInt to prove the string is BigInt-safe.
    const raw = '9876543210123456789';
    const parsed = parseGaiaSourceIdStr(raw);
    expect(parsed).toBe(raw);
    expect(BigInt(parsed!).toString()).toBe(raw);
  });

  it('returns null for null / undefined / empty / whitespace-only inputs', () => {
    expect(parseGaiaSourceIdStr(null)).toBeNull();
    expect(parseGaiaSourceIdStr(undefined)).toBeNull();
    expect(parseGaiaSourceIdStr('')).toBeNull();
    expect(parseGaiaSourceIdStr('   ')).toBeNull();
  });

  it('returns null for non-decimal cells so BigInt() never sees garbage', () => {
    // BigInt('abc') throws SyntaxError; the gate above must catch
    // anything that isn't pure decimal digits before it gets there.
    expect(parseGaiaSourceIdStr('abc')).toBeNull();
    expect(parseGaiaSourceIdStr('123abc')).toBeNull();
    expect(parseGaiaSourceIdStr('1.23')).toBeNull();
    expect(parseGaiaSourceIdStr('-123')).toBeNull();
    expect(parseGaiaSourceIdStr('+123')).toBeNull();
    expect(parseGaiaSourceIdStr('1e9')).toBeNull();
    expect(parseGaiaSourceIdStr('0x1234')).toBeNull();
  });
});

describe('catalog-pure / resolveGaiaSourceId', () => {
  const map = new Map<number, string>([
    [2, '2341871673090078592'],
    [3, '2881742980523997824'],
  ]);

  it('returns the manifest source_id untouched (precedence over cross-walk)', () => {
    expect(resolveGaiaSourceId('999', 2, map)).toEqual({
      gaiaSourceId: '999',
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('backfills from HIP cross-walk when the manifest gaia cell is null', () => {
    expect(resolveGaiaSourceId(null, 2, map)).toEqual({
      gaiaSourceId: '2341871673090078592',
      backfilled: true,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when HIP is absent (no cross-walk key available)', () => {
    expect(resolveGaiaSourceId(null, null, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when HIP is not in the cross-walk (Gaia-saturated bright stars)', () => {
    // Sirius (HIP 32349), Vega (91262), Procyon (37279) etc. are absent
    // from `hipparcos2_best_neighbour` — they stay unresolved here.
    expect(resolveGaiaSourceId(null, 32349, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when the HIP cross-walk itself is null (build without xmatch file)', () => {
    expect(resolveGaiaSourceId(null, 2, null)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('rejects non-positive HIP values', () => {
    expect(resolveGaiaSourceId(null, 0, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
    expect(resolveGaiaSourceId(null, -1, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });
});

describe('catalog-pure / resolveGaiaSourceId magnitude gate', () => {
  const gMags = new Map<string, number>([
    ['5877748442128924544', 20.95], // Toliman's wrong background binding
    ['777', 1.6],
  ]);
  const gMagOf = (id: string) => gMags.get(id) ?? null;

  it('scrubs a native binding fainter in G than V beyond the gate (Toliman)', () => {
    expect(
      resolveGaiaSourceId('5877748442128924544', null, null, 1.33, gMagOf),
    ).toEqual({ gaiaSourceId: null, backfilled: false, magRejected: true, siblingRejected: false });
  });

  it('keeps a native binding consistent with V', () => {
    expect(resolveGaiaSourceId('777', null, null, 1.58, gMagOf)).toEqual({
      gaiaSourceId: '777', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
  });

  it('scrubs a cross-walk hit that fails the gate', () => {
    const xmap = new Map<number, string>([[71681, '5877748442128924544']]);
    expect(resolveGaiaSourceId(null, 71681, xmap, 1.33, gMagOf)).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: true,
      siblingRejected: false,
    });
  });

  it('falls through from a rejected native cell to a passing cross-walk hit', () => {
    const xmap = new Map<number, string>([[1, '777']]);
    expect(
      resolveGaiaSourceId('5877748442128924544', 1, xmap, 1.58, gMagOf),
    ).toEqual({ gaiaSourceId: '777', backfilled: true, magRejected: true, siblingRejected: false });
  });

  it('passes ungated without a G magnitude or a V magnitude', () => {
    expect(resolveGaiaSourceId('12345', null, null, 1.0, gMagOf)).toEqual({
      gaiaSourceId: '12345', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
    expect(
      resolveGaiaSourceId('5877748442128924544', null, null, null, gMagOf),
    ).toEqual({
      gaiaSourceId: '5877748442128924544', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
  });

  it('matches the binaries pipeline threshold (scripts/binaries/indices.py)', () => {
    const py = readFileSync(resolve(__dirname, '../binaries/indices.py'), 'utf8');
    const m = py.match(/^GAIA_BINDING_G_MINUS_V_REJECT_MAG\s*=\s*([\d.]+)/m);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBe(GAIA_BINDING_G_MINUS_V_REJECT_MAG);
  });
});

describe('catalog-pure / sibling-letter attribution gate', () => {
  // Live SIMBAD shapes as of the 2026-07 re-pull: μ Dra carries
  // blend-suffixed HIPs (83608A + 83608B); HD 70492's bare HIP 41098
  // lives on a system-level SIMBAD object absent from the per-component
  // xids, so neither component row carries it.
  const XIDS_TSV = [
    'wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip',
    '17053+5428\tA\t373388\t* mu. Dra A\t1420101696287738368\t83608',
    '17053+5428\tB\t373389\t* mu. Dra B\t1420101696285626624\t83608',
    '17053+5428\tC\t373439\t* mu. Dra C\t1420101696286312448\t',
    '08231+2001\tA\t18621022\tHD  70492A\t663434291021197568\t',
    '08231+2001\tB\t18621023\tHD  70492B\t663434291018997248\t',
    '99990+9990\tA\t2\town-hip A\t556\t',
    '99990+9990\tB\t1\town-hip B\t555\t104217',
    '06451-1643\tA\t3\tsaturated A\t\t32349',
    '06451-1643\tB\t4\tsaturated B\t777\t',
    '11111+1111\tA\t5\tblend A\t888\t',
    '11111+1111\tB\t6\tblend B\t888\t',
    '22222+2222\tA\t7\tlineage A\t\t100',
    '22222+2222\tAa\t8\tlineage Aa\t999\t',
  ].join('\n');
  const xids = parseSimbadWdsXidsTsv(XIDS_TSV);

  it('parses source / HIP attributions and the primary source letter', () => {
    expect(xids.bySource.get('1420101696285626624')).toEqual([
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.byHip.get(83608)).toEqual([
      { wdsId: '17053+5428', component: 'A' },
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.primarySourceLetterByWds.get('17053+5428')).toBe('A');
    expect(xids.primarySourceLetterByWds.get('06451-1643')).toBe('B');
  });

  it('rejects required-column drift', () => {
    expect(() => parseSimbadWdsXidsTsv('wds_id\tcomponent\n')).toThrow(
      /missing required columns/,
    );
  });

  it('scrubs a blend-suffixed-HIP row keyed on the sibling source (μ Dra)', () => {
    expect(
      isSiblingLetterAttribution('1420101696285626624', 83608, xids),
    ).toBe(true);
  });

  it('scrubs a system-level-HIP row keyed on the sibling source (HD 70492)', () => {
    expect(
      isSiblingLetterAttribution('663434291018997248', 41098, xids),
    ).toBe(true);
  });

  it('keeps the primary letter source on the same rows', () => {
    expect(
      isSiblingLetterAttribution('1420101696287738368', 83608, xids),
    ).toBe(false);
    expect(
      isSiblingLetterAttribution('663434291021197568', 41098, xids),
    ).toBe(false);
  });

  it('keeps a secondary row whose own HIP is attributed to its letter', () => {
    expect(isSiblingLetterAttribution('555', 104217, xids)).toBe(false);
  });

  it('scrubs on directly-disjoint HIP letters even when the primary carries no source', () => {
    expect(isSiblingLetterAttribution('777', 32349, xids)).toBe(true);
  });

  it('never scrubs a photocentre blend (source attributed to two letters)', () => {
    expect(isSiblingLetterAttribution('888', 12345, xids)).toBe(false);
  });

  it('treats sub-letters as the parent lineage, not siblings', () => {
    expect(isSiblingLetterAttribution('999', 100, xids)).toBe(false);
  });

  it('is inert without a HIP or without the xids index', () => {
    expect(isSiblingLetterAttribution('1420101696285626624', null, xids)).toBe(false);
    expect(isSiblingLetterAttribution('1420101696285626624', 83608, null)).toBe(false);
  });

  it('resolveGaiaSourceId scrubs the native cell AND the cross-walk candidate', () => {
    const xmap = new Map<number, string>([[83608, '1420101696285626624']]);
    expect(
      resolveGaiaSourceId('1420101696285626624', 83608, xmap, null, null, xids),
    ).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: false,
      siblingRejected: true,
    });
    expect(
      resolveGaiaSourceId('663434291018997248', 41098, null, null, null, xids),
    ).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: false,
      siblingRejected: true,
    });
  });
});

describe('catalog-pure / angularSeparationDeg', () => {
  it('returns 0 for identical positions', () => {
    expect(angularSeparationDeg(5, -30, 5, -30)).toBeCloseTo(0, 10);
  });

  it('returns 90° between RA-axis pole and equator at RA=0', () => {
    expect(angularSeparationDeg(0, 90, 0, 0)).toBeCloseTo(90, 6);
  });

  it('returns ~90° for two equatorial points 6h apart', () => {
    expect(angularSeparationDeg(0, 0, 6, 0)).toBeCloseTo(90, 6);
  });

  it('matches a known LMC-direction great-circle distance', () => {
    // HD 268749 at (4.8915 h, -69.409°) → LMC centre (5.25067 h, -69.19°).
    // Compute by hand: small-angle approximation says ~2.5° separation;
    // exact vector form here is the canonical value.
    const sep = angularSeparationDeg(4.8915, -69.409, LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG);
    expect(sep).toBeGreaterThan(0.5);
    expect(sep).toBeLessThan(LMC_CONE_HALF_ANGLE_DEG);
  });
});

describe('catalog-pure / isInLmcCone', () => {
  it('accepts the LMC centre itself', () => {
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG)).toBe(true);
  });

  it('rejects a solar-neighbourhood RA/Dec diametrically opposite the LMC', () => {
    // (RA=12h, Dec=0°) — far from the LMC cone.
    expect(isInLmcCone(12, 0)).toBe(false);
  });

  it('rejects the SMC direction (out of scope)', () => {
    // SMC centre ≈ (0.877 h, -72.8°). Outside the LMC cone — the SMC
    // override gets its own pipeline.
    expect(isInLmcCone(0.877, -72.8)).toBe(false);
  });

  it('boundary: just inside the cone passes, just outside fails', () => {
    // Confirms the cone gate is the half-angle, not something tighter
    // like a great-circle box.
    const epsilon = 0.01;
    const inDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG - epsilon);
    const outDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG + epsilon);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, inDec)).toBe(true);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, outDec)).toBe(false);
  });

  /** Great-circle destination from the LMC centre: walk `sepDeg` along
   *  initial position angle `paDeg` (east of north), return [raHours, decDeg].
   *  Standard navigation formulas — independent of angularSeparationDeg's
   *  vector implementation. */
  function offsetFromLmcCentre(sepDeg: number, paDeg: number): [number, number] {
    const d1 = (LMC_CENTRE_DEC_DEG * Math.PI) / 180;
    const s = (sepDeg * Math.PI) / 180;
    const pa = (paDeg * Math.PI) / 180;
    const d2 = Math.asin(Math.sin(d1) * Math.cos(s) + Math.cos(d1) * Math.sin(s) * Math.cos(pa));
    const dRa = Math.atan2(
      Math.sin(pa) * Math.sin(s) * Math.cos(d1),
      Math.cos(s) - Math.sin(d1) * Math.sin(d2),
    );
    return [
      LMC_CENTRE_RA_HOURS + (dRa * 180 / Math.PI) / 15,
      (d2 * 180) / Math.PI,
    ];
  }

  it('boundary: just inside the cone passes on the RA axis (cos(Dec) weighting)', () => {
    // At Dec −69.19° (cos Dec ≈ 0.355) a 15° great-circle arc due east
    // swings RA by 37.02°, not 15° — pin the stretch so a "simplified"
    // separation that drops the cos(Dec) weighting fails here.
    const epsilon = 0.01;
    const [raEdge] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG, 90);
    expect((raEdge - LMC_CENTRE_RA_HOURS) * 15).toBeCloseTo(37.0241, 3);
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 90);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 90);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });

  it('boundary: diagonal RA+Dec offset at cone edge', () => {
    // PA 45° — both axes move, so the gate must be great-circle
    // distance, not a per-axis (Manhattan/box) test.
    const epsilon = 0.01;
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 45);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 45);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });
});

describe('catalog-pure / LMC distance vs MAX_DIST_PC invariant', () => {
  it('LMC_DISTANCE_PC sits inside the bounded-scope cutoff', () => {
    // The kinematic override snaps ~54 supergiants to LMC_DISTANCE_PC,
    // then every row passes the dist > MAX_DIST_PC drop. If either
    // constant drifts across the other, the whole LMC population is
    // silently dropped with no counter to surface it. Any future
    // kinematic-override target (SMC ≈ 62 kpc) must either satisfy
    // this or raise MAX_DIST_PC.
    expect(LMC_DISTANCE_PC).toBeLessThan(MAX_DIST_PC);
  });
});

describe('catalog-pure / applyLmcKinematicOverride', () => {
  // Tier-A fixtures from Gaia DR3 — three real LMC supergiants
  // (HDE 268xxx range) and one halo-PM outlier inside the LMC cone.
  // The distances are the pre-override values that get smeared
  // 5-200 kpc by 1/π inversion.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number;
    pmRa: number | null; pmDec: number | null;
    preOverrideDist: number;
  }
  const LMC_HITS: Fixture[] = [
    { label: 'HD 268749 (B7 IAB LMC supergiant)', ra: 4.8915, dec: -69.409, mag: 12.029, pmRa: 2.044, pmDec: -0.096, preOverrideDist: 13368.7 },
    { label: 'HD 268718',                         ra: 4.866, dec: -69.426, mag: 10.596, pmRa: 2.093, pmDec: -0.138, preOverrideDist: 46323.4 },
    { label: 'HD 268654 (smeared to 196 kpc)',    ra: 4.820, dec: -69.457, mag: 10.5,   pmRa: 2.033, pmDec: -0.198, preOverrideDist: 196078.4 },
  ];
  const LMC_PM_NON_HITS: Fixture[] = [
    // Inside the LMC cone but PM ≠ LMC bulk — a halo star or runaway,
    // should pass through unchanged.
    { label: 'HD 270752 (halo in LMC direction)', ra: 4.792, dec: -65.331, mag: 11.214, pmRa: 14.925, pmDec: -3.62, preOverrideDist: 5298.5 },
  ];

  it('LMC-direction + LMC-PM star is snapped to 49.594 kpc', () => {
    for (const f of LMC_HITS) {
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec);
      expect(out, f.label).toBe(LMC_DISTANCE_PC);
    }
  });

  it('LMC-direction + non-LMC-PM star is unchanged (null override)', () => {
    for (const f of LMC_PM_NON_HITS) {
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec);
      expect(out, f.label).toBeNull();
    }
  });

  it('off-cone star with textbook LMC bulk PM is not overridden', () => {
    // The gate the function owns rather than delegates: a star whose PM
    // sits exactly on the LMC bulk centre but which lies nowhere near the
    // LMC gets no override. Snapping it would teleport a Galactic star to
    // 49.6 kpc.
    expect(applyLmcKinematicOverride(
      12, 0, LMC_PM_RA_CENTRE, LMC_PM_DEC_CENTRE,
    )).toBeNull();
  });

  it('returns null when pm_ra or pm_dec is missing', () => {
    // A star in the LMC cone with null proper motion — should NOT be
    // overridden. A row can reach a position tier that states no proper
    // motion; treat those as ineligible for the kinematic gate.
    expect(applyLmcKinematicOverride(
      LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG, null, 0,
    )).toBeNull();
    expect(applyLmcKinematicOverride(
      LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG, 0, null,
    )).toBeNull();
  });

  it('ordering: LMC_KIN wins over BJ for an LMC-cone star with both', () => {
    // Synthetic LMC-cone + LMC-PM star with a B-J entry. Simulates the
    // build-catalog.ts ordering: B-J runs first and writes its posterior;
    // LMC_KIN runs after and clobbers it. Test by composing the two
    // overrides in the same order as the build script.
    const f = LMC_HITS[0]; // HD 268749
    const sourceId = 'fake-lmc-source-id';
    const bjMap = new Map([[sourceId, 8000]]); // arbitrary B-J posterior ≠ LMC distance
    const bj = applyBailerJonesOverride(sourceId, bjMap);
    expect(bj).toBe(8000);
    const lmc = applyLmcKinematicOverride(f.ra, f.dec, f.pmRa, f.pmDec);
    expect(lmc).toBe(LMC_DISTANCE_PC);
    // Final state mirrors what build-catalog.ts ends up with.
    expect(lmc).not.toBe(bj);
  });

  it('boundary: PM tolerance is per-component, not radial', () => {
    // |Δpm_ra| at the tolerance, |Δpm_dec| at 0 → pass. Mirror case → pass.
    // Both at the tolerance → still pass (per-component, not Euclidean).
    const eps = 1e-9;
    const atCentre = [LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG] as const;
    const passEdgeRa = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps, LMC_PM_DEC_CENTRE,
    );
    expect(passEdgeRa).not.toBeNull();
    const passBothEdges = applyLmcKinematicOverride(
      ...atCentre,
      LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps,
      LMC_PM_DEC_CENTRE - LMC_PM_TOLERANCE + eps,
    );
    expect(passBothEdges).not.toBeNull();
    const failJustOver = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE + eps, LMC_PM_DEC_CENTRE,
    );
    expect(failJustOver).toBeNull();
  });

});

describe('catalog-pure / transport chunking', () => {
  it('planCatalogChunks splits on the target with a short final chunk', () => {
    expect(planCatalogChunks(350, 100)).toEqual([100, 100, 100, 50]);
    expect(planCatalogChunks(200, 100)).toEqual([100, 100]);
    expect(planCatalogChunks(50, 100)).toEqual([50]);
    expect(planCatalogChunks(0, 100)).toEqual([0]);
  });

  it('planCatalogChunks rejects a non-positive target', () => {
    expect(() => planCatalogChunks(100, 0)).toThrow(/Invalid chunk target/);
  });

  it('assembleCatalogChunks throws on chunk-count mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/count mismatch/);
  });

  it('assembleCatalogChunks throws on chunk-length mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() =>
      assembleCatalogChunks([new Uint8Array(4), new Uint8Array(3)], manifest),
    ).toThrow(/chunk 1 length mismatch/);
  });

  it('assembleCatalogChunks throws on total-bytes mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/size mismatch/);
  });
});
