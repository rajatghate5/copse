import { base, type IconProps } from '@/assets/svgs/base.tsx';
/** Two ticks, the second trailing the first: delivered, and read when tinted. */
export const CheckDouble = (p: IconProps) => (
  <svg {...base} strokeWidth={3} {...p}>
    <path d="M14 6L6.5 14l-2.5-2.5" />
    <path d="M22 7l-7.5 8" />
  </svg>
);
