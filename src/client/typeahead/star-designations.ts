// Pure star-designation formatters: Bayer display/split, GCVS padding,
// and the tier-ordered designation list. Leaf module — no imports from
// search.ts, so kind-module code can consume it without a cycle.

import {
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';

// Canonical Greek letter forms keyed by AT-HYG's 3-letter Latin abbreviation.
export const BAYER_FULL: Record<string, string> = {
  Alp: 'Alpha', Bet: 'Beta', Gam: 'Gamma', Del: 'Delta', Eps: 'Epsilon',
  Zet: 'Zeta', Eta: 'Eta', The: 'Theta', Iot: 'Iota', Kap: 'Kappa',
  Lam: 'Lambda', Mu: 'Mu', Nu: 'Nu', Xi: 'Xi', Omi: 'Omicron',
  Pi: 'Pi', Rho: 'Rho', Sig: 'Sigma', Tau: 'Tau', Ups: 'Upsilon',
  Phi: 'Phi', Chi: 'Chi', Psi: 'Psi', Ome: 'Omega',
};
export const BAYER_GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε',
  Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ',
  Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο',
  Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ',
  Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

// Returns { letter3, suffix } for a Bayer string like "Alp" or "Alp-2".
// Unknown letter returns null.
export function splitBayer(bayer: string): { letter3: string; suffix: string } | null {
  const m = bayer.match(/^([A-Za-z]+)(?:-(\d))?$/);
  if (!m) return null;
  const letter3 = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  if (!(letter3 in BAYER_FULL)) return null;
  return { letter3, suffix: m[2] ? `-${m[2]}` : '' };
}

// Human-facing Bayer display string, e.g. "α¹ Cen".
export function formatBayerDisplay(bayer: string, conCode: string): string {
  const split = splitBayer(bayer);
  if (!split) return `${bayer} ${conCode}`;
  const greek = BAYER_GREEK[split.letter3];
  const sup = split.suffix ? superscript(split.suffix.slice(1)) : '';
  return `${greek}${sup} ${conCode}`;
}

export function superscript(digit: string): string {
  const map: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return digit.split('').map((d) => map[d] ?? d).join('');
}

// GCVS stores V-number designations zero-padded to four digits
// ("V0645 Cen"); common usage drops the padding ("V645 Cen"), which is
// also what users type. Letter-sequence names (R CrB, VY CMa, RR Lyr)
// carry no numeric run and pass through unchanged.
export function formatGcvsDesignation(raw: string): string {
  return raw.replace(/^V0*(\d)/, 'V$1');
}

// Every display designation for one star, tier-ordered: proper → Bayer →
// Flamsteed → GCVS → HR → HD → HIP → Gliese → Gaia DR3. The focus card's
// identity line renders this set (minus the display label, which already
// heads the card). Gaia rides in from the catalog because search-index
// entries don't carry the source_id. A GCVS designation in Bayer form
// ("bet Per" for Algol) is skipped — the real Bayer display ("β Per")
// already covers it, and the Latinised abbreviation is a search alias,
// not a display name.
export function starDesignations(
  entry: SearchEntry,
  constellations: { code: string }[],
  gaiaSourceId: bigint,
): string[] {
  const conIdx = designationConIndex(entry.dc, entry.c);
  const conCode = conIdx !== NO_CONSTELLATION_INDEX
    ? constellations[conIdx]?.code ?? '' : '';
  const out: string[] = [];
  if (entry.p) out.push(entry.p);
  if (entry.b && conCode) out.push(formatBayerDisplay(entry.b, conCode));
  if (entry.f !== undefined && conCode) out.push(`${entry.f} ${conCode}`);
  const gcvsFirst = entry.g?.split(/\s+/)[0] ?? '';
  // Lowercase-start guard: GCVS letter-sequence designations (R, VY, MU)
  // are uppercase; only the lowercase Greek forms are Bayer duplicates.
  if (entry.g && !(/^[a-z]/.test(gcvsFirst) && splitBayer(gcvsFirst))) {
    out.push(formatGcvsDesignation(entry.g));
  }
  // An alias rides the record only where the pair is unresolved, so this ONE
  // record is what both catalogue numbers reach — listing both is what makes
  // that legible, rather than a card denying a number the search box just
  // accepted (scripts/catalog/classic-ids/README.md § An alias stops at the
  // blend). Sorted, so the line does not depend on overlay cell order.
  if (entry.hr !== undefined) {
    for (const hr of [entry.hr, ...(entry.hra ?? [])].sort((a, b) => a - b)) {
      out.push(`HR ${hr}`);
    }
  }
  if (entry.hd !== undefined) {
    for (const hd of [entry.hd, ...(entry.hda ?? [])].sort((a, b) => a - b)) {
      out.push(`HD ${hd}`);
    }
  }
  if (entry.hip !== undefined) out.push(`HIP ${entry.hip}`);
  if (entry.gl) out.push(entry.gl);
  if (gaiaSourceId !== 0n) out.push(`Gaia DR3 ${gaiaSourceId}`);
  return out;
}
