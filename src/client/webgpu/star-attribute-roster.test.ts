import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StarPipeline } from '../star-pipeline/star-pipeline';
import { makeStarPipelineOptions } from '../star-pipeline/star-pipeline-mock';
import {
  STAR_FORWARDED_ATTRIBUTES,
  STAR_STATIC_FIELDS,
  STAR_VERTEX_ATTRIBUTES,
} from './star-attribute-roster';

function starGeometryAttributes() {
  const { geometry } = new StarPipeline(makeStarPipelineOptions());
  return Object.entries(geometry.attributes).map(([name, attr]) => ({
    name,
    itemSize: attr.itemSize,
    instanced: attr instanceof THREE.InstancedBufferAttribute,
    dynamic: ('usage' in attr ? attr.usage : attr.data.usage) === THREE.DynamicDrawUsage,
  }));
}

const sorted = (names: readonly string[]) => [...names].sort();

// The roster is the live WebGL geometry partitioned by how the port
// consumes each attribute; a new attribute there fails here until it is
// placed.
describe('star attribute roster', () => {
  it('every static per-instance scalar is a static-table field', () => {
    const statics = starGeometryAttributes()
      .filter((a) => a.instanced && !a.dynamic && a.itemSize === 1)
      .map((a) => a.name);
    const pulsSplit = ['iPulsRho', 'iPulsColorSwing'];
    expect(sorted([...statics, ...pulsSplit])).toEqual(sorted(STAR_STATIC_FIELDS));
  });

  it('iPuls is the one static vector, split into its two fields', () => {
    const vectors = starGeometryAttributes()
      .filter((a) => a.instanced && !a.dynamic && a.itemSize > 1);
    expect(vectors).toEqual([{ name: 'iPuls', itemSize: 2, instanced: true, dynamic: false }]);
  });

  it('every attribute rewritten after load is forwarded', () => {
    const dynamic = starGeometryAttributes().filter((a) => a.dynamic).map((a) => a.name);
    expect(sorted(dynamic)).toEqual(sorted(STAR_FORWARDED_ATTRIBUTES));
  });

  it('the per-vertex attribute is the only one that stays a vertex buffer', () => {
    const perVertex = starGeometryAttributes().filter((a) => !a.instanced).map((a) => a.name);
    expect(perVertex).toEqual([...STAR_VERTEX_ATTRIBUTES]);
  });

  it('the three partitions cover the geometry exactly once', () => {
    const all = starGeometryAttributes().map((a) => a.name);
    const covered = [
      ...STAR_VERTEX_ATTRIBUTES, ...STAR_FORWARDED_ATTRIBUTES,
      ...STAR_STATIC_FIELDS.filter((f) => !f.startsWith('iPuls')), 'iPuls',
    ];
    expect(sorted(covered)).toEqual(sorted(all));
    expect(all).toHaveLength(15);
  });
});
