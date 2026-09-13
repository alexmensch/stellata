// Which WebGL star-geometry attributes feed the port, and how each reaches
// the shaders: interleaved once into the static table, or mirrored live.
// Pinned against the WebGL geometry by star-attribute-roster.test.ts.

/** Written once at catalogue load. Interleaved into one float storage
 *  table indexed by star (star/star-tables-pure.ts); the two pulsation
 *  components are the WebGL `iPuls` vec2 split into scalars. */
export const STAR_STATIC_FIELDS = [
  'iAbsmag', 'iCi', 'iSpectClass', 'iLogRadius', 'iPeriodDays',
  'iAmplitudeMag', 'iLumClass', 'iDistSol', 'iTeffApsis',
  'iPulsRho', 'iPulsColorSwing',
] as const;

export type StarStaticField = (typeof STAR_STATIC_FIELDS)[number];

/** Rewritten after load by the shell, the binary walk and the eclipse
 *  field. Each is a float storage attribute over the SAME array the WebGL
 *  attribute wraps, its version and update ranges forwarded per frame
 *  (star/star-tables.ts). */
export const STAR_FORWARDED_ATTRIBUTES = [
  'iPosition', 'iCompositeSuppress', 'iEclipseDim', 'iSuppressPulsation',
] as const;

export type StarForwardedAttribute = (typeof STAR_FORWARDED_ATTRIBUTES)[number];

/** The one per-vertex attribute. Everything per-instance is a storage
 *  table, since the instance index no longer names the star. */
export const STAR_VERTEX_ATTRIBUTES = ['aCorner'] as const;
