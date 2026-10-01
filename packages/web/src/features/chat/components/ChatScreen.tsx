/**
 * The chat surface: roster + open thread, wired to the live store. Owns only
 * view-level state (which conversation, which dialog, mobile pane) - all data
 * flows from the store and the engine.
 */

import { useMemo, useState } from 'react';
import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { useSocket } from '@/features/chat/hooks/useSocket.ts';
import { useChat } from '@/features/chat/hooks/useChat.ts';
import { useTypingIndicator } from '@/features/chat/hooks/useTypingIndicator.ts';
import { conversationName, conversationSubtitle, otherMemberIds } from '@/features/chat/selectors.ts';
import { initials } from '@/lib/format.ts';
import { MessageList } from '@/features/chat/components/MessageList.tsx';
import { Composer } from '@/features/chat/components/Composer.tsx';
import { ConversationList } from '@/features/chat/components/ConversationList.tsx';
import { SafetyNumberSheet } from '@/features/chat/components/SafetyNumberSheet.tsx';
import { NewConversationDialog } from '@/features/chat/components/NewConversationDialog.tsx';
import { RoomSwitcher } from '@/features/rooms/RoomSwitcher.tsx';
import { ProfilePanel } from '@/features/profile/ProfilePanel.tsx';
import { Brand, ThemeToggle } from '@/components/common.tsx';
import { ChevronLeft } from '@/assets/svgs/chevron-left/index.tsx';
import { Lock } from '@/assets/svgs/lock/index.tsx';
import { Shield } from '@/assets/svgs/shield/index.tsx';
import { Gear } from '@/assets/svgs/gear/index.tsx';

export function ChatScreen() {
  useSocket();

  const connection = useChatStore((s) => s.connection);
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const me = useAuth((s) => s.me!);

  const [view, setView] = useState<'list' | 'thread'>('list');
  const [showNew, setShowNew] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const active = activeId ? conversations[activeId] : undefined;
  const { messages, send, notifyTyping } = useChat(activeId);
  const typingNames = useTypingIndicator(activeId);

  const nameOf = useMemo(() => (id: string) => (id === me.id ? 'You' : users[id]?.displayName ?? 'Someone'), [users, me.id]);
  const title = active ? conversationName(active, users, me.id) : '';
  const subtitle = active ? conversationSubtitle(active, users, me.id) : '';
  const otherId = active && active.kind === 'direct' ? otherMemberIds(active, me.id)[0] : undefined;
  const otherUser = otherId ? users[otherId] : undefined;

  const openConversation = (id: string) => {
    setActive(id);
    setView('thread');
  };

  return (
    <div className="frame">
      <div className="topbar">
        <Brand />
        <span className="spacer" />
        <RoomSwitcher />
        <ThemeToggle />
        <button className="ghost-btn" aria-label="Profile and settings" onClick={() => setShowProfile(true)}><Gear /></button>
      </div>

      <div className="stage">
        <div className="app" data-view={view}>
          <ConversationList onSelect={openConversation} onNew={() => setShowNew(true)} />

          <div className="thread">
            {!active ? (
              <div className="empty" style={{ margin: 'auto' }}>
                Pick a conversation, or start a new one with the + button.
              </div>
            ) : (
              <>
                <div className="thread-head">
                  <button className="back" aria-label="Back" onClick={() => setView('list')}><ChevronLeft /></button>
                  <span className="av sm">{initials(title)}</span>
                  <span>
                    <span className="th-name">{title}</span>
                    <br />
                    <span className="th-sub">{subtitle}</span>
                  </span>
                  {otherUser && (
                    <button className="verified unverified" onClick={() => setShowSafety(true)}>
                      <Shield /> Verify
                    </button>
                  )}
                </div>

                <MessageList messages={messages} isGroup={active.kind === 'group'} nameOf={nameOf} typingNames={typingNames} />

                {connection !== 'online' && (
                  <div className={`conn-banner ${connection === 'connecting' ? 'waking' : 'reconnecting'}`}>
                    {connection === 'connecting' ? 'Connecting — the server may be waking up…' : 'Reconnecting…'}
                  </div>
                )}
                <div className="lock-strip"><Lock /> End-to-end encrypted · disappears after 7 days</div>
                <Composer peerName={title} onSend={send} onTyping={notifyTyping} />
              </>
            )}
          </div>
        </div>
      </div>

      {showNew && <NewConversationDialog onClose={() => setShowNew(false)} />}
      {showSafety && otherUser && <SafetyNumberSheet other={otherUser} onClose={() => setShowSafety(false)} />}
    </div>
  );
}
