/**
 * IndexedDB, the client's durable store. Three things live here, and nothing
 * cryptographically dangerous does:
 *
 *   - account   the sealed vault + who we are (userId, username). The vault is
 *               ciphertext; the private keys only exist in memory after unlock.
 *               Mirrored into localStorage, because losing this one record means
 *               being signed out - see saveAccount.
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
 * The account record is kept in two places, because IndexedDB has more ways to
 * fail than anything else here: a versioned open can be blocked, Firefox's
 * private mode has thrown on open, and Safari evicts whole origins. Losing it
 * means being signed out with nothing to explain why, so localStorage carries a
 * copy and either one is enough to come back.
 *
 * Not a cookie: the same "block site data" setting that stops localStorage stops
 * cookies too, so it would buy no coverage, and it would put the sealed vault in
 * the header of every request and every proxy log on the way.
 *
 * Both stores hold the same thing the server already has — a sealed vault and
 * two identifiers. Nothing readable, and no key.
 */
const ACCOUNT_LS_KEY = 'copse.account';

function localSave(a: StoredAccount): boolean {
  try {
    localStorage.setItem(ACCOUNT_LS_KEY, JSON.stringify(a));
    return localStorage.getItem(ACCOUNT_LS_KEY) !== null;
  } catch { return false; }
}

function localLoad(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_LS_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as StoredAccount;
    // Local data can be stale or hand-edited; a half-record is worse than none.
    const ok = typeof a?.userId === 'string' && typeof a?.username === 'string'
      && typeof a?.vault?.salt === 'string' && typeof a?.vault?.iv === 'string'
      && typeof a?.vault?.ciphertext === 'string';
    return ok ? a : null;
  } catch { return null; }
}

function localClear(): void {
  try { localStorage.removeItem(ACCOUNT_LS_KEY); } catch { /* ignore */ }
}

/**
 * Write to both, and report whether the account will still be here next time.
 * A write can report success and not persist, so each is read back rather than
 * trusted.
 */
export async function saveAccount(a: StoredAccount): Promise<boolean> {
  let inIdb = false;
  try {
    await tx('account', 'readwrite', (s) => s.put(a, 'me'));
    const back = await tx<StoredAccount>('account', 'readonly', (s) => s.get('me'));
    inIdb = back?.userId === a.userId;
  } catch { /* the copy may still take it */ }
  // Both, always. Short-circuiting here is what left localStorage empty for
  // everyone whose IndexedDB was fine - that is, for everyone who needed the
  // copy only later, when it had stopped being fine.
  const inLocal = localSave(a);
  return inIdb || inLocal;
}

export async function loadAccount(): Promise<StoredAccount | null> {
  let fromIdb: StoredAccount | null = null;
  try { fromIdb = (await tx<StoredAccount>('account', 'readonly', (s) => s.get('me'))) ?? null; }
  catch { /* try the copy */ }

  // Repair in whichever direction is missing, so an account that predates the
  // copy gains one, and one that survived only in localStorage goes back into
  // IndexedDB now that it is answering again.
  if (fromIdb) {
    if (localLoad()?.userId !== fromIdb.userId) localSave(fromIdb);
    return fromIdb;
  }

  const fallback = localLoad();
  if (fallback) { try { await tx('account', 'readwrite', (s) => s.put(fallback, 'me')); } catch { /* ignore */ } }
  return fallback;
}

export async function clearAccount(): Promise<void> {
  try { await tx('account', 'readwrite', (s) => s.delete('me')); } catch { /* ignore */ }
  localClear();
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
  // The account's second home. Missing this would resurrect it on next load.
  localClear();
}
