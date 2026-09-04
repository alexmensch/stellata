// The canon vantages the runner measures at, and the URL a scenario boots.

export const BACKENDS = ['webgl2', 'webgpu'] as const;
export type Backend = (typeof BACKENDS)[number];

export const SCENARIOS = {
  sol: { blob: 'BIHAgAEH1E6tNQDBsTegUkQ3AmDleDmLoNpB', label: 'Sol default view' },
  earth: { blob: 'BIXAgQEHPFWisPEAmy_pTIAvB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'Earth close approach' },
  mw50: { blob: 'BIXAgQEHPpUCPyboAUEQ7I9AB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'MW-plane 50°' },
  mw120: { blob: 'BI3AgQEHrJQCP5TnAUFu649AB3JRp77d8BW_muE9P24C-v8TGQR-Fzig2kE', label: 'MW-plane 120°' },
  lg: { blob: 'BIXAgQEHntYpSaZnI0jhszBJB3JRp77d8BW_muE9PwL6_xMZBH4XOKDaQQ', label: 'LG zoom-out' },
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as readonly ScenarioName[];

export function scenarioUrl(base: string, blob: string, backend: Backend): string {
  const root = base.replace(/\/+$/, '');
  return `${root}/v/${blob}/${backend === 'webgpu' ? '#renderer=webgpu' : ''}`;
}
