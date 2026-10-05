/**
 * The chat surface: roster + open thread, wired to the live store. Owns only
 * view-level state (which conversation, which dialog, mobile pane) - all data
 * flows from the store and the engine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserSummary } from '@copse/protocol';
import { useChatStore, type ChatMessage } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { openConversation as openAndRemember, editText } from '@/features/chat/engine.ts';
import { lastConversation } from '@/features/chat/place.ts';
import { useSocket } from '@/features/chat/hooks/useSocket.ts';
import { useChat } from '@/features/chat/hooks/useChat.ts';
import { useTypingIndicator } from '@/features/chat/hooks/useTypingIndicator.ts';
import { useUnreadTitle } from '@/features/chat/hooks/useUnreadTitle.ts';
import { conversationName, conversationSubtitle, otherMemberIds } from '@/features/chat/selectors.ts';
import { quoteOf, type Quote } from '@/features/chat/body.ts';
import { Avatar } from '@/features/chat/components/Avatar.tsx';
import { MessageList } from '@/features/chat/components/MessageList.tsx';
import { Composer } from '@/features/chat/components/Composer.tsx';
import { ConversationList } from '@/features/chat/components/ConversationList.tsx';
import { SafetyNumberSheet } from '@/features/chat/components/SafetyNumberSheet.tsx';
import { NewConversationDialog } from '@/features/chat/components/NewConversationDialog.tsx';
import { AddMembersDialog } from '@/features/chat/components/AddMembersDialog.tsx';
import { MessageMenu } from '@/features/chat/components/MessageMenu.tsx';
import { ForwardDialog } from '@/features/chat/components/ForwardDialog.tsx';
import { RoomSwitcher } from '@/features/rooms/RoomSwitcher.tsx';
import { ProfilePanel } from '@/features/profile/ProfilePanel.tsx';
import { Brand, ThemeToggle } from '@/components/common.tsx';
import { ChevronLeft } from '@/assets/svgs/chevron-left/index.tsx';
import { Lock } from '@/assets/svgs/lock/index.tsx';
import { Shield } from '@/assets/svgs/shield/index.tsx';
import { Gear } from '@/assets/svgs/gear/index.tsx';
import { UserPlus } from '@/assets/svgs/user-plus/index.tsx';

export function ChatScreen() {
  useSocket();
  useUnreadTitle();

  const connection = useChatStore((s) => s.connection);
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);
  const activeId = useChatStore((s) => s.activeId);
  const me = useAuth((s) => s.me!);
  const storageBlocked = useAuth((s) => s.storageBlocked);

  const [view, setView] = useState<'list' | 'thread'>('list');
  const [showNew, setShowNew] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // One message at a time: which one's actions are open, what we are replying
  // to, what we are editing, and what we are forwarding.
  const [acting, setActing] = useState<{ message: ChatMessage; anchor: DOMRect } | null>(null);
  const [replyTo, setReplyTo] = useState<Quote | null>(null);
  const [editing, setEditing] = useState<{ id: string; seq: number; text: string } | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);

  const active = activeId ? conversations[activeId] : undefined;
  const { messages, send, notifyTyping } = useChat(activeId);
  const typingNames = useTypingIndicator(activeId);

  const nameOf = useMemo(() => (id: string) => (id === me.id ? 'You' : users[id]?.displayName ?? 'Someone'), [users, me.id]);
  const title = active ? conversationName(active, users, me.id) : '';
  const subtitle = active ? conversationSubtitle(active, users, me.id) : '';
  const otherId = active && active.kind === 'direct' ? otherMemberIds(active, me.id)[0] : undefined;
  const otherUser = otherId ? users[otherId] : undefined;
  // The others in the open conversation, for @ completion in the composer.
  const members = useMemo(
    () => (active ? otherMemberIds(active, me.id).map((id) => users[id]).filter((u): u is UserSummary => Boolean(u)) : []),
    [active, users, me.id],
  );

  const openConversation = (id: string) => {
    openAndRemember(id);
    setView('thread');
    // Drafts belong to the thread they were started in.
    setReplyTo(null);
    setEditing(null);
  };

  // Stable, so a new message does not re-render every bubble (MessageItem is
  // memoised and this is one of its props).
  const onAct = useCallback((message: ChatMessage, anchor: DOMRect) => setActing({ message, anchor }), []);

  const startReply = (m: ChatMessage) => {
    setReplyTo(quoteOf(m.id, m.mine ? 'You' : nameOf(m.senderId), m.text));
    setEditing(null);
    setActing(null);
  };

  const startEdit = (m: ChatMessage) => {
    setEditing({ id: m.id, seq: m.seq, text: m.text });
    setReplyTo(null);
    setActing(null);
  };

  /** Enter in the composer: either save the edit, or send a new message. */
  const submit = (text: string) => {
    if (editing) {
      if (text.trim() && text !== editing.text) void editText(active!.id, editing.id, editing.seq, text);
      setEditing(null);
      return;
    }
    send(text, replyTo ? { quote: replyTo } : undefined);
    setReplyTo(null);
  };

  /**
   * On a reload the engine reopens the thread you left; on the narrow layout the
   * roster sits on top of it, so the restore has to move the view as well -
   * once, and only for the thread that was actually remembered, so a
   * conversation someone else starts can never yank you into it.
   */
  const followedRestore = useRef(false);
  useEffect(() => {
    if (followedRestore.current || !activeId) return;
    followedRestore.current = true;
    const roomId = useRoomStore.getState().currentRoomId;
    if (roomId && lastConversation(me.id, roomId) === activeId) setView('thread');
  }, [activeId, me.id]);

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
                  <Avatar name={title} size="sm" userIds={otherMemberIds(active, me.id)} />
                  <span>
                    <span className="th-name">{title}</span>
                    <br />
                    <span className="th-sub">{subtitle}</span>
                  </span>
                  {/* Add sits before Verify and takes the margin that pushes
                      the pair right, so the header reads name - add - verify at
                      every width. */}
                  <button className="th-add" onClick={() => setShowAdd(true)} title="Add people to this conversation">
                    <UserPlus /> <span className="th-add-label">Add</span>
                  </button>
                  {otherUser && (
                    <button className="verified unverified" style={{ marginLeft: 0 }} onClick={() => setShowSafety(true)}>
                      <Shield /> Verify
                    </button>
                  )}
                </div>

                {/* Keyed by conversation: the list caches measured row heights
                    and whether the reader is at the end, and neither means
                    anything in a different thread. */}
                <MessageList key={active.id} messages={messages} isGroup={active.kind === 'group'} nameOf={nameOf} typingNames={typingNames} myHandle={me.username} otherCount={members.length} onAct={onAct} />

                {connection !== 'online' && (
                  <div className={`conn-banner ${connection === 'connecting' ? 'waking' : 'reconnecting'}`}>
                    {connection === 'connecting' ? 'Connecting — the server may be waking up…' : 'Reconnecting…'}
                  </div>
                )}
                <div className="lock-strip"><Lock /> End-to-end encrypted · disappears after 7 days</div>
                <Composer
                  // Remounted when edit mode changes, so the draft is the
                  // message being edited without an effect to copy it in.
                  key={editing ? `edit:${editing.id}` : 'new'}
                  peerName={title}
                  members={members}
                  initialText={editing?.text ?? ''}
                  editing={Boolean(editing)}
                  replyTo={replyTo}
                  onCancel={() => { setEditing(null); setReplyTo(null); }}
                  onSend={submit}
                  onTyping={notifyTyping}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {storageBlocked && (
        <div className="store-warn">
          This browser won't keep your account on this device, so a reload will ask for your
          username and passphrase rather than just the passphrase. Private windows and blocked
          site data do this.
        </div>
      )}

      {showNew && <NewConversationDialog onClose={() => setShowNew(false)} />}
      {showAdd && active && <AddMembersDialog conversation={active} onClose={() => setShowAdd(false)} />}
      {acting && (
        <MessageMenu
          message={acting.message}
          anchor={acting.anchor}
          canForward={Object.keys(conversations).length > 1}
          onReply={() => startReply(acting.message)}
          onForward={() => { setForwarding(acting.message); setActing(null); }}
          onEdit={() => startEdit(acting.message)}
          onClose={() => setActing(null)}
        />
      )}
      {forwarding && <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />}
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
      {showSafety && otherUser && <SafetyNumberSheet other={otherUser} onClose={() => setShowSafety(false)} />}
    </div>
  );
}
