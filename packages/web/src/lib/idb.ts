/**
 * IndexedDB, the client's durable store. Three things live here, and nothing
 * cryptographically dangerous does:
 *
 *   - account   the sealed vault + who we are (userId, username). The vault is
 *               ciphertext; the private keys only exist in memory after unlock.
 *   - convKeys  conversation keys, so history decrypts across reloads without a
 *               round-trip. Sensitive, but no more so than the identity that is
 *               already on this device.
 *   - outbox    messages queued while offline, flushed on reconnect. This is the
 *               reliability guarantee: a sent message is not lost if the socket
 *               was down.
 *
 * A tiny promise wrapper over the raw API - no dependency, and every call is
 * guarded so a private window or blocked storage degrades instead of throwing.
 */

const DB_NAME = 'copse';
const DB_VERSION = 1;

export interface StoredAccount {
  userId: string;
  username: string;
  displayName: string;
  vault: { salt: string; iv: string; ciphertext: string };
}

export interface OutboxItem {
  clientId: string;
  conversationId: string;
  seq: number;
  iv: string;
  ciphertext: string;
  signature: string;
  /** Kept so the optimistic bubble can render its own text before the echo. */
  plaintext: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('account')) db.createObjectStore('account');
      if (!db.objectStoreNames.contains('convKeys')) db.createObjectStore('convKeys');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'clientId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

// --- account ---------------------------------------------------------------

/**
 * Store the account and confirm it is really there.
 *
 * Every other call here degrades silently, which is right for a cache. This one
 * cannot: if the write is dropped — a private window, Safari with storage
 * restrictions, blocked site data — the user is signed in now and signed out on
 * the next reload, with nothing to explain it. A write can also report success
 * and still not persist, so the only trustworthy check is to read it back.
 */
export async function saveAccount(a: StoredAccount): Promise<boolean> {
  try {
    await tx('account', 'readwrite', (s) => s.put(a, 'me'));
    const back = await tx<StoredAccount>('account', 'readonly', (s) => s.get('me'));
    return back?.userId === a.userId;
  } catch {
    return false;
  }
}
export async function loadAccount(): Promise<StoredAccount | null> {
  try { return (await tx<StoredAccount>('account', 'readonly', (s) => s.get('me'))) ?? null; }
  catch { return null; }
}
export async function clearAccount(): Promise<void> {
  try { await tx('account', 'readwrite', (s) => s.delete('me')); } catch { /* ignore */ }
}

// --- conversation keys ------------------------------------------------------

export async function saveConvKey(conversationId: string, keyB64: string): Promise<void> {
  try { await tx('convKeys', 'readwrite', (s) => s.put(keyB64, conversationId)); } catch { /* ignore */ }
}
export async function loadConvKeys(): Promise<Record<string, string>> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const out: Record<string, string> = {};
      const cur = db.transaction('convKeys', 'readonly').objectStore('convKeys').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        out[c.key as string] = c.value as string;
        c.continue();
      };
      cur.onerror = () => resolve(out);
    });
  } catch { return {}; }
}

// --- outbox -----------------------------------------------------------------

export async function enqueue(item: OutboxItem): Promise<void> {
  try { await tx('outbox', 'readwrite', (s) => s.put(item)); } catch { /* ignore */ }
}
export async function dequeue(clientId: string): Promise<void> {
  try { await tx('outbox', 'readwrite', (s) => s.delete(clientId)); } catch { /* ignore */ }
}
export async function pending(): Promise<OutboxItem[]> {
  try { return (await tx<OutboxItem[]>('outbox', 'readonly', (s) => s.getAll())) ?? []; }
  catch { return []; }
}

export async function wipe(): Promise<void> {
  for (const store of ['account', 'convKeys', 'outbox']) {
    try { await tx(store, 'readwrite', (s) => s.clear()); } catch { /* ignore */ }
  }
}
