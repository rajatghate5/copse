/*
 * The service worker. Its whole job is to make Copse installable and to survive
 * a bad connection - not to be clever about caching, which here would be
 * actively harmful.
 *
 * Two rules it must not break:
 *
 *   1. Nothing under /api or /ws is ever touched. Those carry the session and
 *      the ciphertext, and a cached reply to any of them would be wrong at best.
 *   2. The document is network-first. index.html names which fingerprinted
 *      bundle to load, so serving a cached one pins the whole client at an old
 *      deploy - the exact failure the server's cache headers exist to prevent.
 *      The cached copy is a fallback for being offline, nothing more.
 *
 * Files under /assets are content-addressed by Vite: the name changes when the
 * bytes do, so they can be served from the cache without a thought, and the
 * cache is simply emptied of other versions when this worker takes over.
 *
 * No message data goes in here. The conversation keys and plaintext live in the
 * page, and a cache is the wrong place for either.
 */

const CACHE = 'copse-v1';

self.addEventListener('install', (event) => {
  // The shell is cached on first use rather than precached: the asset names are
  // build-specific and this file is not, so there is no list to write here.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Other origins, and anything that talks to the server, are left alone.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  // Navigations: the network decides, the cache is the safety net.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          return (await caches.match('/index.html')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Fingerprinted assets: the cache is authoritative, because the name is.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
        return fresh;
      })(),
    );
  }
});
