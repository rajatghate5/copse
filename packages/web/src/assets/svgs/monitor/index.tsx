import { base, type IconProps } from '@/assets/svgs/base.tsx';
/** A display: "follow whatever this device is set to". */
export const Monitor = (p: IconProps) => (
  <svg {...base} {...p}><rect x="2.5" y="3.5" width="19" height="13" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></svg>
);
