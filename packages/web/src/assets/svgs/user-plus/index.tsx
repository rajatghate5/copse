import { base, type IconProps } from '@/assets/svgs/base.tsx';
export const UserPlus = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="8.5" cy="7" r="3.5" />
    <path d="M18 8v6M15 11h6" />
  </svg>
);
