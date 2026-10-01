# CLAUDE.md

Guidance for working in this repo. Read before making changes.

## What Copse is

An open-source, end-to-end encrypted chat for a small trusted group (built for
4 people). The server only ever handles **ciphertext** and public keys; message
plaintext exists only on devices. Messages are **deleted after 7 days**. Runs as
one Bun process serving both the WebSocket API and the built web client from a
single URL — deployable as one Docker image.

Not affiliated with any other product. Named Copse (a small grove of trees).

## Monorepo layout (Bun workspaces)

```
packages/
  crypto/     all encryption — pure, no I/O, fully tested. The trust core.
  protocol/   wire types + validators shared by client and server. No secrets.
  server/     Hono REST (auth) + Bun WebSocket + storage. Never sees plaintext.
  web/        React 19 + Vite 7 + Tailwind 4 client (Verdant theme).
```

Import across packages by scope: `@copse/crypto`, `@copse/protocol`,
`@copse/server`. TS path aliases live in the root `tsconfig.json`.

## Commands

```bash
bun install
bun test            # all tests (crypto + protocol + server, both DB backends)
bun run typecheck   # root + web tsconfigs
bun run serve       # start the server (local SQLite unless TURSO_* is set)
bun run dev         # web client on :5173, proxying /api and /ws to :4040
bun run build       # build the web client to packages/web/dist
```

## Non-negotiable design rules

1. **The client sends intent; the server owns state.** Every inbound field is
   untrusted and validated against the socket's authenticated identity before it
   acts. See `packages/server/src/server.ts`.
2. **The server never sees plaintext.** Message bodies, conversation titles and
   wrapped keys cross the wire and land in the DB as opaque base64. If a change
   would let the server read content, it's wrong.
3. **Crypto stays pure.** `packages/crypto` has no I/O, no network, no storage —
   only functions over bytes. That's what makes it testable and identical on
   client and server. Don't add side effects there.
4. **Untrusted strings are sanitised.** Names/chat pass through `cleanName` /
   `cleanB64` (control-char stripping) in `packages/protocol` — a security
   boundary (control bytes reach terminals and other clients), not cosmetics.

## Security model (settled)

- **Identity** = an X25519 (key agreement) + Ed25519 (signing) keypair derived
  from a random mnemonic (`crypto/identity.ts`). The mnemonic is never shown.
- **Login = the passphrase vault.** A passphrase is stretched with scrypt and
  encrypts the mnemonic (`crypto/vault.ts`); only the sealed blob is stored.
  Wrong passphrase → AES-GCM open fails. No passwords on the server.
- **Server auth** is challenge-response: sign a nonce with the Ed25519 key
  (`crypto/challenge.ts`); the server verifies against the stored public key and
  sets a session cookie. Sessions live in memory only.
- **Conversation keys** are random AES-256-GCM keys, wrapped per member via
  ephemeral-ECDH ECIES (`crypto/conversation.ts`). The server stores sealed
  envelopes it cannot open.
- **Messages** are AES-256-GCM sealed AND Ed25519 signed (`crypto/message.ts`) —
  signing matters because all members share the conversation key.
- **Safety numbers** (`crypto/safety.ts`) are the out-of-band defence against a
  server substituting keys. Keep them in the UI; without them E2E is only
  asserted. **No forward secrecy** — say so, don't imply otherwise.
- Passkey/WebAuthn unlock is a future seam, not built. TOTP was declined (it
  guards the server session, not message confidentiality).

## Retention

`RETENTION_DAYS = 7` lives in `@copse/protocol` (one source of truth). The server
sweeps expired messages hourly and at startup with a real `DELETE`
(`store.sweepExpired`), on both backends; `history()` also excludes anything past
the cutoff. Don't turn deletion into hiding.

## Storage

One `Store` interface, two implementations that share the schema:
- `store-sqlite.ts` — `bun:sqlite`, a local file. Offline / hotspot mode.
- `store-turso.ts` — hosted libSQL (Turso). Used on Render, whose free tier has
  no disk. Selected when `TURSO_DATABASE_URL` is set, else local file.

Both are covered by the same test suite (`server/test/server.test.ts`) so they
can't drift.

## Web client conventions

Feature-based structure under `packages/web/src`: isolate the WebSocket in a
service layer, encapsulate behaviour in hooks (`useSocket`, `useChat`,
`useTypingIndicator`), keep fast-changing realtime state in Zustand (not React
Context), virtualise long message lists (react-window), `React.memo` message
items, smart auto-scroll (only stick to bottom when already there), queue
outgoing messages in IndexedDB when offline, and track delivery by per-sender
`seq`. Verdant theme (pine green, Fraunces + Hanken Grotesk), ships light + dark
+ system toggle.

## Environment

```
PORT=4040                   # the platform sets this; unset falls back to 4040
COPSE_BOOTSTRAP=...         # operator secret. Open /?bootstrap=THAT once to mint
                            #   the first room and become admin. Unset ⇒ no first
                            #   room can be created (the server stays closed).
COPSE_STATIC=...            # dir of the built client (baked into the image)
COPSE_DB=./copse.db         # local SQLite path (offline mode); defaulted
TURSO_DATABASE_URL=...      # set → hosted mode (ciphertext only lives here)
TURSO_AUTH_TOKEN=...
```

## Rooms

A room is a sealed-off space with its own directory and conversations; a socket is
scoped to one room (`/ws?room=ID`, reopened to switch). Caps live in
`@copse/protocol`: a member may be in `MAX_ROOMS_PER_USER` (3) rooms, each holds
`ROOM_MAX_MEMBERS` (10). The **admin** (the `COPSE_BOOTSTRAP` account, `is_admin`)
may create unlimited rooms. Invite codes are rotatable (`rooms.ts` mints them);
registration lands an account in a room by `joinCode` or `bootstrap`. Conversations
carry a `room_id` and never cross rooms.

## Conventions

- Bun runs TypeScript directly — the server has no build step. Keep it that way.
- Match the surrounding comment density and naming; comments explain *why*.
- Tests come with behaviour changes, and tamper/negative cases must actually
  fail (a flipped ciphertext byte must not decrypt).
- Licensed MIT (`LICENSE`).
```
