// Detail-level declutter cycle: the exhaustive scene-element floor table
// and the pure floor→visibility derivation. See scene/README.md.

export type DetailLevel = 'physical' | 'representational' | 'all';
export type RenderStyle = 'realistic' | 'chart';

/** Floor a scene element must reach to be permitted, per render style, or
 *  'never' (the element is not part of that style at all). */
export type Floor = DetailLevel | 'never';

/** Ascending order — cumulative: physical ⊂ representational ⊂ all. The
 *  single source of the level ordering; DETAIL_RANK and the URL enum
 *  index both derive from it. */
export const DETAIL_LEVELS: readonly DetailLevel[] = ['physical', 'representational', 'all'];

export const DETAIL_RANK: Record<DetailLevel, number> = Object.fromEntries(
  DETAIL_LEVELS.map((level, i) => [level, i]),
) as Record<DetailLevel, number>;

/** Closed union of every renderable the detail cycle governs. Adding a
 *  renderable here forces a SCENE_ELEMENT_FLOORS row (tsc) and a bind in
 *  stellata.ts's SceneElementBinds Record (tsc) — the "a decision MUST be
 *  made" guard. User-owned chrome (HUD, coord sphere, cards) is NOT here
 *  — see USER_OWNED_IDS. */
export type SceneElementId =
  // Physical tier.
  | 'stars'
  | 'planetBodies'
  | 'milkyWayBand'
  | 'milkyWayIsobar'
  | 'lgEmissionGlow'
  // Representational tier.
  | 'galacticDiscWireframe'
  | 'lgWireframes'
  | 'orbitRings'
  | 'heliopauseShell'
  | 'constellationFigures'
  | 'molecularCloudEllipsoids'
  | 'dustParticles'
  // Labels tier.
  | 'planetLabels'
  | 'heliopauseLabel'
  | 'mwLabel'
  | 'lgObjectLabels'
  // Chart-only content (chart-labels.ts).
  | 'chartStarNameLabels'
  | 'chartBayerGlyphs'
  | 'chartVariableRings'
  | 'chartConstellationNames'
  | 'chartCloudNames';

export interface ElementFloors {
  readonly realistic: Floor;
  readonly chart: Floor;
}

/** EXHAUSTIVE over SceneElementId — a mapped-type Record, so omitting a
 *  member fails tsc (same contract shape as FocusableProviders). Adding a
 *  renderable without classifying it (a floor per style) does not compile.
 *  Don't weaken to a partial map. */
export const SCENE_ELEMENT_FLOORS: Record<SceneElementId, ElementFloors> = {
  stars:                     { realistic: 'physical',         chart: 'physical' },
  planetBodies:              { realistic: 'physical',         chart: 'physical' },
  milkyWayBand:              { realistic: 'physical',         chart: 'never' },
  milkyWayIsobar:            { realistic: 'never',            chart: 'physical' },
  lgEmissionGlow:            { realistic: 'physical',         chart: 'never' },
  galacticDiscWireframe:     { realistic: 'representational', chart: 'never' },
  lgWireframes:              { realistic: 'representational', chart: 'never' },
  orbitRings:                { realistic: 'representational', chart: 'never' },
  heliopauseShell:           { realistic: 'representational', chart: 'never' },
  constellationFigures:      { realistic: 'representational', chart: 'representational' },
  molecularCloudEllipsoids:  { realistic: 'representational', chart: 'representational' },
  dustParticles:             { realistic: 'representational', chart: 'never' },
  planetLabels:              { realistic: 'all',              chart: 'never' },
  heliopauseLabel:           { realistic: 'all',              chart: 'never' },
  mwLabel:                   { realistic: 'all',              chart: 'never' },
  lgObjectLabels:            { realistic: 'all',              chart: 'never' },
  chartStarNameLabels:       { realistic: 'never',            chart: 'physical' },
  chartBayerGlyphs:          { realistic: 'never',            chart: 'physical' },
  chartVariableRings:        { realistic: 'never',            chart: 'physical' },
  chartConstellationNames:   { realistic: 'never',            chart: 'all' },
  chartCloudNames:           { realistic: 'never',            chart: 'all' },
};

/** Iteration order for applyDetailPreset — the SceneElementId union as a
 *  runtime array. Pinned against SCENE_ELEMENT_FLOORS keys by the test so
 *  it can't silently drop a member. */
export const SCENE_ELEMENT_IDS = Object.keys(SCENE_ELEMENT_FLOORS) as SceneElementId[];

/** Per-element bind adapter: folds one of the scattered visibility idioms
 *  (warp-gate flag, setEnabled, event setVisible, per-frame permit read)
 *  into a single call site. Constructed exhaustively in stellata.ts. */
export type SceneElementBinds = Record<SceneElementId, (on: boolean) => void>;

/** Is `floor` reached at `level`? 'never' → false; otherwise cumulative. */
export function floorPermits(floor: Floor, level: DetailLevel): boolean {
  return floor !== 'never' && DETAIL_RANK[level] >= DETAIL_RANK[floor];
}

/** Floor-derived permission for one element (no overrides applied). */
export function elementPermitted(
  id: SceneElementId,
  level: DetailLevel,
  style: RenderStyle,
): boolean {
  return floorPermits(SCENE_ELEMENT_FLOORS[id][style], level);
}

/** The cumulative permitted set at (level, style) — floors only. */
export function visibleSet(level: DetailLevel, style: RenderStyle): Set<SceneElementId> {
  const out = new Set<SceneElementId>();
  for (const id of SCENE_ELEMENT_IDS) {
    if (elementPermitted(id, level, style)) out.add(id);
  }
  return out;
}

/** Don't-care chrome the detail cycle NEVER writes — HUD + navigation
 *  feedback + app overlays, each toggled by its own affordance (H, S, U,
 *  T). Its own closed union so the boundary is explicit and testable; the
 *  galactic coordinate sphere (lines + l/b labels, coupled) lives here —
 *  too many lines to sweep in the cycle. */
export type UserOwnedElementId =
  | 'hudArrows'
  | 'hudRing'
  | 'poiOverlay'
  | 'galacticCoordSphere'
  | 'focusRing'
  | 'distanceVector'
  | 'clickRipple'
  | 'scaleBar'
  | 'timeReadout'
  | 'focusCards'
  | 'hoverTooltip'
  | 'warpPill'
  | 'modePill';

export const USER_OWNED_IDS: readonly UserOwnedElementId[] = [
  'hudArrows', 'hudRing', 'poiOverlay', 'galacticCoordSphere', 'focusRing',
  'distanceVector', 'clickRipple', 'scaleBar', 'timeReadout', 'focusCards',
  'hoverTooltip', 'warpPill', 'modePill',
];
