# Security Policy

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. That opens a thread only the maintainers can read.

There is no security email address yet. When there is one it will be listed
here.

### What helps

- What breaks, and what an attacker gets out of it.
- Steps to reproduce, or a proof of concept.
- Which version or commit you tested.
- Whether it is already public anywhere.

### What to expect

This is a small project — one maintainer and occasional contributors. There is
no paid response window and no bounty. What you will get is an acknowledgement
and an honest answer about whether and when it will be fixed.

If a report is valid and you want credit, you will get it in the fix.

## Scope

**In scope:** the encryption layer (`mobile/data/crypto/`), authentication and
sessions, key exchange and distribution, the message and call paths, media
access control, push notification content, and anything that lets one account
read or act as another.

**Out of scope:** findings against `yo.alexandrelanda.com` that require
credentials you were not given, denial of service by volume, missing security
headers with no demonstrated impact, and reports from automated scanners with
no working proof.

Do not test against the production server with accounts that are not yours.
Run your own instance — `server/deploy/docker` brings one up.

## What ZwoSocial promises, so you know what counts as broken

- Messages are encrypted on the device. The server stores ciphertext it cannot
  read.
- The server never holds, derives or stores private key material or session
  keys. If you find code that does, that is a vulnerability by itself — this
  has happened once already and was removed.
- Push notifications carry no readable message content. The device decrypts and
  builds the notification locally.
- There is no analytics, no telemetry, and no third-party tracking anywhere in
  the app.

A finding that any of these is untrue is a valid report even if you cannot
demonstrate an attack on top of it.

## Known limitations

Stated plainly, so nobody wastes time reporting them as findings:

- The client crypto is a custom X25519 / TweetNaCl construction. It is **not**
  the Signal Protocol and has no Double Ratchet. It has not had an independent
  audit.
- Media, link previews and message metadata are outside the encryption scheme.
- There is no forward secrecy story worth the name yet.
- iOS push does not work at all (issue #116).

These are documented gaps, not secrets. Work on them is welcome.
