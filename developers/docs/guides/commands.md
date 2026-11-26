---
description: 'Register slash commands with typed options, handle them, and answer autocomplete within 3 seconds.'
title: Slash commands
sidebar_position: 1
---

# Slash commands

When someone types `/` in a chat, the app lists the commands of the bots in that chat. A command with options opens a small form with the right pickers: text, number, person, date and time, or a list of choices.

## Register

```ts
await bot.setCommands([
  {
    name: 'remind',
    description: 'Remind me of something later',
    description_pt: 'Lembrar-me de algo mais tarde',
    options: [
      { name: 'when', description: 'When', type: 'datetime', required: true },
      { name: 'what', description: 'What to remind you of', type: 'string', required: true },
    ],
  },
]);
```

```go
bot.SetCommands(ctx, []zwosocial.Command{{
	Name: "remind", Description: "Remind me of something later", DescriptionPT: "Lembrar-me de algo mais tarde",
	Options: []zwosocial.CommandOption{
		{Name: "when", Description: "When", Type: "datetime", Required: true},
		{Name: "what", Description: "What to remind you of", Type: "string", Required: true},
	},
}})
```

These are the rules. A set that breaks any of them is refused whole with `400 invalid_command`, and the `detail` says why.

- `name` is 1–32 characters from `a-z0-9_-`; a description is at most 100 characters.
- A command has at most 10 options, with the required ones first.
- `type` is `string`, `number`, `user`, `datetime` (RFC 3339) or `choice` (1–25 `{name, value}`).
- `autocomplete` is allowed only on `string` and `number` options.
- A bot has at most 100 commands.
- `PUT /chats/{id}/commands` sets commands for one chat. A command there replaces the global one with the same name.

## Handle

```ts
bot.command('remind', (ctx) => {
  const { when, what } = ctx.command!.options; // already split out
  return ctx.reply(`⏰ ${what} at ${when}`);
});
```

People send a command as text, for example `/remind when:2026-12-01T09:00:00Z what:"drink water"`, so the whole chat sees it. When two bots have a command with the same name, it is written `/remind@reminders_bot`.

The bot receives its copy as `command.invoked`, with `command {name, options}` already parsed. The text after the command name is encrypted for the bot, so the server never sees it.

## Autocomplete

```ts
bot.onAutocomplete('remind', 'what', ({ value }) =>
  ['drink water', 'stretch', 'call mum'].filter((s) => s.includes(value)).map((s) => ({ name: s, value: s })),
);
```

The value typed so far reaches the bot encrypted. The bot has **3 seconds** to answer with up to 25 choices. If it does not, the app keeps the free text.
