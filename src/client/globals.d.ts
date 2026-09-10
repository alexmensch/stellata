// Build-time env vars exposed by Vite (see vite.config.ts).
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  /** Catalogue records, comma-grouped — the built artifact's own header, or
   *  the build's committed count snapshot where the artifact is absent.
   *  `scripts/site/site-metrics.ts`. */
  readonly VITE_STAR_COUNT: string;
  /** Sources credited in the application's own Credits tab. */
  readonly VITE_SOURCE_COUNT: string;
  /** Distinct multi-author citations across the modelling record — a floor
   *  on it, never a measure. */
  readonly VITE_REFERENCE_COUNT: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Dev-console handle for ad-hoc tweaks (see main.ts). Declared here so
// the assignment doesn't need an `as unknown` cast at the call site.
interface Window {
  stellata: import('./stellata').Stellata;
}
