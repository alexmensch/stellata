// Allowlist predicate for data/textures/ → public/textures/ mirroring:
// only the built runtime artifacts may ship — README.md and the src/
// originals stay out of the public bundle.

// Every colour map carries its rung width; a body ships one file per rung
// it can fill (`data/textures/README.md` § Size ladder). The width is
// required rather than optional so a stale pre-ladder `<body>.jpg` left in
// the tree cannot ship as a file the renderer never asks for.
const BODY_PATTERN = /^[a-z]+-\d+\.jpg$/;
const RELIEF_PATTERN = /^[a-z-]+-(normal|horizon-[ab]|skyview)\.webp$/;
const ALLOWED_EXACT = new Set([
  'saturn-rings.png',
  'uranus-rings.png',
  'neptune-rings.png',
]);

export function isTexturePublicAsset(name: string): boolean {
  return (
    ALLOWED_EXACT.has(name) || BODY_PATTERN.test(name) || RELIEF_PATTERN.test(name)
  );
}
