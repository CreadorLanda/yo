---
description: 'Point a coding assistant at llms-full.txt and a ready prompt, then check its bot with the end-to-end test.'
title: Build with an LLM
sidebar_position: 5
---

# Build a bot with an LLM

This site publishes itself for language models, following the [llms.txt](https://llmstxt.org) convention:

| File | What it is |
|---|---|
| [`llms.txt`](pathname:///llms.txt) | what the platform is, the rules that matter, and a link to every page as Markdown |
| [`llms-full.txt`](pathname:///llms-full.txt) | every page in one file, the API reference included |
| [`sdk/BOTS.md`](https://github.com/CreadorLanda/yo/blob/dev/sdk/BOTS.md) | a recipe for coding agents: steps, constraints, templates and common mistakes |

Give the assistant `llms-full.txt`, or `BOTS.md` if it works inside the repository, and then ask.

## Prompts to copy

**Reminder bot**

```text
Using the ZwoSocial bot SDK for TypeScript (@zwosocial/bot) and the documentation in llms-full.txt,
write a reminder bot. Command /remind with a datetime option "when" and a string option "what".
At that time, post "⏰ Reminder: <what>" in the same chat. Keep reminders in bot.store so a restart
keeps them, add a Cancel button, and use private replies for errors. Read BOT_TOKEN and API_URL from
the environment.
```

**Poll bot**

```text
With @zwosocial/bot, write a poll bot: /poll question:<text> options:"a, b, c" posts a card with one
button per option. Each person has one vote and can change it; edit the poll message to show the
counts after each vote. Only whoever asked can close it.
```

**Notifier from another service**

```text
With the Go SDK github.com/CreadorLanda/yo/sdk/go, write a bot that receives a signed webhook from
<service> on /hook, verifies the signature, and posts a card with a link button to every chat that
ran /subscribe. Add /unsubscribe. Never log the secrets.
```

## Check what it wrote

The end-to-end test that CI runs on the SDK examples also accepts your bot. A person signs up, talks to the bot, clicks a button and uses a command in a group:

```sh
cd sdk/typescript
E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts ts path/to/bot.ts
```

The test expects the echo behaviour from the templates in `BOTS.md`: `You said: …` with an `again` button, and `/ping` answered with `pong 🏓`. Use it to check that the generated code gets encryption, routing and replies right before you add your own logic.

## What to watch for in generated code

- The token, the webhook secret or message contents written to logs.
- Plain HTTP calls to send messages instead of the SDK, which the API refuses.
- Code that expects every group message while the bot is in privacy mode.
- The store kept in a temporary directory, so the bot loses its keys on every restart.
