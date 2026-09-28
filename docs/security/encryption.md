# 🔐 Encryption

> Security-first messaging means **the server can't read messages, even if compromised.** Three layers — in transit, end-to-end, at rest — work together so this holds in practice, not just in slides.

---

## In transit

- TLS 1.3 only. TLS 1.2 disabled.
- Certificate pinning on mobile clients (rotation handled via a signed update channel).
- HSTS + Strict-Transport-Security with preload on web origins.

---

## End-to-end (custom X25519 / TweetNaCl)

> **This is not the Signal Protocol.** An earlier version of this document said
> it was, and said the project used libsignal. Neither was ever true —
> `libsignal` appears in no manifest, on the client or the server. What follows
> describes what the code does.

Encryption happens on the device with [TweetNaCl](https://tweetnacl.js.org/)
(`mobile/data/crypto/`). The server stores the resulting ciphertext and holds
no client-side E2EE keys. A separate, optional server-side `MESSAGE_KEY` layer
is described under [At rest](#at-rest); it is not an E2EE key.

### Keys

| Key type          | Lifetime              | Purpose                                        |
|-------------------|-----------------------|------------------------------------------------|
| Identity key      | Long-lived per device | Pins the device identity                       |
| Signed pre-key    | Uploaded per device   | Lets a peer start a session while you are offline |
| One-time pre-keys | Batched, single-use   | Consumed at session start                      |
| Group sender key  | Per group, per epoch  | Fan-out after pairwise distribution            |

### Envelopes

Two wire formats, both `prefix.header.body` with base64url parts:

- `soc1.` — direct. Header carries `v`, `ik` (sender identity), `n` (counter),
  plus handshake fields on the first messages.
- `soc1g.` — group. Header carries `v`, `s` (sender UUID), `e` (epoch), `n`.

The server validates the **shape only** — it never opens the body, derives a
key, or checks a MAC.

### What this construction does not give you

Stated plainly, because the previous version of this page claimed all three:

- **No Double Ratchet.** There is a monotonic send counter the code calls a
  "simple ratchet". It orders messages and detects replays. It does not rekey
  per message.
- **No forward secrecy** worth the name. Compromising a device's long-term key
  exposes past messages that device can still decrypt.
- **No post-compromise security.** There is no mechanism that heals a session
  after a key leak.

### Not audited

No independent review has been done. The construction was written for this
project. If you need the properties Signal gives you, use Signal — this is an
honest messenger, not an equivalent one.

Improving this is [tracked work](https://github.com/CreadorLanda/yo/issues),
not a settled state.

## At rest

### On the server

- **Postgres data files:** host or provider-level disk encryption has not been verified. Do not assume it is enabled.
- **Push tokens:** `push_devices.token` is stored as plaintext. The older `devices.push_token_enc` column is not used by the notification code.
- **Session tokens:** access and refresh tokens are stored as SHA-256 hashes in `sessions.token_hash` and `sessions.refresh_hash`; the original bearer tokens are not stored there.
- **Message content:** when a valid 32-byte `MESSAGE_KEY` is configured, the server adds AES-256-GCM encryption to message content. This key is read from the server environment; it is not held in KMS or Vault. If the key is missing or invalid, the repository falls back to storing message content as received. This server-side layer is separate from client-side end-to-end encryption and does not protect data from a server compromise.
- **Media files:** the server does not encrypt uploaded files with per-file keys. Files already encrypted by the client before upload remain ciphertext; other uploads are stored as received.
- **Backups:** this repository has no automated backup or backup-encryption pipeline. Backup encryption and retention must not be assumed.

### On the device

- The SQLite database is wrapped by **SQLCipher** (AES-256-CBC, page-level).
- The DB key is generated once on first launch (256-bit), then wrapped by the OS keychain:
  - iOS: Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
  - Android: Keystore (StrongBox where available), AES-GCM wrap.
  - macOS / Windows / Linux: Keychain / DPAPI / libsecret.
- App startup unlocks the keychain item (optionally gated by biometrics) and opens the DB.
- Detailed schema and lifecycle in [local-storage.md](../tech/local-storage.md).

---

## Authentication & sessions

- Phone-number based, with one-time codes delivered over SMS.
- Codes are 6 digits, rate-limited per phone and per IP, expire in 5 minutes, single-use.
- On success: JWT access token (short-lived, e.g. 15 minutes) + opaque refresh token (rotated on every use, family-tracked to detect theft).
- Session tokens stored hashed on the server (`SHA-256`); only the bearer holds the original.
- Logout invalidates the refresh family.

---

## Bridges

There are none, and there will not be. A bridge has to decrypt to translate,
which puts a server in a position to read messages — the one thing this
document says never happens.

The rejected WhatsApp bridge and the full reasoning are in
[decisions/0001](../decisions/0001-no-whatsapp-bridge.md).

---

## Key rotation

| Material                   | Rotation                           |
|----------------------------|------------------------------------|
| Identity key (device)      | Lifetime of the device             |
| Signed pre-key             | Every 7 days                       |
| One-time pre-keys          | Continuously consumed; client tops up when low |
| Session keys               | Not rotated per message — see above |
| Refresh tokens             | On every use                       |
| `MESSAGE_KEY` (server-side message layer) | No automated rotation process is documented; rotation needs a migration plan |
| TLS certificates           | 90 days (ACME automated)           |

---

## What is *not* protected

We say this aloud so it doesn't surprise anyone:

- **Metadata.** The server sees who messages whom and when. Sealed-sender style mitigations are tracked as a follow-up.
- **A compromised device while unlocked.** Anyone holding the unlocked phone can read everything; SQLCipher cannot defend against that.
- **Server-side data at rest.** Push tokens are plaintext. The server's `MESSAGE_KEY` is an environment secret, not a KMS/Vault-managed key, and the server can read data protected only by it. Host disk encryption and encrypted backups have not been verified.
- **Media outside encrypted chat uploads.** The server stores uploaded bytes as received; only files encrypted on the client before upload remain unreadable to it.

Do not infer a protection that is not stated here. If a data path is unclear, treat it as unprotected until its implementation is verified.
