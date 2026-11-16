// The naming ladder's authority tiers over the record array: approved
// names, glyph-bearing designations, disposition routing, aliases.
// See README.md#the-record-side-join.

import { readArtifact } from '../../util/sources/source';
import { FLAG_IS_SOL } from '../../../src/catalog-format/record/catalog-pure';
import { CON_INDEX } from '../parse/constellations/constellations';
import { foldNameKey } from './wgsn-normalise-pure';
import {
  buildDesignationConIndex, designationConstellation, type DesignationConIndex,
} from '../classic-ids/designation-constellation-pure';
import { CROSS_INDEX } from '../classic-ids/cross-index-source';
import { classifySimbadFlamsteed, type SimbadFlamsteed } from '../simbad/simbad-flamsteed-pure';
import { SIMBAD_IDENTS } from '../simbad/simbad-idents-source';
import {
  buildWgsnIndex,
  routeDisposedProper,
  type ProperDisposition,
  type WgsnNameRow,
} from './wgsn-index-pure';
import type { DesignationRow } from './wgsn-tables-pure';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';
import { PROPER_DISPOSITIONS } from './proper-dispositions-source';
import type { NamingFields, WalkedStar } from '../parse/stars-parse';
import { attach, type Records } from '../record/record-phase';

export interface StarNamingInputs {
  names: WgsnNameRow[];
  designations: DesignationRow[];
  dispositions: Map<string, ProperDisposition>;
  /** IV/27A's designation constellations, the tier below the authority's. */
  designationCons: DesignationConIndex;
  /** SIMBAD's Flamsteed numbers the rule accepts, the tier below IV/27A's. */
  simbadFlamsteed: SimbadFlamsteed;
}

export function loadStarNamingInputs(): StarNamingInputs {
  const crossIndex = CROSS_INDEX.read();
  return {
    names: readArtifact(WGSN_NAMES),
    designations: readArtifact(WGSN_DESIGNATIONS),
    dispositions: new Map(PROPER_DISPOSITIONS.read().map((d) => [d.proper, d.disposition])),
    designationCons: buildDesignationConIndex(crossIndex),
    simbadFlamsteed: classifySimbadFlamsteed(SIMBAD_IDENTS.read(), crossIndex),
  };
}

/** The walked fields the ladder reads. */
export type NamingSource = Pick<WalkedStar, 'flags' | 'printedName' | 'hip' | 'hd' | 'hr' | 'flam'>;

/** The authority pass's share of naming's count block. */
export interface StarNamingCounts {
  /** Records the IAU WGSN names, and how many of those the identifier join
   *  missed and the record's own printed spelling rescued. */
  namingIauNamed: number;
  namingIauNamedByProper: number;
  /** Approved names no record carries an identifier or spelling for —
   *  overwhelmingly the wgsnFaints hosts whose only key was a survey id
   *  the normaliser drops, naming stars the catalogue does not hold. */
  namingIauUnreached: number;
  /** Records carrying a string designation (`Ross 128`; /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them). */
  namingEponym: number;
  /** Records the authority gives a glyph-bearing Bayer designation. */
  namingBayer: number;
  /** Bayer designations the authority attributes to a named component. */
  namingBayerComponent: number;
  namingGould: number;
  /** Published spellings shipped as search-only aliases (`al`), and the
   *  records carrying them. */
  namingAliases: number;
  namingAliasRecords: number;
}

export function starNamingSummary(counts: StarNamingCounts): string {
  return `  ${counts.namingIauNamed} IAU names `
    + `(${counts.namingIauNamedByProper} via the record's own spelling, `
    + `${counts.namingIauUnreached} approved names unreached), `
    + `${counts.namingEponym} string designations\n`
    + `  ${counts.namingBayer} Bayer designations, `
    + `${counts.namingGould} Gould, `
    + `${counts.namingAliases} aliases on ${counts.namingAliasRecords} records`;
}

/** Attaches each walked record's `NamingFields`, its `desigCon` starting from IV/27A's tier. */
export function applyStarNames<S extends NamingSource>(
  stars: Records<'walked', S>,
  inputs: StarNamingInputs,
  constellations: readonly { code: string }[],
): { named: Records<'walked', S & NamingFields>; counts: StarNamingCounts } {
  const index = buildWgsnIndex(inputs.names, inputs.designations);
  const counts: StarNamingCounts = {
    namingIauNamed: 0,
    namingIauNamedByProper: 0,
    namingIauUnreached: 0,
    namingEponym: 0,
    namingBayer: 0,
    namingBayerComponent: 0,
    namingGould: 0,
    namingAliases: 0,
    namingAliasRecords: 0,
  };
  const reached = new Set<WgsnNameRow>();

  const named = attach(stars, (star): NamingFields => {
    const fields: NamingFields = {
      desigCon: designationConstellation(inputs.designationCons, inputs.simbadFlamsteed, star),
      iauName: null,
      eponym: null,
      bayer: null,
      bayerSup: null,
      bayerComponent: null,
      gould: null,
      gouldHalf: null,
      aliases: [],
    };
    const keys = {
      hip: star.hip, hd: star.hd, hr: star.hr, proper: star.printedName,
    };

    const name = index.nameOf(keys);
    if (name !== null) {
      fields.iauName = name.row.name;
      reached.add(name.row);
      counts.namingIauNamed++;
      if (name.viaProper) counts.namingIauNamedByProper++;
      // Published alternates the authority split out of a multi-name cell,
      // plus the spine's own spelling where the IAU superseded it.
      for (const alias of name.row.aliases) fields.aliases.push(alias);
      if (star.printedName !== null
          && foldNameKey(star.printedName) !== foldNameKey(name.row.name)) {
        fields.aliases.push(star.printedName);
      }
    } else if ((star.flags & FLAG_IS_SOL) !== 0) {
      // The one hand-emitted record: no catalogue names it, and it is exempt
      // from the naming-authority disposition gate (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them) rather than absent from it.
      fields.eponym = star.printedName;
    } else if (star.printedName !== null) {
      const routed = routeDisposedProper(
        star.printedName, inputs.dispositions.get(star.printedName),
      );
      fields.eponym = routed.eponym;
      if (routed.alias !== null) fields.aliases.push(routed.alias);
    }
    if (fields.eponym !== null) counts.namingEponym++;

    const bayer = index.bayerOf(keys);
    if (bayer !== null && bayer.letter !== null) {
      fields.bayer = bayer.letter;
      fields.bayerSup = bayer.sup;
      fields.bayerComponent = bayer.component;
      if (bayer.component !== null) counts.namingBayerComponent++;
      counts.namingBayer++;
      authorityDesignationConstellation(fields, star.flam, bayer.dc, 'wgsn-bayer', constellations);
    }

    const gould = index.gouldOf(keys);
    if (gould !== null && gould.num !== null) {
      fields.gould = gould.num;
      fields.gouldHalf = gould.half;
      counts.namingGould++;
      if (fields.bayer === null) {
        authorityDesignationConstellation(fields, star.flam, gould.dc, 'wgsn-gould', constellations);
      }
    }

    if (fields.aliases.length > 0) {
      counts.namingAliases += fields.aliases.length;
      counts.namingAliasRecords++;
    }
    return fields;
  });

  counts.namingIauUnreached = inputs.names.filter((r) => !reached.has(r)).length;
  return { named, counts };
}

/** The top tier of the cascade the label merge started
 *  (`../classic-ids/README.md#the-designation-constellation`). */
function authorityDesignationConstellation(
  fields: NamingFields,
  flam: number | null,
  dc: string,
  via: 'wgsn-bayer' | 'wgsn-gould',
  constellations: readonly { code: string }[],
): void {
  const idx = CON_INDEX.get(dc.toLowerCase());
  if (idx === undefined) return;
  const prior = fields.desigCon;
  const displaced = prior.via !== 'none' && prior.index !== idx ? prior.index : null;
  if (displaced !== null) {
    const code = constellations[displaced]?.code;
    if (flam !== null && code !== undefined) {
      fields.aliases.push(`${flam} ${code}`);
    }
  }
  fields.desigCon = { via, index: idx, displaced };
}
