// The parallax-with-error shape every source and the distance cascade share,
// and the cited form both second-order pulls write and the skip rules read.

/** `errMas` is admitted separately because the cascade's precision floor reads
 *  it and not every source publishes one. */
export interface MeasuredParallax {
  mas: number;
  errMas: number | null;
}

/** `bibcode` is the source; the catalogue that carried the value is only the
 *  index that found it. */
export interface CitedParallax extends MeasuredParallax {
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
