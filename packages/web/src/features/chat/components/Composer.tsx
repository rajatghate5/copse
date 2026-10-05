/**
 * The message input. Local state only - the draft text lives here and never
 * touches the store, so keystrokes don't ripple into the message list. Emits a
 * typing signal (debounced upstream) and sends on Enter or the button.
 *
 * Two things are layered over that input, both of which have to respect it
 * rather than fight it: an emoji picker, which inserts at the caret, and @
 * completion, which replaces the fragment being typed. Both keep the caret
 * where a person would expect it, and while the completion list is open Enter
 * belongs to the list, not to sending - otherwise picking a name sends a half
 * written message.
 */

import { useRef, useState } from 'react';
import type { UserSummary } from '@copse/protocol';
import { EVERYONE_HANDLES } from '@copse/protocol';
import { pendingHandle } from '@/features/chat/mentions.ts';
import type { Quote } from '@/features/chat/body.ts';
import { Arrow } from '@/assets/svgs/arrow/index.tsx';
import { Check } from '@/assets/svgs/check/index.tsx';
import { Smile } from '@/assets/svgs/smile/index.tsx';
import { EmojiPicker } from '@/features/chat/components/EmojiPicker.tsx';

/** A row in the completion list: a member, or the "everyone" shorthand. */
interface Choice {
  id: string;
  username: string;
  displayName: string;
  hint?: string;
}

interface Props {
  peerName: string;
  /** The others in this conversation, for @ completion. */
  members: UserSummary[];
  /** The draft to start from - the message being edited, or nothing. */
  initialText?: string;
  /** Editing an existing message rather than writing a new one. */
  editing?: boolean;
  /** The message this draft will answer, shown above the input. */
  replyTo?: Quote | null;
  /** Leave edit mode, or drop the reply. */
  onCancel?: () => void;
  onSend: (text: string) => void;
  onTyping: () => void;
}

export function Composer({ peerName, members, initialText = '', editing = false, replyTo, onCancel, onSend, onTyping }: Props) {
  const [text, setText] = useState(initialText);
  const [emoji, setEmoji] = useState(false);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lastTyped = useRef(0);
  const [caret, setCaret] = useState(0);
  // Escape dismisses the list without clearing what was typed; typing again
  // brings it back, which is what Escape means everywhere else.
  const [dismissed, setDismissed] = useState(false);

  const pending = dismissed ? null : pendingHandle(text, caret);
  /**
   * "Everyone" is offered as if it were a member, and first, because reaching
   * the whole group is the common case worth one keystroke. Only when there is
   * a group to reach: in a direct chat it would just be the other person's name
   * written a second way. It is a reserved handle, so it can never collide with
   * somebody actually called that.
   */
  const everyone: Choice | null = members.length > 1
    ? { id: '@everyone', username: EVERYONE_HANDLES[0], displayName: 'Everyone', hint: `all ${members.length}` }
    : null;
  const matches: Choice[] = pending
    ? [
        ...(everyone && EVERYONE_HANDLES.some((h) => h.startsWith(pending.query)) ? [everyone] : []),
        ...members
          .filter((m) => m.username.startsWith(pending.query) || m.displayName.toLowerCase().startsWith(pending.query))
          .map((m) => ({ id: m.id, username: m.username, displayName: m.displayName })),
      ].slice(0, 6)
    : [];
  const open = matches.length > 0;
  const chosen = matches[Math.min(pick, matches.length - 1)];

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
    setCaret(0);
  };

  /** Put something at the caret and leave the caret after it. */
  const insert = (snippet: string, replaceFrom = caret) => {
    const next = text.slice(0, replaceFrom) + snippet + text.slice(caret);
    const at = replaceFrom + snippet.length;
    setText(next);
    setCaret(at);
    // After React has written the value, or the selection is set on stale text.
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  const complete = (choice: Choice) => {
    if (!pending) return;
    insert(`@${choice.username} `, pending.from);
    setPick(0);
  };

  const sync = () => setCaret(input.current?.selectionStart ?? 0);

  return (
    <div className="composer">
      {(editing || replyTo) && (
        <div className="draft-strip">
          <span className="ds-kind">{editing ? 'Editing' : `Replying to ${replyTo!.by}`}</span>
          {!editing && <span className="ds-text">{replyTo!.text}</span>}
          <button type="button" className="ds-x" aria-label="Cancel" onClick={onCancel}>×</button>
        </div>
      )}
      {open && (
        <div className="mention-pop" role="listbox" aria-label="Mention someone">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === chosen?.id}
              className={`mention-row${m.id === chosen?.id ? ' on' : ''}`}
              // mousedown, not click: the input blurs on click and the caret
              // position we are about to replace would be gone.
              onMouseDown={(e) => { e.preventDefault(); complete(m); }}
              onMouseEnter={() => setPick(i)}
            >
              <span className="mention-name">{m.displayName}</span>
              <span className="mention-handle">@{m.username}</span>
              {m.hint && <span className="mention-hint">{m.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {emoji && (
        <EmojiPicker
          onPick={(e) => insert(e)}
          onClose={() => setEmoji(false)}
        />
      )}

      <button
        className={`attach${emoji ? ' on' : ''}`}
        aria-label="Emoji"
        aria-expanded={emoji}
        onClick={() => setEmoji((v) => !v)}
      >
        <Smile />
      </button>

      <input
        id="composer-input"
        className="msg"
        ref={input}
        placeholder={`Message ${peerName}…`}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setPick(0);
          setDismissed(false);
          const now = Date.now();
          if (now - lastTyped.current > 1500) {
            lastTyped.current = now;
            onTyping();
          }
        }}
        onClick={sync}
        onSelect={sync}
        onKeyUp={sync}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); return setPick((p) => (p + 1) % matches.length); }
            if (e.key === 'ArrowUp') { e.preventDefault(); return setPick((p) => (p - 1 + matches.length) % matches.length); }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              if (chosen) complete(chosen);
              return;
            }
            if (e.key === 'Escape') { e.preventDefault(); return setDismissed(true); }
          }
          if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); return onCancel?.(); }
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="send" aria-label={editing ? 'Save' : 'Send'} disabled={!text.trim()} onClick={submit}>
        {editing ? <Check /> : <Arrow />}
      </button>
    </div>
  );
}
