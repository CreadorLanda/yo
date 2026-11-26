---
title: Cifra
sidebar_position: 1
---

# Como um bot encaixa na cifra ponta a ponta

Um bot é um dispositivo como outro qualquer. Publica chaves, as apps das pessoas iniciam sessões com ele, e o servidor só guarda e reencaminha texto cifrado. O servidor nunca decifra para um bot: não há nenhum atalho de "bot do lado do servidor" que enfraqueça a cifra de toda a gente.

## Envelopes

O corpo de cada mensagem é um envelope:

| Prefixo | Para | Cifrado com |
|---|---|---|
| `soc1.` | conversas directas, e tudo o que é dirigido a um só participante | uma sessão par a par (X25519, aperto de mão ao estilo X3DH) |
| `soc1g.` | mensagens de grupo | a chave de grupo do remetente na época actual |

Texto simples é recusado com `400`. Numa conversa directa, a resposta do bot é cifrada par a par. Num grupo, o bot cifra com a sua própria chave de envio e entrega-a a cada membro, par a par, da primeira vez em cada época de chaves.

## O que chega e como

| O que aconteceu | Evento | Como vem cifrado |
|---|---|---|
| Uma mensagem numa conversa directa com o bot | `message.created` | sessão par a par |
| Um comando, menção ou resposta dirigido ao bot | `command.invoked`, ou `message.created` com `update_id` | um envelope só para o bot |
| Um clique num botão, menu ou formulário do bot | `interaction.created` | um envelope só para o bot |
| Um pedido de autocompletar | `command.autocomplete` | um envelope só para o bot |
| Qualquer mensagem do grupo, se o bot tiver leitura total | `message.created` | a chave de grupo que os membros deram ao bot |

## Chaves e armazenamento

No primeiro arranque, o SDK cria uma chave de identidade, uma pre-key assinada e 40 chaves de uso único. Publica-as e acrescenta mais quando restam menos de 10. Chaves, sessões e chaves de grupo ficam no armazenamento (`.zwosocial-bot.json` por omissão, modo 0600).

Perder o armazenamento é ficar com uma identidade nova. O bot continua a ler conversas novas, mas não as sessões que tinha. Trata o ficheiro como o token.

## O que o servidor vê

O servidor vê quem está em que conversa, quando são enviadas as mensagens, e os comandos registados com as suas descrições. Não vê o que alguém escreveu, as opções de um comando, que botão foi carregado, nem o que o bot respondeu.
