/** Inline SVG icons, matching the prototype. Stroke uses currentColor. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Lock = (p: P) => <svg {...base} strokeWidth={2.2} {...p}><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const Shield = (p: P) => <svg {...base} strokeWidth={2.2} {...p}><path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
export const Arrow = (p: P) => <svg {...base} strokeWidth={2.4} {...p}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
export const Plus = (p: P) => <svg {...base} strokeWidth={2.4} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const ChevronLeft = (p: P) => <svg {...base} strokeWidth={2.4} {...p}><path d="M15 18l-6-6 6-6" /></svg>;
export const Key = (p: P) => <svg {...base} {...p}><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.5 12.5L20 3M16 7l3 3M13 10l3 3" /></svg>;
export const Sun = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const Moon = (p: P) => <svg {...base} {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
export const Check = (p: P) => <svg {...base} strokeWidth={3} {...p}><path d="M20 6L9 17l-5-5" /></svg>;
export const CheckDouble = (p: P) => <svg {...base} strokeWidth={3} {...p}><path d="M18 6L7 17l-4-4M22 8l-8 8" /></svg>;
export const Clock = (p: P) => <svg {...base} strokeWidth={2.4} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const Paperclip = (p: P) => <svg {...base} {...p}><path d="M21 8l-9.2 9.2a4 4 0 0 1-5.7-5.7L15 3a2.6 2.6 0 0 1 3.7 3.7L9.5 15.9a1.3 1.3 0 0 1-1.8-1.8l8.1-8.1" /></svg>;
export const Eye = (p: P) => <svg {...base} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
export const EyeOff = (p: P) => <svg {...base} {...p}><path d="M2 12s3.5-7 10-7c2.2 0 4.1.7 5.7 1.6M22 12s-3.5 7-10 7c-2.2 0-4.1-.7-5.7-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" /></svg>;
export const LogOut = (p: P) => <svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
export const LinkIcon = (p: P) => <svg {...base} {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
