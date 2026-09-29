/**
 * App root: boot the auth store, then show the right surface for the auth state.
 * The identity lives only in memory when `ready`, so a reload lands on the
 * unlock screen - by design.
 */

import { useEffect } from 'react';
import { useAuth } from './features/auth/authStore.ts';
import { AuthScreens } from './features/auth/AuthScreens.tsx';
import { ChatScreen } from './features/chat/components/ChatScreen.tsx';
import { Brand, ThemeToggle } from './components/common.tsx';

export function App() {
  const status = useAuth((s) => s.status);
  const boot = useAuth((s) => s.boot);

  useEffect(() => { void boot(); }, [boot]);

  if (status === 'loading') {
    return (
      <div className="frame">
        <div className="topbar"><Brand /><span className="spacer" /><ThemeToggle /></div>
        <div className="stage"><div className="empty" style={{ margin: 'auto' }}>Loading…</div></div>
      </div>
    );
  }

  return status === 'ready' ? <ChatScreen /> : <AuthScreens />;
}
