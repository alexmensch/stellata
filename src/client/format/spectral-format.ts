// Runtime spectral-type display formatting — primary-component label
// cleanup + plain-language descriptor. See ./README.md.

export interface SpectralDisplay {
  /** Cleaned classification label, e.g. "K0 III". Empty when the source
   *  catalog carried no spectral string. */
  label: string;
  /** Plain-language descriptor, e.g. "orange giant". Empty when the
   *  shipped class bytes don't support one. */
  descriptor: string;
}

// spectClass byte → colour word (indices per spectral-classify
// spectClassIndex:
// O B A F G K M). Index 7 (carbon / S / Wolf-Rayet bucket) and 8 (unknown)
// are handled as special cases in descriptorFor.
const COLOUR_BY_CLASS = [
  'blue',
  'blue-white',
  'white',
  'yellow-white',
  'yellow',
  'orange',
  'red',
] as const;

// luminosityClass byte → descriptor noun (encoding per catalog-pure:
// 0 = VII/WD handled separately, 6–8 = Ib/Iab/Ia all read "supergiant").
const DESCRIPTOR_BY_LUM: ReadonlyMap<number, string> = new Map([
  [1, 'subdwarf'],
  [2, 'main-sequence star'],
  [3, 'subgiant'],
  [4, 'giant'],
  [5, 'bright giant'],
  [6, 'supergiant'],
  [7, 'supergiant'],
  [8, 'supergiant'],
  [9, 'hypergiant'],
]);

// Inserts the display space between a temperature-class token ("K0",
// "M1.5", "G8ve") and a trailing Roman-numeral luminosity token. Longer
// alternatives first so "III" never matches as "II" + "I". Strings that
// don't match (white dwarfs "DA2", Am notation "kA3hA6mA7", Wolf-Rayets
// "WN5") pass through unchanged.
const LUM_SPACING_RE =
  /^([OBAFGKM]\d(?:\.\d+)?[a-z]*)\s*(Iab|Ia\+|Ia|Ib|IV|III|II|I|VII|VI|V)/;

/**
 * Display form of a raw catalog spectral string plus the shipped numeric
 * class bytes. The label keeps only the PRIMARY component of a composite
 * ("K0III+K7V" → "K0 III") so a companion's class never leaks onto the
 * primary's card; the descriptor is composed entirely from the numeric
 * spectClass / luminosityClass bytes, so it stays valid even when the raw
 * string is absent or unparseable. `estimated` marks class bytes that
 * were derived from brightness rather than a spectral observation
 * (synthetic promoted companions) — the descriptor gains "(estimated)".
 */
export function formatSpectral(
  rawDisplay: string | undefined,
  spectClass: number,
  luminosityClass: number,
  estimated = false,
): SpectralDisplay {
  const primary = rawDisplay ? rawDisplay.split(/[+/]/)[0].trim() : '';
  const label = primary.replace(LUM_SPACING_RE, '$1 $2');
  const descriptor = descriptorFor(primary, spectClass, luminosityClass);
  return {
    label,
    descriptor: descriptor && estimated ? `${descriptor} (estimated)` : descriptor,
  };
}

function descriptorFor(
  raw: string,
  spectClass: number,
  luminosityClass: number,
): string {
  if (luminosityClass === 0) return 'white dwarf';
  if (spectClass === 7) {
    return raw.startsWith('W') ? 'Wolf-Rayet star' : 'carbon star';
  }
  const noun = DESCRIPTOR_BY_LUM.get(luminosityClass);
  if (!noun) return '';
  const colour = COLOUR_BY_CLASS[spectClass];
  return colour ? `${colour} ${noun}` : noun;
}

/** "K0 III · orange giant" — the label + descriptor joined for a card
 *  line, dropping whichever half is empty. Empty when both are. */
export function spectralLine(display: SpectralDisplay): string {
  return [display.label, display.descriptor].filter(Boolean).join(' · ');
}
