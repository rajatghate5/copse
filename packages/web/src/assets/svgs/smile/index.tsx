import { base, type IconProps } from '@/assets/svgs/base.tsx';
export const Smile = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
  </svg>
);
