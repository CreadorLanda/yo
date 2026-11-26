# Official bots

ZwoSocial runs a few bots of its own. They are ordinary bots on the public SDK, with their own keys and in privacy mode unless a group grants more, so they get nothing a third-party bot would not. Code and operations: `official-bots/README.md`.

## Tasks and Standup (#334)

- **`/task`** adds, lists, finishes and assigns tasks. Each one gets a card with **Done** and **I'll take it** buttons, and the bot announces it when it comes due.
- **`/standup`** posts a form of three questions in the group at a set time ("every weekday 9:30"). When the window closes it posts a summary with plans, blockers and who did not answer. Answers are deleted once summarised.
- **`/digest`** sends a weekly round-up on Mondays.

It works in privacy mode and needs no integration. Exporting tasks comes with the connectors (#337).

## Moderation (#333)

- **Welcomes and rules.** It welcomes new members and can keep them muted until they accept the rules.
- **Admin commands.** `/warn`, `/mute`, `/kick` and `/ban`, with warnings escalating from a warning to mutes and then removal.
- **Content filters.** With full read granted it filters links, banned words, floods, repeated messages and slow mode.

It only does what the group's admins grant, and every grant is announced:

- **"Let it moderate members"** lets it mute, remove, ban and delete messages. It never acts on admins or moderators, and the server enforces that.
- **"Let it read every message"** is needed for the content filters. Without it they never run, and `/mod` says so.

Every action is a notice in the group and an entry in its bot activity, and it can also go to a mod log in another chat. Message contents are never stored.

## Reminders and Scheduler (#332)

- `/remind` reminds you, someone in the chat, or the whole chat, once or on repeat. "When" is written in English or Portuguese, for example "amanhã às 9", "in 10 minutes", "every monday 10:00" or "dias úteis às 8h30", or picked in the app.
- `/schedule` posts a message later, once or on repeat.
- `/reminders` privately lists what is scheduled, with a menu to cancel.
- `/timezone` and `/quiet` set each person's time zone and quiet hours.

Behaviour that matters:

- **Privacy mode.** It sees only its own commands and buttons.
- **Restarts.** Jobs survive restarts.
- **Missed runs.** A missed one-off is still delivered, marked late. A missed recurring run is skipped, never backfilled.
- **Quiet hours.** A reminder for a person waits until their quiet hours end. A message to the whole chat does not wait.
- **Time zones.** Times follow each person's time zone, and daylight-saving changes keep the local hour.
