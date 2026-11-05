import { describe, expect, it } from 'vitest';

import { defineJsonArtifact } from './json-artifact-pure';
import { sourceRowRef, sourceRowRefText } from './row-ref-pure';

const FIXTURE = defineJsonArtifact<{ items: { id: string }[] }, { id: string }>({
  file: 'fixture/things.json',
  hint: 'fixture',
  rowKey: { id: 'things', text: (row) => row.id },
});

describe('defineJsonArtifact', () => {
  it('serializes compact JSON with one final newline', () => {
    expect(FIXTURE.serialize({ items: [{ id: 'a' }] })).toBe('{"items":[{"id":"a"}]}\n');
  });

  it('cites a record by its row key', () => {
    expect(sourceRowRefText(sourceRowRef(FIXTURE, { id: 'orion-a' }))).toBe('things:orion-a');
  });
});
