// The ObjectKindModule contract and the KindContext dependency struct
// every kind module consumes. See ./README.md.

import type * as THREE from 'three';
import type { FocusableProvider, Target, TargetKind } from '../camera/focus/focus-target';
import type { ConstellationOfKind } from '../focus-card/constellation-row';
import type { FocusCardProvider } from '../focus-card/focus-card-types';
import type { HoverProvider } from '../hover/hover-types';
import type { SceneElementId } from '../scene/scene-elements';
import type { SceneLayer } from '../scene/scene-layer';
import type { StarSharedUniforms } from '../star-pipeline/frame/star-shared-uniforms';

/** What a kind module may depend on — the documented answer to "what may
 *  a layer reach?". Built once by the integration shell and handed to
 *  every module's `attach`. Accessors are closures so state that attaches
 *  or mutates later (focus, worldOffset) reads live. */
export interface KindContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The renderer canvas — pick paths read its bounding rect. */
  readonly canvas: HTMLElement;
  /** The shared view/screen uniform map (viewport, FOV, pixel ratio,
   *  magnitude bounds, HDR slots), held by reference. Modules narrow to
   *  the slots they consume. */
  readonly sharedUniforms: StarSharedUniforms;
  readonly solIndex: number;
  getT(): number;
  getWorldOffset(): Readonly<THREE.Vector3>;
  getFocusedTarget(): Target | null;
  getMonochrome(): boolean;
  detailPermits(id: SceneElementId): boolean;
  constellationOf(kind: ConstellationOfKind, idx: number): string | null;
  /** Subscribe to the per-frame tick (fires after the scene-layer update
   *  fan-out). Returns an unsubscribe. */
  onFrame(handler: () => void): () => void;
}

/** One kind's pick path. It IS `HoverProvider.pick` — the Picker
 *  dispatches click picks through the kind's hover provider so click
 *  and hover can never disagree on a hit. */
export type KindPick = HoverProvider['pick'];

/** One search-corpus row contributed by a kind; `index` is the kind's
 *  Target idx. The runner tags rows with the module's kind. */
export interface KindSearchEntry {
  readonly index: number;
  readonly label: string;
  readonly primary: string;
  readonly displayCon: string;
}

/** One object kind's full integration surface, exported from the kind's
 *  folder. The shell and boot iterate the roster instead of hand-wiring
 *  each capability site; hard/moving traits stay declared in
 *  `KIND_TRAITS` (the contract file must not import kind folders).
 *
 *  Lifecycle: `load` (boot, parallel; never rejects — a missing artifact
 *  loads to an empty roster) stores the artifact on the module, then
 *  `attach` (shell constructor, at the kind's roster position) builds the
 *  render layers and returns the scene-layer entry the shell registers
 *  there — update order is the shell's call, never the module's. Every
 *  other leg is valid only after `attach`. */
export interface ObjectKindModule<K extends TargetKind = TargetKind> {
  readonly kind: K;
  load(baseUrl: string): Promise<void>;
  attach(ctx: KindContext): SceneLayer | null;
  focusable(): FocusableProvider;
  card(): FocusCardProvider<K>;
  /** The kind's hover surface. Its `pick` doubles as the click-pick
   *  path the shell hands the Picker (`pickKindHit`) — one pick
   *  function per kind, never a second leg to keep in sync. */
  hover?(): HoverProvider;
  pinnable(idx: number): boolean;
  searchEntries(): readonly KindSearchEntry[];
  /** Display name for a Target of this kind; '' when unresolvable. */
  displayName(idx: number): string;
  /** SIDs in localIndex order (localIndex = Target idx), or null when
   *  the domain can never attach this session (resolver concludes it). */
  sids(): readonly number[] | null;
  /** SVG label overlay factory — separate from `attach` because label
   *  overlays mount into the DOM, which the shell constructor must not
   *  require (headless tests attach without one). The module keeps the
   *  overlay's teardown and runs it from its scene layer's `dispose`. */
  labels?(): void;
  /** Imperative declutter pushes for the kind's scene elements, keyed by
   *  element id; the shell's exhaustive bind record calls them. */
  detailBinds?(): Partial<Record<SceneElementId, (on: boolean) => void>>;
  /** The model clock jumped discontinuously (URL restore) — reseed any
   *  t-sampled state before the next frame reads it. */
  clockJumped?(t: number): void;
  /** Hide slot for the kind's focal body while observe parks the camera
   *  at it; -1 unhides. */
  setFocalHidden?(idx: number): void;
}
