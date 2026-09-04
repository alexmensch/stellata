// The naming ladder's authority tiers over the record array: approved
// names, glyph-bearing designations, disposition routing, aliases.
// See README.md § The record-side join.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../../util/paths';
import { FLAG_IS_SOL, NO_CONSTELLATION_INDEX } from '../catalog-pure';
import { CON_INDEX } from '../parse/constellations';
import { foldNameKey } from './wgsn-normalise-pure';
import {
  buildWgsnIndex,
  parseProperDispositionsTsv,
  parseWgsnDesignationsTsv,
  parseWgsnNamesTsv,
  routeDisposedProper,
  type ProperDisposition,
  type WgsnDesignationRow,
  type WgsnNameRow,
} from './wgsn-index-pure';

const DATA = resolve(REPO_ROOT, 'data/iau-wgsn');
const OVERRIDES = resolve(REPO_ROOT, 'data/naming/name_overrides.tsv');

export interface StarNamingInputs {
  names: WgsnNameRow[];
  designations: WgsnDesignationRow[];
  dispositions: Map<string, ProperDisposition>;
}

export function loadStarNamingInputs(): StarNamingInputs {
  return {
    names: parseWgsnNamesTsv(readFileSync(resolve(DATA, 'wgsn_names.tsv'), 'utf8')),
    designations: parseWgsnDesignationsTsv(
      readFileSync(resolve(DATA, 'wgsn_designations.tsv'), 'utf8'),
    ),
    dispositions: parseProperDispositionsTsv(
      readFileSync(resolve(DATA, 'athyg_proper_dispositions.tsv'), 'utf8'),
    ),
  };
}

/** The curated escape hatch, keyed on SID because that identity survives
 *  re-indexing and a no-Gaia record has no source_id (docs/star-naming.md
 *  § 7). Expected to stay empty: it exists for review findings the
 *  authority cannot express, never as a home for the folk names § 2 routes
 *  to aliases. */
export function loadNameOverrides(): Map<number, string> {
  const out = new Map<number, string>();
  const lines = readFileSync(OVERRIDES, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const sidIdx = header.indexOf('sid');
  const nameIdx = header.indexOf('display_name');
  if (sidIdx < 0 || nameIdx < 0) {
    throw new Error('data/naming/name_overrides.tsv needs sid + display_name columns');
  }
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const cells = line.split('\t');
    const sid = Number(cells[sidIdx]);
    const name = (cells[nameIdx] ?? '').trim();
    if (!Number.isInteger(sid) || sid <= 0 || name === '') {
      throw new Error(`data/naming/name_overrides.tsv: unusable row "${line}"`);
    }
    out.set(sid, name);
  }
  return out;
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
  /** Records carrying a § 2 string designation (`Ross 128`). */
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
      // from the § 2 disposition gate rather than absent from it.
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

/** The authority states which constellation its own designation is named
 *  for, so it is the top tier of the cascade the label merge started
 *  (`../classic-ids/README.md` § The designation constellation). One
 *  `uint8` serves one designation, and the tier that COMPOSES the label
 *  owns it — so where the authority's Bayer names a different constellation
 *  from the record's Flamsteed number (16 Lyn is also ψ¹⁰ Aur), the
 *  displaced Flamsteed form ships as an alias rather than going
 *  unsearchable. */
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
