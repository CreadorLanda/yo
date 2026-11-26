# Official bots

ZwoSocial runs a few bots of its own. They are ordinary bots on the public SDK, with their own keys and in privacy mode unless a group grants more, so they get nothing a third-party bot would not. Code and operations: `official-bots/README.md`.

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
