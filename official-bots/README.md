# Official bots

The bots ZwoSocial runs itself. They are ordinary bots built on the TypeScript SDK (`sdk/typescript`): they have their own keys, decrypt on the machine they run on, and get no shortcut the platform would not give any other bot.

| Bot | Run | Issue |
|---|---|---|
| Reminders and Scheduler | `bun run reminders` | #332 |
| Moderation | `bun run moderation` | #333 |

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
docker run -d -e BOT_TOKEN=zsb_… -v reminders-data:/data zwosocial-reminders              # reminders
docker run -d -e BOT_TOKEN=zsb_… -v moderation-data:/data zwosocial-reminders moderation   # moderation
```

Each bot has its own account, token and data volume.

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

## Moderation

Group admins add it from **Group info → Bots**. What it can do depends on what they grant, and the app says so plainly:

| Granted | What works |
|---|---|
| nothing extra (privacy mode) | welcomes, `/rules`, and `/warn` |
| **Let it moderate members** (`members.manage`) | also `/mute`, `/kick`, `/ban` and `/unban`, and muting newcomers until they accept the rules |
| **Let it read every message** (`messages.read.all`) and moderate | also content filters: links, banned words, flood, repeated messages and slow mode |

Content filters never run without full read, because the bot cannot see the messages. `/mod` shows what is on and, in words, what is missing.

| Command (admins and moderators) | |
|---|---|
| `/mod` | Privately, the settings, with buttons to turn welcomes, rule acceptance, links, repeated messages, flood and the language on or off. |
| `/rules [text]` | Anyone can show the rules; admins set them with `text`. |
| `/warn who [reason]` | Warns someone. Warnings escalate. |
| `/mute who for [reason]` | `for` is `10m`, `2h` or `1d` (1 minute to 30 days). |
| `/unmute who` | |
| `/kick who [reason]` | Removes someone; they can be added back. |
| `/ban who [reason]` | Removes someone and keeps them out until a ban is lifted. |
| `/unban username` | Lifts a ban. |
| `/words add\|remove\|list [word]` | The banned words list. |
| `/slowmode seconds` | Seconds between one person's messages; `0` turns it off. |
| `/modlog [code]` | Sends the group's mod log to another chat. Running it in the group gives a code; running it with that code in the other chat links them. |

### Policies

- **Nobody outranks admins.** The server refuses to moderate admins or moderators, and their messages are never filtered.
- **Escalation.** Warnings in the last 24 hours escalate:
  1. a warning;
  2. a 10-minute mute;
  3. an hour's mute;
  4. removal.

  Slow mode deletes the message but does not count as a warning.
- **Welcomes.** New members get a welcome and, if rules are set, an "I accept the rules" button. With rule acceptance on, newcomers are muted (up to 7 days) until they tap it. Only the newcomer can accept their own welcome.
- **Seen by everyone.** Every mute, removal and ban is a notice in the group and an entry in the group's bot activity, and with a linked log it also appears in the mod log.
- **Data.** The bot never stores message contents. Recent messages are kept in memory only, for a minute, to catch floods and repeats. It stores settings, warnings (kept 30 days), and the people it banned (so `/unban` works by name). A `user.data_deletion` deletes that person's warnings and records.
