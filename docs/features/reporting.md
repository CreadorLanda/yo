# 🚩 Reporting & No-Contact Period

> How a chat report carries evidence, who is told, and how the 24-hour no-contact period works.

---

## Overview

| Step | What happens |
|------|--------------|
| Report | Reason, optional note, optional messages chosen by the reporter |
| Consent | Messages are sent only after an explicit agreement |
| Pause | A 24-hour no-contact period starts for both people |
| Notice | Both people get the same neutral notice |
| Review | A moderator reviews the report and the evidence |

---

## 1. Evidence with consent

Chats are end-to-end encrypted, so the server cannot read them. Evidence is therefore a
**copy sent by the reporter**: the app decrypts the chosen messages on the phone and
uploads them with the report.

- Nothing is sent unless the reporter picks messages **and** turns on the agreement.
- Up to 20 messages per report, none of them chosen for the reporter.
- The server cannot verify a copy. Moderators treat it as the reporter's account of the conversation.
- Evidence lives in its own table, is never returned by any user endpoint, and is deleted after **90 days**.
- Without consent the server rejects a report that carries messages (`consent_required`).

## 2. The no-contact period

When a direct chat is reported, the server records a 24-hour period for the pair.

- It applies in **both directions**: messages, new chats and calls are refused with `no_contact_period`.
- It is **separate from blocking**. Unblocking does not lift it.
- A **repeat report never extends** an active period, so a report cannot be used to keep someone silenced.
- It ends by itself. The app re-enables the composer at the exact moment it expires.
- Groups get no period. A report in a group only reaches moderation.

## 3. What each person sees

Both people see the same banner, **Conversation paused**, with the time left. It does not say
who reported or why. The reporter also gets a confirmation that lists what was sent.

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/chats/:id/report` | File a report (reason, note, `block`, `consent`, `evidence`) |
| `GET /api/chats/:id/no-contact` | `{ "until": <RFC 3339 or null> }` for the caller |

Realtime: `chat.no_contact` with `{ chat_id, until }` goes to both people when a period starts.
