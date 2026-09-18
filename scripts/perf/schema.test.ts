import { describe, expect, it } from 'vitest';
import { PERF_SCHEMA, SURVIVORS_SCHEMA, SchemaError, assertPerfFile } from './schema';

const CURRENT = {
  schema: PERF_SCHEMA,
  run: { startedAt: '2026-09-04T10:00:00.000Z', gpu: null },
  scenarios: [],
};

describe('assertPerfFile', () => {
  it('accepts a file on the suffix in force', () => {
    expect(assertPerfFile(CURRENT, 'fixture').schema).toBe(PERF_SCHEMA);
  });

  it('names the suffix in force', () => {
    expect(PERF_SCHEMA).toBe('stellata-perf/2');
  });

  it('rejects any other schema string rather than mapping its fields', () => {
    for (const schema of ['stellata-perf/1', 'stellata-perf/3', 'stellata-perf/', 'perf/2', '', null, undefined, 2]) {
      expect(() => assertPerfFile({ ...CURRENT, schema }, 'fixture')).toThrow(SchemaError);
    }
  });

  it('quotes the offending schema in the message', () => {
    expect(() => assertPerfFile({ ...CURRENT, schema: 'stellata-perf/1' }, 'run.json'))
      .toThrow('run.json carries schema "stellata-perf/1"');
  });

  it('rejects a file with no run block', () => {
    expect(() => assertPerfFile({ schema: PERF_SCHEMA, scenarios: [] }, 'fixture'))
      .toThrow(/no run block/);
  });

  it('rejects a file with no scenarios array', () => {
    expect(() => assertPerfFile({ schema: PERF_SCHEMA, run: {} }, 'fixture'))
      .toThrow(/no scenarios array/);
  });

  it('rejects a non-object', () => {
    for (const value of [null, undefined, 3, 'x', []]) {
      expect(() => assertPerfFile(value, 'fixture')).toThrow(SchemaError);
    }
  });

  it('rejects a survivors file, which carries a run block but no scenarios', () => {
    expect(() => assertPerfFile({ schema: SURVIVORS_SCHEMA, run: CURRENT.run, rows: [] }, 'survivors.json'))
      .toThrow(SchemaError);
  });
});

describe('SURVIVORS_SCHEMA', () => {
  it('names the suffix in force', () => {
    expect(SURVIVORS_SCHEMA).toBe('stellata-survivors/1');
  });

  it('is a separate suffix from the runner\'s, not a version of it', () => {
    expect(SURVIVORS_SCHEMA).not.toBe(PERF_SCHEMA);
  });
});
