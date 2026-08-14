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

/** Lowercase ASCII Greek abbreviations → glyph, covering both the SIMBAD
 *  convention NEC's `* kap01 Scl B` rows use and IV/27A's cells (`alf`,
 *  `ksi`, trailing-period `mu.` / `nu.` / `pi.` — strip the period before
 *  lookup). AT-HYG's capitalised forms (`Alp`) are
 *  src/client/typeahead/star-designations.ts BAYER_GREEK. */
export const ASCII_GREEK: Record<string, string> = {
  alf: 'α', alp: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε',
  zet: 'ζ', eta: 'η', tet: 'θ', the: 'θ', iot: 'ι', kap: 'κ',
  lam: 'λ', mu: 'μ', nu: 'ν', ksi: 'ξ', xi: 'ξ', omi: 'ο',
  pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ',
  chi: 'χ', khi: 'χ', psi: 'ψ', ome: 'ω', omega: 'ω',
};

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
