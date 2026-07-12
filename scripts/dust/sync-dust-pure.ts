// Allowlist predicate for data/dust/ → public/dust/ mirroring: only
// runtime-consumed artifacts may ship (docs/source files leak to the
// public bundle otherwise).

const ALLOWED_EXACT = new Set(['manifest.json', 'particles.bin']);
const CHUNK_PATTERN = /^chunk_\d+_\d+_\d+\.bin$/;

export function isDustPublicAsset(name: string): boolean {
  return ALLOWED_EXACT.has(name) || CHUNK_PATTERN.test(name);
}
