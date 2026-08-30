# Yo 💬

> The freedom of a modded messenger, without having to trust a stranger's APK.

![Yo](./assets/banner.png)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Commercial licence](https://img.shields.io/badge/Commercial-available-green.svg)](./LICENSING.md)
[![Version](https://img.shields.io/badge/version-0.1.0--alpha-red)](https://github.com/CreadorLanda/yo)
[![Go](https://img.shields.io/badge/Go-1.26-blue)](https://go.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-Expo%20SDK%2054-blue)](https://reactnative.dev/)

---

## Why this exists

Anyone who used GB WhatsApp, WhatsApp Plus or FM WhatsApp knows the feeling.
You could freeze your last seen. Read a message without the ticks turning blue.
Keep something the sender deleted. Lock a single conversation. Change how the
whole thing looked. Anyone who was on MSN with Messenger Plus! remembers nudges,
winks, and sounds that fired when a particular person typed your name.

The official apps could have shipped every one of those. They chose not to, and
they still choose not to. So people went and installed a modified APK from a
forum.

**And paid for it.** Those mods are closed source. You install a binary nobody
can read, from a stranger, and hand it every message you will ever send. Some
of them shipped spyware outright. Others were fine until an update was not. You
cannot check, because the source was never there to check. Messenger Plus! came
bundled with adware for years. WhatsApp bans the accounts that use the mods,
which tells you nothing about whether the mod was safe — only that it was
unauthorised.

The features were never the problem. **The deal was.** You had to choose
between an app that respected you and an app that let you do things.

Yo is that choice removed. Ghost mode, freeze last seen, anti-delete, chat lock,
themes, nudges — the features people install sketchy APKs to get — built into a
messenger whose source you can read, whose messages are encrypted on your
device, and which will never ship analytics, telemetry or tracking of any kind.

That last part is a rule, not a mood. [CONTRIBUTING.md](./CONTRIBUTING.md#security-rules)
rejects any pull request that adds one, and says so before anyone writes a line.

Not everything on that list exists yet — the [issues](https://github.com/CreadorLanda/yo/issues)
say honestly which do.

---

## What it is

A messenger where messages are encrypted on your device and the server stores
ciphertext it cannot read. Groups, channels, stories, voice and video calls,
stickers, and a game to play in a group chat.

It is **alpha**. Android works end to end. iOS does not have push yet
([#116](https://github.com/CreadorLanda/yo/issues/116)). Some screens are
built on top of nothing real, and those are labelled
[`mock`](https://github.com/CreadorLanda/yo/labels/mock) in the issues
rather than described as finished here.

---

## Quick start

Requires [Bun](https://bun.sh), [Go 1.26+](https://go.dev), and Docker.

```bash
git clone https://github.com/CreadorLanda/yo.git
cd yo

# Server: Postgres, Redis and LiveKit
cd server/deploy/docker && docker compose up -d
cd ../.. && migrate -path migrations -database "$POSTGRES_URL" up
go run ./cmd/api

# Mobile
cd ../mobile
bun install
bunx expo start
```

The app needs a development build, not Expo Go — it uses native modules
(SQLCipher, WebRTC, VisionCamera, Skia) that Expo Go does not carry.

---

## Structure

```
yo/
├── mobile/     React Native + Expo app
├── server/     Go API, WebSocket hub, push worker
├── docs/       Architecture, security, design system
├── scripts/
└── assets/
```

---

## Stack

| Layer | What |
|---|---|
| Mobile | React Native, Expo SDK 54, TypeScript, Reanimated, Skia |
| Server | Go, Gin |
| Storage | PostgreSQL, Redis |
| Local storage | SQLite via SQLCipher |
| Real time | WebSockets |
| Calls | WebRTC via LiveKit |
| Push | FCM |

---

## Security

Messages are encrypted on the device with X25519 / TweetNaCl. The server holds
ciphertext and cannot read it. Push notifications carry no readable content —
the device decrypts and builds the notification locally.

There is **no analytics, no telemetry, and no third-party tracking** anywhere in
the app. That is a rule, not a current state:
[CONTRIBUTING.md](./CONTRIBUTING.md#security-rules) rejects any pull request
that adds one.

**Stated plainly**, because a messenger that oversells its security is worse
than one that admits its limits:

- The crypto is a **custom construction**, not the Signal Protocol. No Double
  Ratchet. **No independent audit.**
- Media, link previews and message metadata sit outside the encryption scheme.
- Forward secrecy is not meaningfully implemented yet.

See [SECURITY.md](./SECURITY.md) to report something.

---

## What works today

**Messaging** — direct and group chats, channels, replies, reactions, editing,
scheduling, disappearing messages, view-once, polls, forwarding, archive, pin,
mute, search, blocking.

**Media** — photos, video, voice notes, documents, location, stickers
(including `.wastickers` import), an editor with crop, draw and text, and
filters that are baked into the file rather than shown over it.

**Stories** — photo, video, text and audio, with polls and questions,
close-friends and custom audiences, anonymous posting, viewers and replies.

**Calls** — one to one and group, audio and video, adding people to a call
without turning the chat into a group, live broadcasts.

**Games** — Truth or Dare, playable in a group.

**Privacy** — per-chat lock with a code, last-seen and photo visibility,
read receipts, directional blocking, account deletion that actually deletes.

Of the mod features named at the top, **chat lock**, **app lock** and
**themes that survive a restart** now work. App lock takes a code and,
where the device has one, a fingerprint or Face ID — the code is the same
one chat lock uses, and the biometric check is the operating system's, so
no face or fingerprint data is ever stored by Yo.

Still open: ghost mode and freeze last seen
([#122](https://github.com/CreadorLanda/yo/issues/122)), anti-delete
([#123](https://github.com/CreadorLanda/yo/issues/123)), and nudges and
winks ([#126](https://github.com/CreadorLanda/yo/issues/126)). The issues
say so rather than this page pretending otherwise.

---

## Roadmap

| Phase | Focus | State |
|---|---|---|
| 1 | Messaging core, auth, real-time, E2EE | done |
| 2 | Calls, stories, channels, lives, games | done |
| 3 | Offline outbox, themes that persist, iOS | in progress |
| 4 | Communities, badges, AI, mini apps | planned |

Everything planned is an [issue](https://github.com/CreadorLanda/yo/issues).
What blocks a first release is labelled
[`mvp`](https://github.com/CreadorLanda/yo/labels/mvp).

---

## Contributing

Pull requests go to **`dev`**, never to `main`. Read
[CONTRIBUTING.md](./CONTRIBUTING.md) first — it covers the branch flow, the CLA
you agree to by opening a pull request, and the security rules that get code
rejected.

Start with a [`good first issue`](https://github.com/CreadorLanda/yo/labels/good%20first%20issue).
They are picked so the answer already exists somewhere in the codebase.

---

## Licence

Dual-licensed. **[AGPL-3.0](./LICENSE)** for everyone, and a **commercial
licence** for anyone who wants to keep their source closed.

The AGPL does not stop you selling Yo or building a business on it. What it
asks is that the source stays open — including when you run a modified version
as a network service, which is why this is AGPL and not GPL.

If you want to ship something closed, or take parts of Yo into a proprietary
codebase, you need the commercial licence. See
[LICENSING.md](./LICENSING.md) for how to ask.

---

## Philosophy

The mods were right about what people wanted and wrong about what it should
cost them.

Yo is not a clone of WhatsApp and not a clone of the mods. It is the argument
those mods were making — that a messenger should bend to the person using it —
carried out by someone willing to show the source.

Freedom, control and customisation. Without lying to you about what is
protected, and without asking you to install a binary you cannot read.

---

<p align="center">
  <strong>Yo</strong><br>
  <em>More than messaging.</em>
</p>
