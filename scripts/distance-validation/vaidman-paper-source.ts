// The paper store's copy of Vaidman 2025 (/data/papers/index.md#vaidman2025), declared.

import { defineSource } from '../util/sources/source';

export const VAIDMAN_2025_PDF = defineSource({
  file: 'data/papers/pdf/vaidman2025.pdf',
  hint: 'Link the paper store (data/papers/README.md), or pass --pdf <path>.',
  parse: (input) => input.path,
});
