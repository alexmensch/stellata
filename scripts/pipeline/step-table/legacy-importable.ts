// Modules outside the boundary trees an outputs module may still import at table load. See README.md#load-time-rules.

// Never add to it: a new module an outputs module imports lives in src/catalog-format/ or src/astro-core/.
export const LEGACY_IMPORTABLE: ReadonlySet<string> = new Set([]);
