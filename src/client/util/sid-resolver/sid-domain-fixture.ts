// Test-only: read a domain back as the sid list it was built from.

import type { SidDomain } from './sid-resolver';

export function sidsOf(domain: SidDomain | null, count: number): (number | null)[] | null {
  return domain && Array.from({ length: count }, (_, i) => domain.sidOf(i));
}
