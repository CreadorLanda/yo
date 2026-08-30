# 🔒 Privacy

> Complete documentation for Yo privacy features.

---

## 1. Ghost Mode

One switch over every outbound signal, in **Settings → Privacy → Ghost mode**.

| Signal | With ghost mode on |
|---|---|
| Read receipts | Not sent. Your reads are recorded as *delivered* |
| Typing indicator | Not sent |
| Recording indicator | Not sent |

**Reciprocal**, on the same terms as read receipts (§ below and migration
0029): with it on you neither send these signals nor see anyone else's. A
switch that only hides your own is a way to take without giving.

It is the *wider* switch. Read receipts keep their own setting, but ghost mode
overrides it — turning ghost mode on silences receipts even for someone who
left that setting alone, and it also covers typing and the recording
indicator, which were added later and were never part of it.

### Enforced on the server

Not by asking the client to hide things. Your typing is refused at
`POST /chats/:id/typing`; a ghost is left out of the recipient list of
everybody else's; a `read` receipt is downgraded to `delivered` before it is
stored. A modified client cannot opt back in, which is the only way any of
this means anything.

### What it does not cover

**Presence and last seen.** Not because they are excluded — because they do
not exist. No last-seen value is stored for a user anywhere in this server,
no endpoint serves one, and `online` is hardcoded `false` in the app. There is
no signal there to suppress, and claiming otherwise would be the kind of
promise this page used to make.

Building presence, and then freezing it, is
[#151](https://github.com/CreadorLanda/yo/issues/151).



## 2. App Lock

A code required to open Yo at all, on top of the per-conversation lock in §3.

**There is one code, not two.** The app lock verifies the same secret the chat
lock stores — `data/chat-lock.ts` — because two codes to remember is how people
end up choosing `0000` for both.

| Setting | Values | Default |
|---|---|---|
| Lock the app | on / off | off |
| Lock after | immediately, 1, 5, 15 or 60 minutes in the background | 1 minute |
| Face ID / fingerprint | on / off, only where the device has one enrolled | off |

Turning the lock **off** asks for the code, exactly as turning it on does.
Without that, anyone holding an unlocked phone walks past it by opening
settings and flipping the switch.

### What it protects, and what it does not

The code gates *reaching* the app. Message content is already encrypted at rest
by SQLCipher; this is about the person who picks up your unlocked phone, which
is the threat a lock is actually about.

- The grace period is measured **in the background**, not since launch.
- A device clock that has moved backwards locks rather than unlocks — a lock
  you can walk past by changing the time is not a lock.
- On sign-out the lock re-arms. The code belongs to the device, not the
  account.
- **There is no recovery.** The code is stored as a salted, iterated hash;
  forgetting it means reinstalling.

### Screenshots and the app switcher

Two different holes, with no single fix between them:

- **Android** — `expo-screen-capture` sets `FLAG_SECURE`, which blocks
  screenshots and screen recording, and blanks the task-switcher thumbnail.
- **iOS** — the OS deliberately does not let an app block a screenshot, so
  that half does not exist there. The app-switcher snapshot is handled
  instead by covering the screen on `inactive`, the state iOS passes through
  *before* it takes the picture.

Both apply only while the app lock is on.


## 3. Chat Lock

### Lock a Chat

1. Open conversation
2. Tap conversation name
3. Tap lock icon 🔒
4. Confirm

### Chat Lock Options

| Option | Description |
|--------|-------------|
| **Every time** | Requires auth on every open |
| **When opened** | Once per session |
| **Fingerprint** | Requires fingerprint each time |

### Locked Chat Indicators

```
Normal chat:    💬 Company Team
Locked chat:   🔒 Company Team 👁️
```

---

## 4. Anti-Delete Messages

### What It Does

When enabled, messages are preserved even when the sender tries to delete them.

```
Sender sends:    "Hello!"
Sender deletes:  "This message was deleted"

With Anti-Delete:
Sender sends:    "Hello!"
Sender deletes:  "Hello!" (still visible)
```

### Configuration

```typescript
interface AntiDeleteConfig {
  enabled: boolean;
  duration: 'forever' | '30d' | '90d' | '1y';
  storage: 'local' | 'cloud';
}
```

### Storage Options

| Storage | Pros | Cons |
|--------|------|------|
| **Local** | Free, private | Not synced across devices |
| **Cloud** | Synced | Uses storage quota |

---

## 5. Last Seen Control

### Privacy Options

| Option | Who Can See |
|--------|------------|
| **Everyone** | All Yo users |
| **My contacts** | Only saved contacts |
| **Nobody** | Completely hidden |
| **Custom** | Select specific contacts |

### Configuration Screen

```
Last Seen
├── 👥 Everyone         (o)
├── 📱 My contacts      ( )
├── 🚫 Nobody          ( )
└── ✏️ Custom         [Manage]
```

---

## 6. Biometric Authentication

Via `expo-local-authentication`, on top of the code — never instead of it.

| Platform | What the OS offers |
|----------|--------------------|
| **iOS** | Face ID, Touch ID |
| **Android** | Whatever `BiometricPrompt` exposes: fingerprint, face unlock, iris |

The app is only ever told yes or no. No face or fingerprint data reaches this
process, and none is stored by Yo — the template lives in the Secure Enclave or
the Android TEE and never leaves it. **That is precisely why this is the
operating system's job and not ours:** a face check we built on the selfie
camera would see a flat RGB image, be defeated by a printed photograph, and
require us to store biometric data we have no business holding.

The device passcode is deliberately *not* accepted as a fallback
(`disableDeviceFallback`). The phone's PIN is not this app's code, and letting
it stand in would mean unlocking the phone unlocks Yo. The way past a failed
fingerprint is the app's own code.

The switch is only offered where the device actually has a biometric enrolled;
otherwise the row says so rather than presenting a toggle that cannot do
anything.


## 7. End-to-End Encryption (E2E)

### How It Works

```
Alice sends message: "Hi Bob!"
         ↓
Client encrypts with Bob's public key
         ↓
Server receives: [encrypted blob]
         ↓
Bob receives:  "Hi Bob!" (decrypted with private key)
```

### Security Properties

| Property | Description |
|----------|-------------|
| **E2E Only** | Only sender/recipient can decrypt |
| **Forward Secrecy** | Old keys don't decrypt new messages |
| **Post-Compromise** | Future key compromise doesn't reveal past |
| **Verifiable** | Users can verify keys |

### Verify Encryption

1. Open conversation
2. Tap name → Encryption
3. Compare QR codes (in-person)
4. Or share verification link

---

## 8. Privacy Dashboard

### View Your Privacy

1. Settings → Privacy → Privacy Dashboard
2. See:
   - Devices logged in
   - Data shared
   - Login history
   - Active sessions

### Privacy Score

```
Privacy Score: ████████░░ 80/100

✓ E2E encryption enabled
✓ Ghost mode available
✓ App lock enabled
✓ No unknown devices
```

---

## 9. Data Export

### Export Your Data

1. Settings → Privacy → Download my data
2. Choose format:
   - JSON (structured)
   - HTML (readable)
   - PDF (printable)
3. Select data types:
   - Messages
   - Media
   - Contacts
   - Settings

---

## 10. Delete Account

### Delete Account

1. Settings → Privacy → Delete Account
2. Read warning
3. Confirm with password
4. 30-day grace period
5. All data permanently deleted

### What Happens

| Data | Deleted |
|------|---------|
| Messages | ✅ Permanent |
| Media | ✅ Permanent |
| Profile | ✅ Permanent |
| Username | ✅ Released for reuse |

