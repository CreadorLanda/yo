---
description: 'Cards, buttons, menus, person pickers and forms; their limits; and private replies.'
title: Buttons, menus and forms
sidebar_position: 2
---

# Buttons, menus and forms

A reply can carry a card, plus rows of buttons, menus, a person picker or a form. All of it travels inside the encrypted message. The server cannot see it or check it, so the app does: it trims anything outside the limits below.

```ts
await ctx.reply({
  text: 'Lunch?',
  card: { title: 'Team lunch', fields: [{ name: 'When', value: '13:00', inline: true }], color: 'success' },
  components: [
    [
      { type: 'button', id: 'yes', label: 'Yes', style: 'primary' },
      { type: 'button', id: 'no', label: 'No', style: 'secondary' },
      { type: 'button', label: 'Menu', style: 'link', url: 'https://example.com/menu' },
    ],
    [{ type: 'select', id: 'where', options: [{ label: 'Sushi', value: 'sushi' }, { label: 'Pizza', value: 'pizza' }], max: 1 }],
  ],
});

bot.onInteraction('yes', (ctx) => ctx.reply('See you there!'));
bot.onInteraction('where', (ctx) => ctx.replyPrivately(`You picked ${ctx.values}`));
```

## Components

| Type | Fields | Click gives the bot |
|---|---|---|
| `button` | `id`, `label`, `style` (`primary`, `secondary`, `danger`, `link`), `url` for `link` (https only), `disabled` | `componentId` |
| `select` | `id`, `options [{label, value}]`, `max`, `placeholder` | `values`: the picked values |
| `user_select` | `id`, `max`, `placeholder` | `values`: user ids |
| `form` | `id`, `title`, `submit_label`, `fields [{id, label, type: text\|number\|date\|choice, required}]` | `values`: `{field: value}` |

Card: `title`, `description`, `fields [{name, value, inline}]`, `thumbnail`, `footer`, and `color`, which is one of the theme colours `primary`, `success`, `warning`, `danger` or `info`.

## Limits

- At most 5 rows, with up to 5 buttons each. A menu or a form takes a whole row.
- At most 25 options, 5 form fields and 10 card fields.
- Labels are at most 80 characters.
- Ids match `[A-Za-z0-9_:.-]{1,64}` and are unique within the message.
- Text is plain: never HTML or Markdown.

Past `expires_at`, or with `disabled: true`, the components show as disabled. To turn off the buttons after a click, edit the message:

```ts
bot.onInteraction('yes', async (ctx) => {
  await ctx.edit(ctx.messageId!, { text: 'Lunch? — answered ✅' });
});
```

## Private replies

`ctx.replyPrivately(...)` answers only the person who clicked or typed, and the app labels it "Only you can see this". The reply is pushed live and never stored. Use it for anything personal, for example an error about their input or their own data.
