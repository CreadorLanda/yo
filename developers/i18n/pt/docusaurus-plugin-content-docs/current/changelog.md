---
title: Changelog
sidebar_position: 6
---

# Changelog

## Bot API v1

- **SDKs:** `@zwosocial/bot` (TypeScript) e `github.com/CreadorLanda/yo/sdk/go`. Ambos têm exemplos, e um teste de ponta a ponta corre-os contra um servidor real.
- **`GET /chats/{id}`** diz a um bot se uma conversa é directa ou de grupo. Os bots passam também a receber `message.created` das suas conversas directas.
- **Segurança:** suspensão automática, botão de paragem dos operadores, registo de actividade de bots no grupo e `user.data_deletion`.
- **Mensagens interactivas:** cartões, botões, menus, seletores de pessoas, formulários e respostas privadas.
- **Comandos com /:** opções, conjuntos por conversa e autocompletar.
- **Eventos:** gateway por websocket com retoma, e webhooks assinados com novas tentativas.
- **Base:** contas e tokens de bot, modo privado garantido pelo servidor, e a Bot API principal.
