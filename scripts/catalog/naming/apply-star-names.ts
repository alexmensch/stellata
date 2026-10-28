// The naming ladder's authority tiers over the record array: approved
// names, glyph-bearing designations, disposition routing, aliases.
// See README.md#the-record-side-join.

import { readArtifact } from '../../util/sources/source';
import { FLAG_IS_SOL, NO_CONSTELLATION_INDEX } from '../record/catalog-pure';
import { CON_INDEX } from '../parse/constellations/constellations';
import { foldNameKey } from './wgsn-normalise-pure';
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

export interface StarNamingInputs {
  names: WgsnNameRow[];
  designations: DesignationRow[];
  dispositions: Map<string, ProperDisposition>;
}

export function loadStarNamingInputs(): StarNamingInputs {
  return {
    names: readArtifact(WGSN_NAMES),
    designations: readArtifact(WGSN_DESIGNATIONS),
    dispositions: new Map(PROPER_DISPOSITIONS.read().map((d) => [d.proper, d.disposition])),
  };
}

/** Structural subset of `Star` the ladder reads and writes. */
export interface NamingTarget {
  flags: number;
  proper: string | null;
  iauName: string | null;
  eponym: string | null;
  bayer: string | null;
  bayerSup: number | null;
  bayerComponent: string | null;
  gould: number | null;
  gouldHalf: string | null;
  aliases: string[];
  hip: number | null;
  hd: number | null;
  hr: number | null;
  desigConIndex: number;
  flam: number | null;
}

export interface StarNamingCounts {
  /** Records the authority names, and how the name reached them. */
  namingIauNamed: number;
  namingIauNamedByProper: number;
  /** Approved names no record carries an identifier or spelling for. */
  namingIauUnreached: number;
  /** Records carrying a string designation (`Ross 128`; /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them). */
  namingEponym: number;
  /** Records the authority gives a glyph-bearing Bayer designation, and how
   *  many of them the spine printed no Bayer cell for at all. */
  namingBayer: number;
  namingBayerAdded: number;
  /** Bayer designations the authority attributes to a named component. */
  namingBayerComponent: number;
  /** Spine Bayer cells the authority does not reach — the designation
   *  belongs to a sibling record, so the record drops it and borrows the
   *  system's instead. */
  namingBayerDropped: number;
  namingGould: number;
  /** Published spellings shipped as search-only aliases. */
  namingAliases: number;
  namingAliasRecords: number;
  /** Designation constellations the authority states, and how many of those
   *  contradict the IV/27A cascade the label merge had already set. */
  namingDesigConFromWgsn: number;
  namingDesigConWgsnConflict: number;
}

export function applyStarNames(
  stars: NamingTarget[],
  inputs: StarNamingInputs,
  constellations: readonly { code: string }[],
): StarNamingCounts {
  const index = buildWgsnIndex(inputs.names, inputs.designations);
  const counts: StarNamingCounts = {
    namingIauNamed: 0,
    namingIauNamedByProper: 0,
    namingIauUnreached: 0,
    namingEponym: 0,
    namingBayer: 0,
    namingBayerAdded: 0,
    namingBayerComponent: 0,
    namingBayerDropped: 0,
    namingGould: 0,
    namingAliases: 0,
    namingAliasRecords: 0,
    namingDesigConFromWgsn: 0,
    namingDesigConWgsnConflict: 0,
  };
  const named = new Set<WgsnNameRow>();

  for (const star of stars) {
    const keys = {
      hip: star.hip, hd: star.hd, hr: star.hr, proper: star.proper,
    };
    const spineBayer = star.bayer;
    star.bayer = null;
    star.bayerSup = null;
    star.bayerComponent = null;

    const name = index.nameOf(keys);
    if (name !== null) {
      star.iauName = name.row.name;
      named.add(name.row);
      counts.namingIauNamed++;
      if (name.viaProper) counts.namingIauNamedByProper++;
      // Published alternates the authority split out of a multi-name cell,
      // plus the spine's own spelling where the IAU superseded it.
      for (const alias of name.row.aliases) star.aliases.push(alias);
      if (star.proper !== null
          && foldNameKey(star.proper) !== foldNameKey(name.row.name)) {
        star.aliases.push(star.proper);
      }
    } else if ((star.flags & FLAG_IS_SOL) !== 0) {
      // The one hand-emitted record: no catalogue names it, and it is exempt
      // from the naming-authority disposition gate (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them) rather than absent from it.
      star.eponym = star.proper;
    } else if (star.proper !== null) {
      const routed = routeDisposedProper(
        star.proper, inputs.dispositions.get(star.proper),
      );
      star.eponym = routed.eponym;
      if (routed.alias !== null) star.aliases.push(routed.alias);
    }
    if (star.eponym !== null) counts.namingEponym++;

    const bayer = index.bayerOf(keys);
    if (bayer !== null && bayer.letter !== null) {
      star.bayer = bayer.letter;
      star.bayerSup = bayer.sup;
      star.bayerComponent = bayer.component;
      if (bayer.component !== null) counts.namingBayerComponent++;
      counts.namingBayer++;
      if (spineBayer === null) counts.namingBayerAdded++;
      applyDesignationConstellation(star, bayer.dc, constellations, counts);
    } else if (spineBayer !== null) {
      counts.namingBayerDropped++;
    }

    const gould = index.gouldOf(keys);
    if (gould !== null && gould.num !== null) {
      star.gould = gould.num;
      star.gouldHalf = gould.half;
      counts.namingGould++;
      if (star.bayer === null) {
        applyDesignationConstellation(star, gould.dc, constellations, counts);
      }
    }

    if (star.aliases.length > 0) {
      counts.namingAliases += star.aliases.length;
      counts.namingAliasRecords++;
    }
  }

  counts.namingIauUnreached = inputs.names.filter((r) => !named.has(r)).length;
  return counts;
}

/** The top tier of the cascade the label merge started
 *  (`../classic-ids/README.md#the-designation-constellation`). */
function applyDesignationConstellation(
  star: NamingTarget,
  dc: string,
  constellations: readonly { code: string }[],
  counts: StarNamingCounts,
): void {
  const idx = CON_INDEX.get(dc.toLowerCase());
  if (idx === undefined) return;
  if (star.desigConIndex !== NO_CONSTELLATION_INDEX && star.desigConIndex !== idx) {
    counts.namingDesigConWgsnConflict++;
    const displaced = constellations[star.desigConIndex]?.code;
    if (star.flam !== null && displaced !== undefined) {
      star.aliases.push(`${star.flam} ${displaced}`);
    }
  }
  star.desigConIndex = idx;
  counts.namingDesigConFromWgsn++;
}
