// The star-indexed storage tables every WebGPU star shader reads: the static
// record table built once, and the shell-written attributes mirrored live
// over their own arrays. README.md § Star tables.

import type * as THREE from 'three';
import { StorageBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import { storage, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Catalog } from '../../loaders/catalog-loader';
import {
  STAR_FORWARDED_ATTRIBUTES,
  type StarForwardedAttribute,
  type StarStaticField,
} from '../star-attribute-roster';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import {
  STAR_STATIC_STRIDE, writeStaticTable, staticSlot, type StaticFieldSources,
} from './star-tables-pure';

export type FloatStorageNode = ReturnType<typeof storage<'float'>>;

export interface StarLayerSources {
  catalog: Catalog;
  logRadii: Float32Array;
  lumClassF32: Float32Array;
  distSol: Float32Array;
  teffApsis: Float32Array;
  boundingSphereRadiusPc: number;
  /** The shell-owned WebGL attributes whose arrays the forwarded tables
   *  wrap. Their writers never learn about this backend: the tables share
   *  the array and take the version + ranges each writer flags. */
  iPositionAttr: THREE.InstancedBufferAttribute;
  iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
  iEclipseDimAttr: THREE.InstancedBufferAttribute;
  iSuppressPulsationAttr: THREE.InstancedBufferAttribute;
}

export function staticFieldSources(s: StarLayerSources): StaticFieldSources {
  return {
    iAbsmag: s.catalog.absmag,
    iCi: s.catalog.ci,
    iSpectClass: s.catalog.spectClass,
    iLogRadius: s.logRadii,
    iPeriodDays: s.catalog.periodDays,
    iAmplitudeMag: s.catalog.amplitudeMag,
    iLumClass: s.lumClassF32,
    iDistSol: s.distSol,
    iTeffApsis: s.teffApsis,
    iPulsRho: s.catalog.pulsRho,
    iPulsColorSwing: s.catalog.pulsColorSwing,
  };
}

export function forwardedSourceAttrs(
  s: StarLayerSources,
): Record<StarForwardedAttribute, THREE.InstancedBufferAttribute> {
  return {
    iPosition: s.iPositionAttr,
    iCompositeSuppress: s.iCompositeSuppressAttr,
    iEclipseDim: s.iEclipseDimAttr,
    iSuppressPulsation: s.iSuppressPulsationAttr,
  };
}

interface ForwardedTable {
  src: THREE.InstancedBufferAttribute;
  attr: StorageBufferAttribute;
  node: FloatStorageNode;
  /** Sentinel -1: no attribute version is negative, so the first sync
   *  always forwards. */
  last: number;
  /** A full upload forwarded this frame and not yet consumed. Ranges
   *  forwarded behind it are dropped: three honours a non-empty range list
   *  INSTEAD of the full array, so adding them would shrink the upload to
   *  the ranges alone. */
  fullPending: boolean;
}

export class StarTables {
  readonly count: number;
  readonly statics: StorageBufferAttribute;

  private readonly staticsNode: FloatStorageNode;
  private readonly forwarded: Record<StarForwardedAttribute, ForwardedTable>;
  private readonly sources: StarLayerSources;
  private staticsWritten = 0;

  constructor(sources: StarLayerSources) {
    this.sources = sources;
    this.count = sources.catalog.count;
    this.statics = new StorageBufferAttribute(
      new Float32Array(this.count * STAR_STATIC_STRIDE), 1);
    this.absorbRecords();
    this.staticsNode = storage(this.statics, 'float', this.statics.count).toReadOnly();
    const srcAttrs = forwardedSourceAttrs(sources);
    const entries = STAR_FORWARDED_ATTRIBUTES.map((name) => {
      const src = srcAttrs[name];
      const attr = new StorageBufferAttribute(src.array as Float32Array, 1);
      const node = storage(attr, 'float', attr.count).toReadOnly();
      return [name, { src, attr, node, last: -1, fullPending: false }] as const;
    });
    this.forwarded = Object.fromEntries(entries) as Record<StarForwardedAttribute, ForwardedTable>;
  }

  /** Interleave every record decoded since the last call into the static
   *  table and flag just those elements for upload. Append-only, so one
   *  contiguous range per chunk — never the diff uploader, which tracks a
   *  fixed item list. */
  absorbRecords(): void {
    const first = this.staticsWritten;
    const end = this.sources.catalog.loadedCount;
    if (end <= first) return;
    writeStaticTable(
      staticFieldSources(this.sources),
      this.statics.array as Float32Array,
      this.count,
      first,
      end,
    );
    this.statics.addUpdateRange(
      first * STAR_STATIC_STRIDE, (end - first) * STAR_STATIC_STRIDE);
    this.statics.needsUpdate = true;
    this.staticsWritten = end;
  }

  stat(self: Node<'int'>, field: StarStaticField): Node<'float'> {
    return this.staticsNode.element(self.mul(STAR_STATIC_STRIDE).add(staticSlot(field)));
  }

  /** Floating-origin local position, three scalar reads of the iPosition
   *  array — never an itemSize-3 storage attribute, which three would
   *  re-stride to 4 behind every uploader's back. */
  position(self: Node<'int'>): Node<'vec3'> {
    const p = this.forwarded.iPosition.node;
    const base = self.mul(3);
    return vec3(p.element(base), p.element(base.add(1)), p.element(base.add(2)));
  }

  scalar(name: Exclude<StarForwardedAttribute, 'iPosition'>, self: Node<'int'>): Node<'float'> {
    return this.forwarded[name].node.element(self);
  }

  forwardedAttribute(name: StarForwardedAttribute): StorageBufferAttribute {
    return this.forwarded[name].attr;
  }

  /** What dispose releases. */
  storageAttributes(): StorageBufferAttribute[] {
    return [this.statics, ...STAR_FORWARDED_ATTRIBUTES.map((n) => this.forwarded[n].attr)];
  }

  /** Forward each source attribute's version and update ranges onto its
   *  table, verbatim: same array, same element units. Idempotent within a
   *  frame; the source's ranges are consumed here because no renderer
   *  ever reads the WebGL geometry on this boot. */
  syncSources(): void {
    for (const name of STAR_FORWARDED_ATTRIBUTES) {
      const f = this.forwarded[name];
      if (f.src.version === f.last) continue;
      f.last = f.src.version;
      const ranges = f.src.updateRanges;
      if (ranges.length === 0) {
        f.attr.clearUpdateRanges();
        f.attr.needsUpdate = true;
        f.fullPending = true;
      } else if (!f.fullPending) {
        for (const r of ranges) f.attr.addUpdateRange(r.start, r.count);
        f.attr.needsUpdate = true;
      }
      f.src.clearUpdateRanges();
    }
  }

  /** Re-arm ranged forwarding for the next frame. Safe to call before the
   *  render that consumes a pending full upload — but ONLY because the
   *  layer's `update()` runs past the render gate, between the frame's
   *  uniform sync and its `render()`, so a frame that forwards always
   *  renders. The kernel binds three of the four tables; the other two
   *  reach the GPU in the render submit alone. */
  endFrame(): void {
    for (const name of STAR_FORWARDED_ATTRIBUTES) this.forwarded[name].fullPending = false;
  }

  dispose(renderer: WebGPURenderer): void {
    for (const attr of this.storageAttributes()) disposeStorageAttribute(renderer, attr);
    for (const name of STAR_FORWARDED_ATTRIBUTES) {
      this.forwarded[name].last = -1;
      this.forwarded[name].fullPending = false;
    }
  }
}
