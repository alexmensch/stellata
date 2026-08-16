// Owns every write to the scene's exposure scalar and the three magnitude
// bounds derived from it. See README.md § One writer, five slots.

import {
  type InstrumentName,
  instrumentLimitMag,
} from '../../filters/filter-state';
import {
  cullMagFor,
  drawCutoffMag,
  EV_MAX_STOPS,
  sceneExposure,
  summationSolidAngleFor,
  thresholdMagFor,
} from './exposure-epoch';

/** The five slots this controller writes, held by reference. `uExposure`
 *  and `uOmegaSummationArcsec2` arrive from
 *  `HdrPipeline.emitterUniforms`; the three magnitude bounds from the star
 *  pipeline's shared map. */
export interface ExposureUniforms {
  uExposure: { value: number };
  uOmegaSummationArcsec2: { value: number };
  uLimitMag: { value: number };
  uThresholdMag: { value: number };
  uCullMag: { value: number };
}

export interface ExposureControllerDeps {
  uniforms: ExposureUniforms;
  /** Fired on user-driven changes (instrument, EV) so URL sync and the
   *  panel re-read. Deliberately NOT fired by `setAdaptation` — that
   *  runs every frame. */
  onChange: () => void;
}

export class ExposureController {
  private readonly deps: ExposureControllerDeps;
  private instrument: InstrumentName;
  private ev = 0;
  private dm = 0;

  constructor(deps: ExposureControllerDeps, instrument: InstrumentName) {
    this.deps = deps;
    this.instrument = instrument;
    this.write();
  }

  getInstrument(): InstrumentName { return this.instrument; }
  getEv(): number { return this.ev; }
  getAdaptationDm(): number { return this.dm; }

  /** The instrument's limiting magnitude — the footprint window, chart
   *  disc sizing and the exposure anchor, none of which follow the
   *  exposure state. */
  getLimitMag(): number { return instrumentLimitMag(this.instrument); }

  /** Where a source lands on the just-visible floor: instrument plus
   *  manual trim. The shaders' taper anchor. */
  getThresholdMag(): number { return thresholdMagFor(this.getLimitMag(), this.ev); }

  /** The faintest drawn magnitude, for the CPU pick / LOD mirrors. */
  drawCutoffMag(chart: boolean): number {
    return drawCutoffMag(this.getLimitMag(), this.getThresholdMag(), chart);
  }

  /** What the observer can actually perceive this frame — adaptation
   *  folded in.
   *
   *  **Nothing cached or per-frame may key on it**: adaptation moves
   *  every frame, so a cull, a footprint window or any dirty-tracked
   *  cache would thrash. That is a constraint on the *consumer*, not on
   *  the number — an on-demand consumer that recomputes from scratch
   *  and stores nothing is free to read it, and the pick paths are
   *  exactly that. They reach adaptation through `uExposure` and
   *  `emitter-visibility-pure.ts` rather than through this readout,
   *  which stays a magnitude for the panel to print. */
  getEffectiveLimitMag(): number { return this.getThresholdMag() + this.dm; }

  setInstrument(name: InstrumentName): void {
    if (this.instrument === name) return;
    this.instrument = name;
    this.write();
    this.deps.onChange();
  }

  setEv(ev: number): void {
    const clamped = Math.max(-EV_MAX_STOPS, Math.min(EV_MAX_STOPS, ev));
    if (this.ev === clamped) return;
    this.ev = clamped;
    this.write();
    this.deps.onChange();
  }

  /** Per-frame automatic cut, in magnitudes. Clamped at 0 — nothing
   *  adapts to see fainter than threshold. */
  setAdaptation(dm: number): void {
    const cut = Math.min(0, dm);
    if (this.dm === cut) return;
    this.dm = cut;
    this.deps.uniforms.uExposure.value = this.exposure();
  }

  private exposure(): number {
    return sceneExposure(this.getLimitMag(), this.dm, this.ev);
  }

  private write(): void {
    const u = this.deps.uniforms;
    const limitMag = this.getLimitMag();
    u.uLimitMag.value = limitMag;
    u.uThresholdMag.value = thresholdMagFor(limitMag, this.ev);
    u.uCullMag.value = cullMagFor(limitMag);
    u.uExposure.value = this.exposure();
    u.uOmegaSummationArcsec2.value = summationSolidAngleFor(this.instrument);
  }
}
