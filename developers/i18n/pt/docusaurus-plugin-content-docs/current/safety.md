---
title: Segurança e regras de dados
sidebar_position: 5
---

# Segurança e regras de dados

## Regras para quem desenvolve bots

Estas são as condições para correr um bot no ZwoSocial:

1. **Cumpre um `user.data_deletion` em 30 dias.** Apaga as mensagens da pessoa, os seus identificadores e tudo o que derivou deles, incluindo as cópias de segurança quando forem rodadas.
2. **Guarda só o que o bot precisa** para fazer o que a descrição diz, e diz na descrição o que guardas.
3. **Não guardes o conteúdo das mensagens mais de 90 dias,** a menos que a pessoa tenha pedido ao bot para o guardar (uma nota, ou um lembrete para o ano que vem).
4. **Nunca vendas nem partilhes** o que as pessoas enviam a um bot, e nunca o uses para treinar modelos sem o consentimento explícito delas.
5. **Pede leitura total só quando o bot não funciona sem ela.** O grupo é avisado quando é dada.
6. **Protege o token e o segredo do webhook** como palavras-passe, e roda-os se vazarem. Nunca os registes em logs, nem o conteúdo das mensagens.

Um bot que quebre estas regras é suspenso pelos operadores.

As respostas sobre os dados de alguém, ou os erros no que a pessoa escreveu, vão numa resposta privada (`replyPrivately`), não no grupo.

## Pedidos para apagar dados

Qualquer pessoa que partilhe uma conversa com um bot pode pedir-lhe que apague o que guarda sobre ela. O bot recebe então `user.data_deletion` com `reason: "requested"`.

Apagar uma conta envia o mesmo evento, com `reason: "account_deleted"`, a todos os bots com quem a pessoa partilhava conversas, antes de a conta desaparecer.

```ts
bot.on('user.data_deletion', async (e) => {
  const { user_id, reason } = e.data as { user_id: string; reason: 'requested' | 'account_deleted' };
  await forgetEverythingAbout(user_id);
});
```

## Suspensão automática

O servidor não consegue ler o que um bot envia, por isso julga o comportamento e não o conteúdo. Um bot que bate no limite de escrita por conversa **5 vezes em 10 minutos** é suspenso:

- o token deixa de funcionar (`403 bot_suspended`) e o bot não pode ser adicionado a conversas;
- cada grupo onde está regista a suspensão na sua actividade de bots;
- o dono é avisado e vê a suspensão em **Os meus bots**.

Depois de corrigida a causa, o dono pode levantar uma suspensão automática em **Os meus bots**. Uma suspensão feita pelos operadores só eles a podem levantar.

## Botão de paragem

Os operadores podem parar todos os bots de uma vez. A Bot API passa a responder `503 bots_disabled`, e nenhum bot pode ser adicionado a uma conversa. As conversas das pessoas continuam a funcionar.

## O que os admins de grupo vêem

Os admins de grupo vêem o que aconteceu com bots no grupo (**Informação do grupo → Bots → Actividade dos bots**):

- bots adicionados e removidos
- leitura total dada ou retirada, e outras mudanças de permissões
- suspensões
- comandos que os admins usaram

O registo guarda quem fez o quê e quando, nunca o que alguém escreveu. Fica guardado **um ano**.
