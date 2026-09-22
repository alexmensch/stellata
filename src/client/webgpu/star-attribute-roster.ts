// Which per-star fields the shaders read, and how each reaches them:
// interleaved into the static table, or mirrored live off the shell's
// array. Both are Record-typed at their consumer in star/star-tables.ts.

/** Written once at catalogue load. Interleaved into one float storage
 *  table indexed by star (star/star-tables-pure.ts); `iPulsRho` and
 *  `iPulsColorSwing` are the two components of one catalogue pair. */
export const STAR_STATIC_FIELDS = [
  'iAbsmag', 'iCi', 'iSpectClass', 'iLogRadius', 'iPeriodDays',
  'iAmplitudeMag', 'iLumClass', 'iDistSol', 'iTeffApsis',
  'iPulsRho', 'iPulsColorSwing',
] as const;

export type StarStaticField = (typeof STAR_STATIC_FIELDS)[number];

/** Rewritten after load by the shell, the binary walk and the eclipse
 *  field. Each is a float storage attribute over the SAME array the
 *  source attribute wraps, its version and update ranges forwarded per
 *  frame (star/star-tables.ts). */
export const STAR_FORWARDED_ATTRIBUTES = [
  'iPosition', 'iCompositeSuppress', 'iEclipseDim', 'iSuppressPulsation',
] as const;

export type StarForwardedAttribute = (typeof STAR_FORWARDED_ATTRIBUTES)[number];
