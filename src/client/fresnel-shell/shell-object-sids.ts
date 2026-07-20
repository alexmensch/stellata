// Hand-written shell key → frozen Stellata ID pins, minted from
// data/sid/shell-objects.tsv. See fresnel-shell/README.md § SID pins.

import type { ShellKey } from './shell-registry';

export const SHELL_OBJECT_SIDS: Readonly<Record<ShellKey, number>> = {
  local_bubble: 330273,
  heliopause: 330274,
};
