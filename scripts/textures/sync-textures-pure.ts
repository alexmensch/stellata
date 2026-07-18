// Allowlist predicate for data/textures/ → public/textures/ mirroring:
// only the built runtime artifacts may ship — README.md and the src/
// originals stay out of the public bundle.

const BODY_PATTERN = /^[a-z-]+\.jpg$/;
const ALLOWED_EXACT = new Set(['saturn-rings.png']);

export function isTexturePublicAsset(name: string): boolean {
  return ALLOWED_EXACT.has(name) || BODY_PATTERN.test(name);
}
