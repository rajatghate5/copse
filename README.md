# Copse

A small, end-to-end encrypted chat for a handful of people. One-to-one and group
conversations, no phone numbers, no accounts you sign up for at some company —
your identity is a keypair that lives in your browser, unlocked by a passphrase,
and the server only ever holds ciphertext it cannot read. Messages delete
themselves after seven days.

Built to be cheap to run and boring to maintain: a single Bun process serves both
the WebSocket API and the web client from one URL, deployed as one Docker image.

## Try it

### → **https://copse.onrender.com**

> Goes live once it's deployed (see [Hosted](#hosted-render--turso)). Opening it
> needs an invite code. The free server sleeps after 15 minutes idle, so the
> first person to open it after a quiet spell waits ~50s for it to wake;
> everyone after that is immediate.

> **First run — operator only, once.** After the server is live, open
> **`https://copse.onrender.com/?bootstrap=YOUR_SECRET`** (replace `YOUR_SECRET`
> with the exact value of the `COPSE_BOOTSTRAP` env var you set in Render). That
> one link creates the first room and makes you the **admin**. You only need it
> once — afterwards you sign in with your passphrase, and you create more rooms
> and share invite links from inside the app. Keep the secret private; anyone
> with it can mint a room.

## What "end-to-end encrypted" means here, honestly

- **The server cannot read your messages.** Every message is encrypted in the
  browser with a per-conversation AES-256-GCM key. The server stores and forwards
  the ciphertext; it has no key to open it.
- **Messages are signed.** Group members share a conversation key, so each message
  is also signed (Ed25519) to prove who actually sent it.
- **Verify your contacts.** The server hands out public keys, so a dishonest server
  *could* try to substitute its own and sit in the middle. Copse shows a **safety
  number** for each direct chat — compare it out of band once and that attack is
  closed.
- **Your account is a passphrase-sealed keypair.** There is no password on the
  server. Signing in proves you hold the private key; a passphrase (stretched with
  scrypt) encrypts that key, and only the *sealed* version is ever stored — so you
  can unlock on any device, and the server still learns nothing.
- **What it does not do:** there is no forward secrecy. If a conversation key is
  ever compromised, that conversation's history is exposed. This is a deliberate
  simplicity trade-off, not an oversight.

If you need Signal's guarantees, use Signal. Copse is a self-hosted tool for a
small trusted group that wants its own chat.

## Accounts, in two flows

- **Sign up** (first time): enter an invite code, pick a username and display name,
  then set a passphrase. Your keypair is generated on the spot and sealed with the
  passphrase.
- **Unlock / Sign in** (returning): on the same device you just enter your
  passphrase; on a new device you enter your username and passphrase, and your
  sealed account is fetched and unlocked locally. You never redo the setup.

**Rooms.** Copse is organised into rooms — each a sealed-off space with its own
people and conversations. You start one by bootstrapping (below); everyone else
joins with an **invite link** (`https://your-copse/?join=CODE`) you share from
inside the room. A member can be in up to 3 rooms (10 people each); the admin — the
account that bootstrapped the server — can create as many rooms as they like.
Invite codes are rotatable, so a leaked link is a one-click fix.

## Running it

You need [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun test            # crypto, protocol, and full server round-trips (both DBs)
bun run typecheck
bun run dev         # client on http://localhost:5173, proxying to the server
```

To run the server the client talks to (a second terminal):

```bash
COPSE_BOOTSTRAP=some-secret bun run serve   # http://localhost:4040
```

Then open `http://localhost:4040/?bootstrap=some-secret` once to create the first
room and become its admin.

### Hosted (Render + Turso)

The server runs on Render's free tier. Because that tier has no persistent disk,
message storage lives in [Turso](https://turso.tech) (hosted libSQL) — which is
safe precisely because Copse only ever writes ciphertext. Create a database,
set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (see `render.yaml`), set
`COPSE_BOOTSTRAP` to any secret, and deploy the blueprint. Then open
`https://your-copse/?bootstrap=THAT_SECRET` once to mint the first room.

> **The free server sleeps** after 15 minutes idle and takes about a minute to
> wake. Copse shows a "waking up…" state rather than looking broken. Flip
> `plan: free` to `plan: starter` in `render.yaml` to keep it always on.

### Offline / same-room (phone hotspot)

No internet needed. One laptop runs the server against a local SQLite file;
everyone else joins over the same Wi-Fi or hotspot.

```bash
COPSE_BOOTSTRAP=some-secret docker compose up -d   # http://<laptop-ip>:4040
```

Leave `TURSO_DATABASE_URL` unset and storage falls back to a local file
automatically. Hotspot mode and hosted mode are separate stores — messages do not
sync between them.

## Layout

```
packages/
  crypto/     all encryption — pure, no I/O, fully tested
  protocol/   wire types shared by client and server
  server/     Hono REST (auth) + Bun WebSocket + storage
  web/        React 19 + Vite + Tailwind client (Verdant theme, light & dark)
```

See [CLAUDE.md](./CLAUDE.md) for the architecture and the rules that keep the
server unable to read anything.

## License

MIT — see [LICENSE](./LICENSE).

An independent project, not affiliated with any messaging service.
