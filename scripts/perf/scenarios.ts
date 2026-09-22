// The canon vantages the runner measures at, the order a run visits them
// in, and the URL a scenario boots. README.md § What a run does.

/** One member, and kept as a list rather than collapsed away: it is the
 *  `backend` half of every row key and of the on-disk record, so dropping
 *  it would bump `PERF_SCHEMA` and abandon every archived baseline
 *  (`schema.ts`, on `PERF_SCHEMA`). */
export const BACKENDS = ['webgpu'] as const;
export type Backend = (typeof BACKENDS)[number];

/** Key order is the canon order `all` expands to, and it is load-bearing:
 *  a run's rows compare only at equal position, so the pin run has to
 *  visit the Tier 1 vantages first. `TIER1_SCENARIOS` below is the prefix. */
export const SCENARIOS = {
  mw120: { blob: 'BI3AgQEHrJQCP5TnAUFu649AB3JRp77d8BW_muE9P24C-v8TGQR-Fzig2kE', label: 'MW-plane 120°' },
  sol: { blob: 'BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB', label: 'Sol default view' },
  earth: { blob: 'BIXAgQEHPFWisPEAmy_pTIAvB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'Earth close approach' },
  mw50: { blob: 'BIXAgQEHPpUCPyboAUEQ7I9AB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'MW-plane 50°' },
  lg: { blob: 'BIXAgQEHntYpSaZnI0jhszBJB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'LG zoom-out' },
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as readonly ScenarioName[];

/** The Tier 1 run: `--scenario mw120,sol --backend webgpu`, in this order
 *  (`RELEASING.md` § Perf pin). */
export const TIER1_SCENARIOS = ['mw120', 'sol'] as const satisfies readonly ScenarioName[];

/**
 * `<base>/v/<blob>/` plus `--hash`'s own switches, which `parseRunArgs` has
 * already stripped of any leading `#`.
 */
export function scenarioUrl(base: string, blob: string, hash = ''): string {
  const root = base.replace(/\/+$/, '');
  return `${root}/v/${blob}/${hash === '' ? '' : `#${hash}`}`;
}
