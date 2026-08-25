// Which star-geometry attributes the port packs, and which it cannot.
// Pinned against the live WebGL geometry by star-attribute-roster.test.ts;
// the accounting is tsl/README.md § Attribute packing.

/** WebGPU's guaranteed `maxVertexBuffers`, and three binds one vertex
 *  buffer per BufferAttribute. */
export const MAX_VERTEX_BUFFERS = 8;

/** Written once at catalog load — safe to interleave with each other. */
export const STAR_STATIC_SCALARS = [
  'iAbsmag', 'iCi', 'iSpectClass', 'iLogRadius', 'iPeriodDays',
  'iAmplitudeMag', 'iLumClass', 'iDistSol', 'iTeffApsis',
] as const;

/** Rewritten per frame by the binary / eclipse fields. Packed into their
 *  own buffer: a vec4 uploads whole, so a dynamic scalar sharing one with
 *  static neighbours makes every dim update a 4×-wide re-upload. */
export const STAR_DYNAMIC_SCALARS = [
  'iCompositeSuppress', 'iEclipseDim', 'iSuppressPulsation',
] as const;

/** Multi-component attributes: the planner slots one component per name,
 *  so these stay exactly as the WebGL geometry has them. */
export const STAR_UNPACKED_ATTRIBUTES = ['aCorner', 'iPosition', 'iPuls'] as const;

export const STAR_PACK_PREFIX_STATIC = 'iPack';
export const STAR_PACK_PREFIX_DYNAMIC = 'iDyn';
