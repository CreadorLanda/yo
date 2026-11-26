---
title: Comandos com /
sidebar_position: 1
---

# Comandos com /

Quando alguém escreve `/` numa conversa, a app mostra os comandos dos bots dessa conversa. Um comando com opções abre um pequeno formulário com o seletor certo para cada uma: texto, número, pessoa, data e hora, ou uma lista de escolhas.

## Registar

```ts
await bot.setCommands([
  {
    name: 'remind',
    description: 'Remind me of something later',
    description_pt: 'Lembrar-me de algo mais tarde',
    options: [
      { name: 'when', description: 'When', description_pt: 'Quando', type: 'datetime', required: true },
      { name: 'what', description: 'What to remind you of', description_pt: 'Do que te lembrar', type: 'string', required: true },
    ],
  },
]);
```

```go
bot.SetCommands(ctx, []zwosocial.Command{{
	Name: "remind", Description: "Remind me of something later", DescriptionPT: "Lembrar-me de algo mais tarde",
	Options: []zwosocial.CommandOption{
		{Name: "when", Description: "When", DescriptionPT: "Quando", Type: "datetime", Required: true},
		{Name: "what", Description: "What to remind you of", DescriptionPT: "Do que te lembrar", Type: "string", Required: true},
	},
}})
```

As regras são estas. Um conjunto que falhe alguma é recusado por inteiro com `400 invalid_command`, e o `detail` diz porquê.

- `name` tem de 1 a 32 caracteres de `a-z0-9_-`; uma descrição tem até 100 caracteres.
- Um comando tem até 10 opções, com as obrigatórias primeiro.
- `type` é `string`, `number`, `user`, `datetime` (RFC 3339) ou `choice` (de 1 a 25 `{name, value}`).
- `autocomplete` só é permitido em opções `string` e `number`.
- Um bot tem até 100 comandos.
- `PUT /chats/{id}/commands` define comandos só para uma conversa. Um comando aí substitui o global com o mesmo nome.

## Tratar

```ts
bot.command('remind', (ctx) => {
  const { when, what } = ctx.command!.options; // já separadas
  return ctx.reply(`⏰ ${what} às ${when}`);
});
```

As pessoas enviam um comando como texto, por exemplo `/remind when:2026-12-01T09:00:00Z what:"beber água"`, para que toda a conversa o veja. Quando dois bots têm um comando com o mesmo nome, escreve-se `/remind@reminders_bot`.

O bot recebe a sua cópia como `command.invoked`, já com `command {name, options}` separado. O texto a seguir ao nome do comando vai cifrado para o bot, por isso o servidor nunca o vê.

## Autocompletar

```ts
bot.onAutocomplete('remind', 'what', ({ value }) =>
  ['beber água', 'alongar', 'ligar à mãe'].filter((s) => s.includes(value)).map((s) => ({ name: s, value: s })),
);
```

O que já foi escrito chega ao bot cifrado. O bot tem **3 segundos** para responder com até 25 escolhas. Se não responder, a app fica com o texto livre.
