/** Shared SVG attributes and prop type for every icon under assets/svgs. */
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

export const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
