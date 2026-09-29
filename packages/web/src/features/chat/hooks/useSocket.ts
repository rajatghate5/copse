/**
 * Owns the engine's lifecycle: start it once the account is unlocked, tear it
 * down when locked or signed out. Kept as a hook so the connection lives exactly
 * as long as a mounted, ready session - no more.
 */

import { useEffect } from 'react';
import { useAuth } from '../../auth/authStore.ts';
import { startEngine, stopEngine } from '../engine.ts';

export function useSocket(): void {
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status !== 'ready') return;
    startEngine();
    return () => stopEngine();
  }, [status]);
}
