---
title: Botões, menus e formulários
sidebar_position: 2
---

# Botões, menus e formulários

Uma resposta pode levar um cartão e filas de botões, menus, um seletor de pessoas ou um formulário. Tudo vai dentro da mensagem cifrada. O servidor não o vê nem o consegue verificar, por isso é a app que o faz: corta o que passar dos limites abaixo.

```ts
await ctx.reply({
  text: 'Almoço?',
  card: { title: 'Almoço da equipa', fields: [{ name: 'Quando', value: '13:00', inline: true }], color: 'success' },
  components: [
    [
      { type: 'button', id: 'yes', label: 'Sim', style: 'primary' },
      { type: 'button', id: 'no', label: 'Não', style: 'secondary' },
      { type: 'button', label: 'Ementa', style: 'link', url: 'https://example.com/menu' },
    ],
    [{ type: 'select', id: 'where', options: [{ label: 'Sushi', value: 'sushi' }, { label: 'Pizza', value: 'pizza' }], max: 1 }],
  ],
});

bot.onInteraction('yes', (ctx) => ctx.reply('Até já!'));
bot.onInteraction('where', (ctx) => ctx.replyPrivately(`Escolheste ${ctx.values}`));
```

## Componentes

| Tipo | Campos | O clique dá ao bot |
|---|---|---|
| `button` | `id`, `label`, `style` (`primary`, `secondary`, `danger`, `link`), `url` para `link` (só https), `disabled` | `componentId` |
| `select` | `id`, `options [{label, value}]`, `max`, `placeholder` | `values`: os valores escolhidos |
| `user_select` | `id`, `max`, `placeholder` | `values`: ids de utilizadores |
| `form` | `id`, `title`, `submit_label`, `fields [{id, label, type: text\|number\|date\|choice, required}]` | `values`: `{campo: valor}` |

Cartão: `title`, `description`, `fields [{name, value, inline}]`, `thumbnail`, `footer` e `color`, que é uma das cores do tema `primary`, `success`, `warning`, `danger` ou `info`.

## Limites

- Até 5 filas, com até 5 botões cada. Um menu ou um formulário ocupa uma fila inteira.
- Até 25 opções, 5 campos de formulário e 10 campos de cartão.
- Etiquetas com até 80 caracteres.
- Os ids seguem `[A-Za-z0-9_:.-]{1,64}` e são únicos na mensagem.
- O texto é simples: nunca HTML nem Markdown.

Depois de `expires_at`, ou com `disabled: true`, os componentes aparecem desativados. Para desligar os botões depois de um clique, edita a mensagem:

```ts
bot.onInteraction('yes', async (ctx) => {
  await ctx.edit(ctx.messageId!, { text: 'Almoço? — respondido ✅' });
});
```

## Respostas privadas

`ctx.replyPrivately(...)` responde só a quem clicou ou escreveu, e a app marca-a com "Só tu vês isto". A resposta é enviada em direto e nunca é guardada. Usa-a para tudo o que for pessoal, por exemplo um erro no que a pessoa escreveu ou os dados dela.
