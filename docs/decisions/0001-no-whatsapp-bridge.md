# 0001 — No WhatsApp bridge

**Decided:** 2026-08-12 · **Status:** rejected, permanently

`docs/features/whatsapp-bridge.md` described linking a WhatsApp account to ZwoSocial
through [Evolution API](https://github.com/EvolutionAPI/evolution-api) or
mautrix: QR pairing, messages in both directions, contact sync, media transfer.

It will not be built. Three reasons, and the first is enough on its own.

## It cannot be end-to-end encrypted

A bridge has to decrypt. WhatsApp messages arrive encrypted for *your WhatsApp
client*; to show them in ZwoSocial, something has to open them, then re-encrypt for ZwoSocial.
That something is a server.

So the bridge server reads every bridged message in plaintext. There is no
clever way around it — it is what a bridge *is*. ZwoSocial's entire claim is that the
server holds ciphertext it cannot read. A feature whose normal operation
requires a server to read your messages does not sit beside that claim; it
cancels it.

We could ship it with a warning. But the people most likely to want a WhatsApp
bridge are the ones least likely to read a warning about key management, and
"encrypted messenger, except this part, which is not" is how a security promise
becomes noise.

## It asks people to risk their WhatsApp account

Evolution API drives WhatsApp Web through automation. That is against Meta's
terms, and Meta bans accounts for it. Not theoretically — routinely.

The README now says ZwoSocial exists so that nobody has to install a sketchy modified
APK to get the features they want. Shipping a bridge would mean asking those
same people to gamble the account holding their family, their work and their
history, on our integration not being detected this month. Same bargain, new
coat.

## It is a permanent maintenance debt

Unofficial WhatsApp integrations break when WhatsApp changes, which is often.
Every break is an outage in a feature people came to depend on, fixed by
reverse-engineering, on a schedule Meta sets.

## What we do instead

Nothing, on WhatsApp's side. What we *can* do is make leaving easy rather than
make staying bridged possible:

- Sticker import already works, including `.wastickers` bundles.
- Chat history import is a legitimate feature — reading an export the user
  asked WhatsApp for, on their device. That is not a bridge, breaks no terms,
  and needs no server to read anything. If someone wants to build it, open an
  issue.

## For the commercial licence

Worth stating separately: a ToS-violating integration in the codebase is a
liability for anyone buying a commercial licence to ship ZwoSocial in a product. That
is not the reason for this decision, but it is a reason it will not be revisited
quietly later.
