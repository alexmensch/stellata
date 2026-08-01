// The probe ObjectKindModule — load/attach plus every capability leg of
// the deep-space-probe kind. See ./README.md.

import type { FocusableProvider } from '../../camera/focus/focus-target';
import {
  MIN_DISC_HIT_RADIUS_PX,
  pickFromCandidates,
  type PickCandidate,
} from '../../camera/controls/star-geometry';
import {
  PROBE_ORBIT_FLOOR_PC,
  PROBE_PARK_DIST_PC,
} from '../../camera/controls/star-physics';
import { createProbeFocusProvider } from '../../focus-card/probe-focus-provider';
import type { FocusCardProvider } from '../../focus-card/focus-card-types';
import { formatProbeHover } from '../../hover/formatters/probe-hover-format';
import type { HoverHit, HoverProvider } from '../../hover/hover-types';
import type {
  KindContext,
  KindSearchEntry,
  ObjectKindModule,
} from '../../kinds/kind-module';
import { projectToScreen } from '../../overlays/overlay-project';
import type { SceneLayer } from '../../scene/scene-layer';
import { SOL_OBJECT_SIDS } from '../sol-object-sids';
import { PROBE_MARKER_PX, ProbeField } from './probe-field';
import { createProbeLabels } from './probe-labels';
import { loadProbes } from './probe-loader';
import { ProbePathLayer } from './probe-path-layer';
import type { ProbeTrajectory } from './probe-trajectory';

export interface ProbeKindModule extends ObjectKindModule<'probe'> {
  /** The marker field — the shell's solar-system cluster mirrors its
   *  draws through the local depth pass. Valid after `attach`. */
  readonly field: ProbeField;
  readonly pathLayer: ProbePathLayer;
}

export function createProbeKindModule(): ProbeKindModule {
  let trajectories: readonly ProbeTrajectory[] = [];
  let ctx: KindContext | null = null;
  let field: ProbeField | null = null;
  let paths: ProbePathLayer | null = null;

  const pick = (
    clientX: number,
    clientY: number,
    pixelThreshold = 14,
  ): HoverHit | null => {
    if (!ctx || !field) return null;
    const rect = ctx.canvas.getBoundingClientRect();
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const camPos = ctx.camera.position;
    // Mirrors the marker draw predicate exactly (the field's own per-frame
    // `visible` verdict) with the glyph's fixed pixel size as the hit
    // radius — a probe is never focus-gated on the pick side, unlike its
    // trail. Prime tier inside the glyph, fallback within the threshold.
    const hitRadius = Math.max(PROBE_MARKER_PX * 0.5, MIN_DISC_HIT_RADIUS_PX);
    const candidates: Array<PickCandidate & { cameraDistancePc: number }> = [];
    for (let idx = 0; idx < field.probeCount(); idx++) {
      const sample = field.sampleFor(idx);
      if (sample === null || !sample.visible) continue;
      const screen = projectToScreen(sample.localPc, ctx.camera, rect.width, rect.height);
      if (!screen) continue;
      candidates.push({
        idx,
        pxDist: Math.hypot(cursorX - screen[0], cursorY - screen[1]),
        hitRadius,
        cameraDistancePc: camPos.distanceTo(sample.localPc),
      });
    }
    const r = pickFromCandidates(candidates, pixelThreshold);
    if (r === null) return null;
    return {
      idx: r.candidate.idx,
      cameraDistancePc: r.candidate.cameraDistancePc,
      tier: r.tier,
    };
  };

  const sampledFor = (idx: number) => {
    const s = field?.sampleFor(idx);
    return s && s.sampled ? s : null;
  };

  return {
    kind: 'probe',

    get field(): ProbeField {
      if (!field) throw new Error('probe module read before attach');
      return field;
    },
    get pathLayer(): ProbePathLayer {
      if (!paths) throw new Error('probe module read before attach');
      return paths;
    },

    async load(baseUrl: string): Promise<void> {
      trajectories = await loadProbes(baseUrl);
    },

    attach(kindCtx: KindContext): SceneLayer {
      ctx = kindCtx;
      field = new ProbeField(kindCtx.sharedUniforms);
      paths = new ProbePathLayer(kindCtx.sharedUniforms);
      kindCtx.scene.add(field.group);
      kindCtx.scene.add(paths.group);
      field.recenter(kindCtx.getWorldOffset());
      field.attach(trajectories, kindCtx.getT());
      paths.attach(trajectories);
      const focusedProbeIdx = (): number => {
        const t = kindCtx.getFocusedTarget();
        return t?.kind === 'probe' ? t.idx : -1;
      };
      return {
        update: (fc) => {
          field!.update(fc.t, fc.camera);
          // After the field wrote this frame's samples: each trail's last
          // vertex IS the marker position it just resolved. Only the
          // focused probe's trail draws.
          paths!.update(field!, fc.t, fc.camera, focusedProbeIdx());
        },
        setMonochrome: (on) => {
          field!.setMonochrome(on);
          paths!.setMonochrome(on);
        },
        recenter: (newOrigin) => field!.recenter(newOrigin),
        dispose: () => {
          field!.dispose();
          paths!.dispose();
        },
      };
    },

    focusable: (): FocusableProvider => ({
      anchorInto: (idx, out) => {
        if (!field?.localPositionInto(idx, out)) return false;
        out.add(ctx!.getWorldOffset());
        return true;
      },
      localPositionInto: (idx, out) => field?.localPositionInto(idx, out) ?? false,
      focusParkDistance: () => PROBE_PARK_DIST_PC,
      orbitFloor: () => PROBE_ORBIT_FLOOR_PC,
      arrivalRadiusPc: () => null,
      renderedSizePx: () => PROBE_MARKER_PX,
      chartPlateauDistance: () => null,
      planetSystemHost: () => (ctx ? ctx.solIndex : null),
    }),

    card: (): FocusCardProvider<'probe'> => createProbeFocusProvider({
      probeAt: (idx) => field?.probeAt(idx) ?? null,
      cameraDistancePc: (idx) => {
        const s = sampledFor(idx);
        return s === null ? null : ctx!.camera.position.distanceTo(s.localPc);
      },
      solDistancePc: (idx) => sampledFor(idx)?.solRelPc.length() ?? null,
      speedPcPerSec: (idx) => sampledFor(idx)?.velPcPerSec.length() ?? null,
      signalLost: (idx) => field?.sampleFor(idx)?.signalLost ?? false,
      constellationName: (idx) => ctx?.constellationOf('probe', idx) ?? null,
    }),

    hover: (): HoverProvider<'probe'> => ({
      kind: 'probe',
      pick: (x, y, pxThreshold) => pick(x, y, pxThreshold),
      format: (hit) => {
        const traj = field?.probeAt(hit.idx);
        const sample = sampledFor(hit.idx);
        if (!traj || sample === null) return null;
        return formatProbeHover({
          label: traj.label,
          cameraDistancePc: hit.cameraDistancePc,
          solDistancePc: sample.solRelPc.length(),
          speedPcPerSec: sample.velPcPerSec.length(),
          signalLost: sample.signalLost,
          lastContactT: traj.lastContactT,
        });
      },
    }),

    pick,

    pinnable: (idx) => (field?.probeAt(idx) ?? null) !== null,

    searchEntries: (): KindSearchEntry[] => {
      const out: KindSearchEntry[] = [];
      const count = field?.probeCount() ?? 0;
      for (let i = 0; i < count; i++) {
        const traj = field!.probeAt(i);
        if (!traj) continue;
        out.push({
          index: i,
          label: traj.label,
          primary: traj.label,
          displayCon: 'Probe · Interstellar',
        });
      }
      return out;
    },

    displayName: (idx) => field?.probeAt(idx)?.label ?? '',

    sids: () => trajectories.map((p) => SOL_OBJECT_SIDS[p.id] ?? 0),

    labels: () => {
      if (ctx && field) createProbeLabels(ctx, field);
    },

    detailBinds: () => ({
      probeMarkers: (on) => field?.setPermitted(on),
      probeTrails: (on) => paths?.setPermitted(on),
    }),

    clockJumped: (t) => field?.resampleAt(t),

    setFocalHidden: (idx) => field?.setHiddenInstance(idx),
  };
}
