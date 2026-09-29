/**
 * Theme: light, dark, or follow the system. The choice is a per-viewer
 * convenience, so it lives in localStorage (guarded), and it drives the same
 * `data-theme` attribute the CSS in app.css keys off. "system" stamps nothing
 * and lets the media query decide, matching the token setup exactly.
 */

import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'copse-theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* blocked */ }
  return 'system';
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** True when what the viewer actually sees is dark, resolving "system". */
export function isDark(choice: ThemeChoice): boolean {
  if (choice === 'dark') return true;
  if (choice === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);

  useEffect(() => {
    apply(choice);
    try { localStorage.setItem(KEY, choice); } catch { /* blocked */ }
  }, [choice]);

  // Re-render when the OS theme flips while on "system", so the toggle icon tracks.
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => choice === 'system' && setChoice('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  /** Tap cycles the visible state: to whatever it is *not* right now. */
  const toggle = () => setChoice(isDark(choice) ? 'light' : 'dark');

  return { choice, setChoice, toggle, dark: isDark(choice) };
}
