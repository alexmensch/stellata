// A parallax carried only alongside the publication that sourced it — the
// shape both second-order pulls write and the distance cascade's skip rules
// read.

/** `bibcode` is the source; the catalogue that carried the value is only the
 *  index that found it. `errMas` is admitted separately because the cascade's
 *  precision floor reads it and neither index always publishes one. */
export interface CitedParallax {
  mas: number;
  errMas: number | null;
  bibcode: string;
}

/** The only constructor, so no consumer can reach a parallax it may not weigh:
 *  an uncited one is dropped whole rather than admitted under a null citation,
 *  which every bibcode predicate reads as "not Gaia". */
export function citedParallax(
  mas: number | null,
  errMas: number | null,
  bibcode: string | null,
): CitedParallax | null {
  return mas !== null && bibcode !== null ? { mas, errMas, bibcode } : null;
}
