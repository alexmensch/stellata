// Build-time env vars exposed by Vite (see vite.config.ts).
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  /** Star count read from the built catalogue header, comma-grouped.
   *  Empty where the artifact is absent — consumers need a wording that
   *  survives that. */
  readonly VITE_STAR_COUNT: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Dev-console handles, set and cleared through util/page-teardown.ts.
interface DevConsoleGlobals {
  stellata: import('./stellata').Stellata;
  debug: import('./debug/debug').DebugTools;
}
interface Window extends Partial<DevConsoleGlobals> {}
