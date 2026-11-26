# Official bots

The bots ZwoSocial runs itself. They are ordinary bots built on the TypeScript SDK (`sdk/typescript`): they have their own keys, decrypt on the machine they run on, and get no shortcut the platform would not give any other bot.

| Bot | Run | Issue |
|---|---|---|
| Reminders and Scheduler | `bun run reminders` | #332 |

## Running

1. Create the bot account in the app (**Settings → Developer → My bots**) and copy its token.
2. Run the bot:

   ```sh
   bun install
   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com DATA_DIR=/var/lib/zwosocial/reminders bun run reminders
   ```

`DATA_DIR` holds the bot's keys and its database, so it must be on a persistent volume. Losing it means losing every session and every scheduled job. Back it up like any other secret.

| Variable | Default | |
|---|---|---|
| `BOT_TOKEN` | — | the bot's token |
| `API_URL` | `https://yo.alexandrelanda.com` | |
| `DATA_DIR` | `./data` | keys (`reminders-bot.json`) and jobs (`reminders.db`, SQLite) |
| `DEFAULT_TZ` | `UTC` | for people who have not set `/timezone` |
| `DEFAULT_LANG` | `en` | replies before someone's language is known (`en` or `pt`) |

With Docker, from the repository root:

```sh
docker build -f official-bots/Dockerfile -t zwosocial-reminders .
docker run -d -e BOT_TOKEN=zsb_… -v reminders-data:/data zwosocial-reminders
```

## Reminders and Scheduler

| Command | |
|---|---|
| `/remind when what [who]` | Remind yourself, or someone in the chat, once or on repeat. Without the form: `/remind me amanhã às 9 regar as plantas`, `/remind @rui in 10 minutes call back`, `/remind here every monday 10:00 standup`. |
| `/schedule when message` | Post a message here later, once or on repeat, exactly as written. |
| `/reminders` | Privately, what is scheduled here (yours; group admins see everything), with a menu to cancel. |
| `/timezone zone` | Your time zone, e.g. `Africa/Luanda`. The option autocompletes. |
| `/quiet from to` | Quiet hours, such as `22:00`–`08:00`; `/quiet off` turns them off. |

"When" can be written in English or Portuguese:

- `amanhã às 9`, `tomorrow at 9am`
- `daqui a 10 minutos`, `in 2 hours`, `10m`
- `sexta às 18:00`, `next friday 6pm`
- `3 de dezembro às 14h`, `3/12 14:00`, `2026-12-24 20:00`
- `todas as segundas às 10:00`, `every weekday at 8:30`, `todo dia 1 às 10h`

The value can also be an instant from the app's date picker. A time the bot cannot read is answered privately and never guessed. While you type, autocomplete shows the time the bot understood.

Replies follow the language of the time you wrote, and the bot remembers it per person. Every reminder card has a **Cancel** button. It works for whoever set the reminder, the person it is for, and group admins.

### Policies

- **Privacy mode.** The bot only ever sees its own commands and clicks on its buttons. It needs no full read.
- **Restarts.** Jobs live in SQLite and survive restarts. On start, the bot delivers whatever came due while it was down.
- **Missed runs.**
  - A one-off reminder is always delivered once. If it is more than 5 minutes late it says so: "(late — it was due …)".
  - A recurring job whose run was missed by more than an hour skips that run and moves to its next time. Runs are never backfilled.
- **Quiet hours.** A reminder for a person waits until their quiet hours end, once per run. A message to the whole chat (`here`, `/schedule`) is not held back for anyone's quiet hours.
- **Time zones.** Times are read and repeated in the time zone of the person who set them, and daylight-saving changes keep the local hour. A rule for the 31st fires on the last day of shorter months.
- **Limits.** Each person can have at most 50 pending jobs across all chats.
- **Data.** Jobs hold only what is needed to send them. A `user.data_deletion` deletes everything set by or for that person, and removing the bot from a chat deletes that chat's jobs.
