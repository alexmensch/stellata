// Canonical Unicode Greek forms for Bayer designations, the ASCII
// conventions that normalise into them, and the genitive → IAU-code map.
// The glyph IS the canonical letter (docs/star-naming.md § 4).

export const GREEK_GLYPHS = new Set([
  'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ',
  'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω',
]);

/** Typographic variants folded to the canonical glyph. NEC ships ϕ (41
 *  rows) and ϵ (74); the rest are defensive siblings of the same fold. */
export const CURLY_GREEK_FOLDS: Record<string, string> = {
  'ϕ': 'φ', 'ϵ': 'ε', 'ϑ': 'θ', 'ϱ': 'ρ', 'ϰ': 'κ', 'ς': 'σ',
};

export function foldCurlyGreek(s: string): string {
  return s.replace(/[ϕϵϑϱϰς]/g, (ch) => CURLY_GREEK_FOLDS[ch]);
}

/** Every published spelling of each Greek Bayer letter, keyed by the glyph
 *  the wire carries. `abbr` is the three-letter form AT-HYG prints and
 *  SIMBAD/IV/27A lowercase (`Alp` / `alp`); `variants` are the further
 *  lowercase ASCII conventions the same letter appears under. The build's
 *  normalisers read the lowercased set (`ASCII_GREEK`), the runtime's search
 *  labels title-case it — one table, so a spelling added for either side
 *  reaches both. */
export const GREEK_SPELLINGS: Record<string, {
  full: string;
  abbr: string;
  variants: readonly string[];
}> = {
  'α': { full: 'Alpha', abbr: 'Alp', variants: ['alf'] },
  'β': { full: 'Beta', abbr: 'Bet', variants: [] },
  'γ': { full: 'Gamma', abbr: 'Gam', variants: [] },
  'δ': { full: 'Delta', abbr: 'Del', variants: [] },
  'ε': { full: 'Epsilon', abbr: 'Eps', variants: [] },
  'ζ': { full: 'Zeta', abbr: 'Zet', variants: [] },
  'η': { full: 'Eta', abbr: 'Eta', variants: [] },
  'θ': { full: 'Theta', abbr: 'The', variants: ['tet'] },
  'ι': { full: 'Iota', abbr: 'Iot', variants: [] },
  'κ': { full: 'Kappa', abbr: 'Kap', variants: [] },
  'λ': { full: 'Lambda', abbr: 'Lam', variants: [] },
  'μ': { full: 'Mu', abbr: 'Mu', variants: [] },
  'ν': { full: 'Nu', abbr: 'Nu', variants: [] },
  'ξ': { full: 'Xi', abbr: 'Xi', variants: ['ksi'] },
  'ο': { full: 'Omicron', abbr: 'Omi', variants: [] },
  'π': { full: 'Pi', abbr: 'Pi', variants: [] },
  'ρ': { full: 'Rho', abbr: 'Rho', variants: [] },
  'σ': { full: 'Sigma', abbr: 'Sig', variants: [] },
  'τ': { full: 'Tau', abbr: 'Tau', variants: [] },
  'υ': { full: 'Upsilon', abbr: 'Ups', variants: [] },
  'φ': { full: 'Phi', abbr: 'Phi', variants: [] },
  'χ': { full: 'Chi', abbr: 'Chi', variants: ['khi'] },
  'ψ': { full: 'Psi', abbr: 'Psi', variants: [] },
  'ω': { full: 'Omega', abbr: 'Ome', variants: ['omega'] },
};

/** Lowercase ASCII Greek abbreviations → glyph, covering both the SIMBAD
 *  convention NEC's `* kap01 Scl B` rows use and IV/27A's cells (`alf`,
 *  `ksi`, trailing-period `mu.` / `nu.` / `pi.` — strip the period before
 *  lookup). */
export const ASCII_GREEK: Record<string, string> = Object.fromEntries(
  Object.entries(GREEK_SPELLINGS).flatMap(([glyph, s]) =>
    [s.abbr.toLowerCase(), ...s.variants].map((k) => [k, glyph])),
);

/** Constellation genitive → IAU 3-letter code, the 88 IAU constellations.
 *  Multi-word genitives are single map keys — match longest-first. */
export const CONSTELLATION_GENITIVES: Record<string, string> = {
  'Andromedae': 'And', 'Antliae': 'Ant', 'Apodis': 'Aps', 'Aquarii': 'Aqr',
  'Aquilae': 'Aql', 'Arae': 'Ara', 'Arietis': 'Ari', 'Aurigae': 'Aur',
  'Boötis': 'Boo', 'Bootis': 'Boo', 'Caeli': 'Cae', 'Camelopardalis': 'Cam',
  'Cancri': 'Cnc', 'Canum Venaticorum': 'CVn', 'Canis Majoris': 'CMa',
  'Canis Minoris': 'CMi', 'Capricorni': 'Cap', 'Carinae': 'Car',
  'Cassiopeiae': 'Cas', 'Centauri': 'Cen', 'Cephei': 'Cep', 'Ceti': 'Cet',
  'Chamaeleontis': 'Cha', 'Circini': 'Cir', 'Columbae': 'Col',
  'Comae Berenices': 'Com', 'Coronae Australis': 'CrA',
  'Coronae Borealis': 'CrB', 'Corvi': 'Crv', 'Crateris': 'Crt',
  'Crucis': 'Cru', 'Cygni': 'Cyg', 'Delphini': 'Del', 'Doradus': 'Dor',
  'Draconis': 'Dra', 'Equulei': 'Equ', 'Eridani': 'Eri', 'Fornacis': 'For',
  'Geminorum': 'Gem', 'Gruis': 'Gru', 'Herculis': 'Her', 'Horologii': 'Hor',
  'Hydrae': 'Hya', 'Hydri': 'Hyi', 'Indi': 'Ind', 'Lacertae': 'Lac',
  'Leonis': 'Leo', 'Leonis Minoris': 'LMi', 'Leporis': 'Lep',
  'Librae': 'Lib', 'Lupi': 'Lup', 'Lyncis': 'Lyn', 'Lyrae': 'Lyr',
  'Mensae': 'Men', 'Microscopii': 'Mic', 'Monocerotis': 'Mon',
  'Muscae': 'Mus', 'Normae': 'Nor', 'Octantis': 'Oct', 'Ophiuchi': 'Oph',
  'Orionis': 'Ori', 'Pavonis': 'Pav', 'Pegasi': 'Peg', 'Persei': 'Per',
  'Phoenicis': 'Phe', 'Pictoris': 'Pic', 'Piscium': 'Psc',
  'Piscis Austrini': 'PsA', 'Puppis': 'Pup', 'Pyxidis': 'Pyx',
  'Reticuli': 'Ret', 'Sagittae': 'Sge', 'Sagittarii': 'Sgr',
  'Scorpii': 'Sco', 'Sculptoris': 'Scl', 'Scuti': 'Sct',
  'Serpentis': 'Ser', 'Sextantis': 'Sex', 'Tauri': 'Tau',
  'Telescopii': 'Tel', 'Trianguli': 'Tri', 'Trianguli Australis': 'TrA',
  'Tucanae': 'Tuc', 'Ursae Majoris': 'UMa', 'Ursae Minoris': 'UMi',
  'Velorum': 'Vel', 'Virginis': 'Vir', 'Volantis': 'Vol',
  'Vulpeculae': 'Vul',
};
