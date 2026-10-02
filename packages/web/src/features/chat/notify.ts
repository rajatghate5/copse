/**
 * Desktop notifications for messages that arrive while you are looking
 * elsewhere.
 *
 * Deliberately only the sender's name, never the message. A notification is
 * drawn by the operating system: it lands on a lock screen, in a notification
 * centre, on a paired watch, and in whatever log the OS keeps of those. None of
 * that is this device's encrypted storage, and none of it is somewhere a message
 * that was sealed on purpose should end up. "Ana sent a message" is enough to
 * make you look.
 *
 * This fires only while a tab is open — the page holds the conversation key, so
 * it is the page that knows a message arrived. Notifications when the app is
 * closed would need a service worker and a push service, and the server could
 * not fill them in: it has no plaintext to put there.
 */

const PREF_KEY = 'copse.notify';

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Whether the user asked for these, independent of the browser's permission. */
export function wanted(): boolean {
  try { return localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; }
}

export function permission(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported';
}

/**
 * Ask the browser, from a user gesture — browsers refuse the prompt otherwise.
 * Returns whether notifications will actually appear from now on.
 */
export async function enable(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const result = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    const ok = result === 'granted';
    localStorage.setItem(PREF_KEY, ok ? 'on' : 'off');
    return ok;
  } catch { return false; }
}

export function disable(): void {
  try { localStorage.setItem(PREF_KEY, 'off'); } catch { /* ignore */ }
}

/**
 * Notify about one message. Silent when the tab is already visible: you are
 * looking at the app, so the message list is the notification.
 */
export function notifyMessage(senderName: string, conversationId: string): void {
  if (!supported() || !wanted() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(senderName, {
      body: 'sent a message',
      // One notification per conversation: ten unread messages should not be
      // ten banners, and a replaced one keeps the latest sender.
      tag: `copse:${conversationId}`,
      renotify: false,
    } as NotificationOptions);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch { /* some platforms refuse the constructor; nothing to do */ }
}
