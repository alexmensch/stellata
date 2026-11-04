// Long-input fixture for the pipefail hook cases — /tests/README.md#pipefail-early-readers.

export const PAST_PIPE_BUFFER_BYTES = 256 * 1024;

const PADDING_LINE = 'echo padding';

export function pastPipeBuffer(firstLine: string): string {
  const lines = Math.ceil(PAST_PIPE_BUFFER_BYTES / (PADDING_LINE.length + 1));
  return [firstLine, ...Array<string>(lines).fill(PADDING_LINE)].join('\n');
}
