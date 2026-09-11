// Draw-order slots held by more than one subsystem. The whole ladder is
// ../README.md § Full render stack — front to back.

/** The depth-only slot, ahead of every background layer so their fragments
 *  depth-fail inside whatever it stamped. Two writers: the star core mask
 *  (../star-pipeline/README.md) and the planet depth pre-stamp
 *  (../solar-system/planets/depth-stamp/README.md). */
export const DEPTH_MASK_RENDER_ORDER = -4;
