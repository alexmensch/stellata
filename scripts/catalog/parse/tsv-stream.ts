// Line-at-a-time reads over the build's largest committed tables. See
// README.md#streaming-a-committed-table.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function forEachLine(
  path: string,
  consume: (line: string) => void,
): Promise<void> {
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) consume(line);
}
