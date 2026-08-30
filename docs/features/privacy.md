# 🔒 Privacy

> Complete documentation for Yo privacy features.

---

## 1. Ghost Mode

> Complete invisibility - others cannot see you're online, typing, or read messages.

### Ghost Levels

| Level | Online Status | Typing Status | Last Seen | Recording |
|-------|-------------|-------------|----------|-----------|
| **🔵 Light** | Hidden | Visible | Hidden | Visible |
| **🟡 Medium** | Hidden | Hidden | Hidden | Visible |
| **🔴 Full** | Hidden | Hidden | Hidden | Hidden |

### Visual Representation

```
Normal Mode:     👤 Online   💬 typing...   Visto às 14:30
Light Mode:     👤 Last seen recently    Visto às 14:30  
Medium Mode:    👤 Last seen recently
Full Mode:     👤 
```

### How to Activate

**Quick Method:**
1. Swipe down from top → Quick Settings
2. Tap 👻 ghost icon
3. Select ghost level

**Settings Method:**
1. Settings → Privacy → Ghost Mode
2. Activate → Choose level

---

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

