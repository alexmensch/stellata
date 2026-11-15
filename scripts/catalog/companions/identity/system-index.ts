// The system index promotion walks: pair cursors per system, and the records the catalogue already holds. See README.md#the-system-index.

import { isMoreCanonicalAnchor, wdsRootOf } from '../../../binaries/component-tokens-pure';
import type { Star } from '../../parse/stars-parse';
import type { MultiplesTsvRow } from '../companion-promotion';

export interface PairCursor {
  primary: MultiplesTsvRow | null;
  secondaries: MultiplesTsvRow[];
}

/** The WDS root's canonical primary, among those a record already holds. */
export interface SystemAnchor {
  star: Star;
  primaryRow: MultiplesTsvRow;
  catalogIdx: number;
}

const NAME_ANCHOR_MAX_POS_DELTA_PC = 0.1;

/** README.md#the-system-index. */
export class SystemIndex {
  readonly groups: ReadonlyMap<string, PairCursor>;
  private readonly byGaia = new Map<string, number>();
  private readonly byHip = new Map<number, number>();
  private readonly byProper = new Map<string, number>();
  private readonly rootAnchors = new Map<string, SystemAnchor>();
  private readonly singleLettersByRoot = new Map<string, Set<string>>();

  constructor(rows: readonly MultiplesTsvRow[], private readonly stars: readonly Star[]) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (s.gaiaSourceId && !this.byGaia.has(s.gaiaSourceId)) this.byGaia.set(s.gaiaSourceId, i);
      if (s.hip !== null && s.hip > 0 && !this.byHip.has(s.hip)) this.byHip.set(s.hip, i);
      if (s.proper && !this.byProper.has(s.proper)) this.byProper.set(s.proper, i);
    }
    const groups = new Map<string, PairCursor>();
    for (const r of rows) {
      let cursor = groups.get(r.systemId);
      if (!cursor) {
        cursor = { primary: null, secondaries: [] };
        groups.set(r.systemId, cursor);
      }
      if (r.orbitRole === 'primary') cursor.primary = r;
      else cursor.secondaries.push(r);
    }
    this.groups = groups;
    for (const [sysId, cursor] of groups) {
      const root = wdsRootOf(sysId);
      if (root === null) continue;
      let letters = this.singleLettersByRoot.get(root);
      if (!letters) this.singleLettersByRoot.set(root, (letters = new Set()));
      if (cursor.primary !== null && cursor.primary.comp.length === 1) letters.add(cursor.primary.comp);
      for (const sec of cursor.secondaries) if (sec.comp.length === 1) letters.add(sec.comp);
    }
    for (const cursor of groups.values()) {
      if (cursor.primary === null) continue;
      const root = wdsRootOf(cursor.primary.systemId);
      if (root === null) continue;
      const idx = this.findExistingPrimary(cursor.primary);
      if (idx === null) continue;
      const incumbent = this.rootAnchors.get(root);
      if (!incumbent || isMoreCanonicalAnchor(cursor.primary.comp, incumbent.primaryRow.comp)) {
        this.rootAnchors.set(root, { star: stars[idx], primaryRow: cursor.primary, catalogIdx: idx });
      }
    }
  }

  existingOnGaia(sourceId: string): number | undefined {
    return this.byGaia.get(sourceId);
  }

  existingOnHip(hip: number): number | undefined {
    return this.byHip.get(hip);
  }

  existingOnProper(name: string): number | undefined {
    return this.byProper.get(name);
  }

  findExisting(row: MultiplesTsvRow): number | null {
    if (row.gaiaSourceId) {
      const hit = this.byGaia.get(row.gaiaSourceId);
      if (hit !== undefined) return hit;
    }
    if (row.gaiaSourceId === null && row.hip !== null && row.hip > 0) {
      const hit = this.byHip.get(row.hip);
      if (hit !== undefined) return hit;
    }
    return null;
  }

  findExistingPrimary(row: MultiplesTsvRow): number | null {
    if (row.gaiaSourceId) {
      const hit = this.byGaia.get(row.gaiaSourceId);
      if (hit !== undefined) return hit;
    }
    if (row.hip !== null && row.hip > 0) {
      const hit = this.byHip.get(row.hip);
      if (hit !== undefined) return hit;
    }
    const name = row.name.trim();
    if (name && row.x_pc !== null && row.y_pc !== null && row.z_pc !== null) {
      const hit = this.byProper.get(name);
      if (hit !== undefined) {
        const s = this.stars[hit];
        if (Math.abs(s.x - row.x_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC
            && Math.abs(s.y - row.y_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC
            && Math.abs(s.z - row.z_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC) {
          return hit;
        }
      }
    }
    return null;
  }

  rootAnchor(root: string | null): SystemAnchor | undefined {
    return root === null ? undefined : this.rootAnchors.get(root);
  }

  isUnresolvedCompound(comp: string, root: string): boolean {
    if (comp.length < 2) return false;
    const singleLetters = this.singleLettersByRoot.get(root);
    if (!singleLetters) return false;
    for (let i = 0; i < comp.length; i++) {
      if (!singleLetters.has(comp[i])) return false;
    }
    return true;
  }
}
