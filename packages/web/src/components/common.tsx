/** Shared chrome: the wordmark and the theme toggle, used by every screen. */

import { useTheme } from '@/lib/theme.ts';
import { Sun } from '@/assets/svgs/sun/index.tsx';
import { Moon } from '@/assets/svgs/moon/index.tsx';

export function Brand() {
  return (
    <span className="brand">
      <span className="leaf">❧</span> Copse
    </span>
  );
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button className="ghost-btn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
