# 0002 — Bots inside end-to-end encrypted chats

**Decided:** 2026-11-24 · **Status:** accepted · **Epic:** #319

ZwoSocial is getting Discord-style bots: slash commands, buttons and forms,
reminders, moderation, automations, and connectors to calendars and task
tools. Every one of those has to read *something* a person wrote. The server
must still never read anything ([encryption](../security/encryption.md)).

This records how both are true at once.

## The constraint, stated plainly

A bot that reads a message has the key to that message. Whoever runs the bot
— us for official bots, a developer for everyone else — can read what the bot
receives. No cryptography changes that; it is what "the bot read it" means.

So the question is never *whether* a bot can read, but **what it receives and
who can see that it does**. The server stays out of it either way.

## Decision

### 1. A bot is a participant, never the server

A bot is an account (`kind = bot`) with an owner and its own device keys: an
identity key, a signed pre-key and one-time pre-keys, published like any
device's. It decrypts on its own machine, with the SDK. There is no
server-side decryption path for bots, official ones included — official bots
run as ordinary bot clients on infrastructure separate from the API, with
their own keys.

### 2. Privacy mode is the default

In privacy mode a bot receives only what is addressed to it:

- a slash command for that bot (`/remind …`);
- a message that @mentions the bot;
- a reply to one of the bot's own messages;
- an interaction with the bot's components (button click, menu pick, form submit).

The sending client detects these and sends **one extra pairwise `soc1.`
envelope to the bot's device**, next to the normal `soc1g.` group message.
The bot is not a holder of the group's sender key, so ordinary group messages
are ciphertext it cannot open — the same position as the server.

Interactions go pairwise to the bot only; the rest of the group never sees
them unless the bot posts a result.

### 3. Full read is an explicit, visible permission

Some bots need everything (content moderation, summaries, keyword triggers).
That is a separate permission, `messages.read.all`:

- only a group admin can grant it, on a consent screen that says in plain
  words "this bot, run by *X*, will be able to read every message in this
  group from now on";
- granting it posts a system message to the whole group and shows a
  persistent badge in the chat header and chat info for as long as it lasts;
- the bot is added to the sender-key distribution like a member, **from the
  next epoch** — it never receives keys for messages sent before the grant;
- revoking it, or removing the bot, forces a new epoch, exactly like a member
  leaving.

### 4. Where bots are not allowed

- **Anonymous chats and anonymous groups** — a bot would see who sent what.
- **Calls** — bots do not join calls in this version.
- **Locked chats** do not show bot previews in notifications or search, the
  same as any other message.
- A bot cannot open a DM with someone who has never talked to it.

### 5. Everything the server does see

The server routes envelopes and stores ciphertext, as for people. In addition
it sees, in plaintext, the metadata that makes bots work:

- that a bot is installed in a chat, by whom, and with which scopes;
- that an envelope went to a bot device (but not what it contains);
- command *names* a bot registered (registration is public by design), not
  the arguments someone typed;
- for scheduled jobs and reminders: the fire time, so it can wake the bot.

Connectors (Google Calendar, Notion, …) send content to the third-party
service and to the connector provider — that is the point of the feature, and
the connect screen says so. It does not touch other chats' encryption.

## Threat model

| Threat | What limits it |
|---|---|
| Malicious or careless bot developer | Privacy mode by default; scopes on a consent screen; verified badge only after review; report and platform-wide kill switch |
| Leaked bot token | Token authenticates API calls only — it is not the bot's decryption key. Rotate/revoke in one tap; rate limits and anomaly suspension |
| Leaked bot device key | Exposes what that bot was sent: in privacy mode, commands and mentions addressed to it; with full read, the group since the grant and until the next rotation. Same blast radius as a compromised member device |
| Rogue admin grants full read | System message and permanent badge — every member sees it and can leave. Admin action is in the group audit log |
| Bot impersonating a person | Bot badge everywhere a name appears; usernames must end in `bot` |
| Spam | Bots cannot cold-DM; per-bot and per-chat rate limits |

## Alternatives rejected

**Server-side bots that read the group.** Simplest to build and what most
messengers do. It makes every group with a bot readable by the server, which
is the one thing [encryption](../security/encryption.md) says never happens.
Same reasoning as [0001](0001-no-whatsapp-bridge.md).

**Full read by default.** Powerful, but turns "this group is end-to-end
encrypted" into "unless someone added a bot", silently. Defaults decide what
most people get; this one would quietly undo the promise.

**Client-side-only bots** (the bot runs inside members' apps). The most
private option, but a bot then runs only while someone has the app open,
third parties cannot ship bots, and schedules and webhooks have nowhere to
live. It may come back later for personal on-device automations.

## Consequences

- The E2E layer gains a routing rule (#322): command/mention/reply/interaction
  → extra pairwise envelope to the bot device.
- The Bot API (#321) and gateway (#323) deliver ciphertext; the SDKs (#329)
  own key storage and decryption so developers do not write crypto.
- The developer docs (#330, #331) explain privacy mode first, before any API.
- Moderation features that need content (#333) are available only with full
  read, and the UI says why.
