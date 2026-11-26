---
title: Modo privado e permissões
sidebar_position: 2
---

# Modo privado e permissões

Um bot entra num grupo em **modo privado**. Nesse modo, o bot nunca consegue abrir as mensagens normais do grupo. Recebe só o que lhe é dirigido: comandos, menções, respostas às suas mensagens e cliques nos seus componentes. As apps das pessoas cifram cada um destes num envelope só para o bot.

É o servidor que o garante. As chaves de grupo dirigidas a um bot sem leitura total são descartadas no envio, por isso o bot não consegue decifrar o grupo, mesmo que tente.

## Leitura total

Um admin do grupo pode dar `messages.read.all`, a que a app chama "Deixar ler todas as mensagens". O grupo inteiro é avisado e a época de chaves do grupo avança:

- o bot só recebe chaves a partir daí, nunca o histórico;
- retirar a leitura total, ou remover o bot, avança a época outra vez, e o bot deixa de conseguir ler.

Pede leitura total só se o bot não funcionar sem ela, por exemplo para moderar ou resumir um grupo.

## Permissões

| Permissão | Deixa o bot |
|---|---|
| `messages.read.commands` | receber comandos, menções, respostas e interações (modo privado) |
| `messages.read.all` | ler todas as mensagens (dada por um admin e anunciada) |
| `messages.send` | enviar, editar, apagar e reagir às suas mensagens, e distribuir a sua chave de grupo |
| `members.read` | ver os membros da conversa |
| `members.manage` | gerir membros |
| `events.manage` | gerir os eventos da conversa |

Sem permissões indicadas, o bot é instalado com `messages.read.commands`, `messages.send` e `members.read`. Uma chamada sem a permissão falha com `403 scope_missing`. Uma chamada numa conversa onde o bot não está falha com `404 chat_not_found`.

## Conversas directas

Qualquer pessoa pode abrir uma conversa directa com um bot (**Abrir conversa com o bot**). Aí, o bot lê todas as mensagens, porque cada uma lhe é dirigida. Não é precisa instalação.

Os bots não podem iniciar conversas com pessoas, entrar em chamadas, nem ser adicionados a conversas anónimas.
