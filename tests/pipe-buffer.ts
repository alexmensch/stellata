// Long-input fixture for the pipefail hook cases — /tests/README.md#pipefail-early-readers.

export const PAST_PIPE_BUFFER_LINES = 20_000;

export function pastPipeBuffer(firstLine: string): string {
  return [firstLine, ...Array<string>(PAST_PIPE_BUFFER_LINES).fill('echo padding')].join('\n');
}
