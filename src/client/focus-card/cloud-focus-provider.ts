// Molecular-cloud provider for the tier-2 focus card. See ./README.md.

import type { Cloud } from '../molecular-clouds/cloud-loader';
import { fmtDistAuto } from '../ui/distance-util';
import { formatAxisPair, formatThousands } from '../format/physical-format';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

export interface CloudFocusProviderConfig {
  /** Null when clouds.json didn't load — format() then returns an
   *  empty card (unreachable in practice; clouds can't focus without
   *  the artifact). */
  clouds: readonly Cloud[] | null;
  /** Live camera→centroid distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number;
}

const SOURCE_LABEL: Record<Cloud['source'], string> = {
  Z2021T1: 'Zucker 2021',
  Z2020: 'Zucker 2020',
};

export function createCloudFocusProvider(
  config: CloudFocusProviderConfig,
): FocusCardProvider<'cloud'> {
  return {
    kind: 'cloud',
    format(idx: number): FocusCardContent {
      const cloud = config.clouds?.[idx];
      if (!cloud) return { name: '', identityLines: [], rows: [], lines: [] };
      const [ax, ay, az] = cloud.axes;
      const rows: FocusCardRow[] = [
        { label: 'Distance', value: () => fmtDistAuto(config.cameraDistancePc(idx)) },
        // Same axis pair the hover card shows — shared fields agree
        // between tiers.
        { label: 'Size', value: formatAxisPair(Math.max(ax, ay, az), Math.min(ax, ay, az)) },
      ];
      if (cloud.massMsun !== null) {
        rows.push({ label: 'Mass', value: `${formatThousands(cloud.massMsun)} M☉` });
      }
      rows.push({ label: 'Known from', value: SOURCE_LABEL[cloud.source] });
      return {
        name: cloud.name,
        identityLines: ['Molecular cloud'],
        rows,
        lines: [],
      };
    },
  };
}
