---
title: Visão geral
sidebar_position: 1
---

# Visão geral da API

URL base: `https://yo.alexandrelanda.com/api/bot/v1`. Os SDKs cobrem tudo isto. Lê esta página se estiveres a escrever o teu próprio cliente.

## Autenticação

```http
Authorization: Bot zsb_…
```

O dono pode rodar o token na app (o antigo deixa de funcionar logo) ou revogá-lo.

| Erro | Significado |
|---|---|
| `401` | token em falta, revogado ou inválido |
| `403 bot_suspended` | o bot está suspenso (ver [Segurança](../safety.md)) |
| `503 bots_disabled` | os operadores desligaram todos os bots; não tentes de novo |

## Erros

Os erros vêm em JSON: `{"error": "scope_missing", "detail": "…"}`. O `detail` é opcional e serve para pessoas, não para ser interpretado por código.

| Erro | Significado |
|---|---|
| `404 chat_not_found` | o bot não está nessa conversa |
| `403 scope_missing` | a instalação não tem a permissão |
| `400 invalid_e2ee_envelope_for_chat` | o corpo não é um envelope, ou é do tipo errado para a conversa |
| `400 stale_group_epoch` | a chave do grupo mudou; sincroniza as chaves de grupo e cifra de novo |
| `400 invalid_command` | o conjunto de comandos falha uma regra; o `detail` diz qual |

## Limites

| Limite | Valor |
|---|---|
| Pedidos | 600 por minuto por bot |
| Escritas | 30 por minuto por bot em cada conversa |
| Ligações ao gateway | 5 por bot |
| Comandos | 100 por bot, 10 opções cada |
| Resposta de autocompletar | em menos de 3 s, até 25 escolhas |
| Atualizações e eventos por entregar | guardados 7 dias |

Acima de um limite recebes `429 {"error": "rate_limited", "retry_after": N}` e um cabeçalho `Retry-After`. Espera esse tempo; os SDKs fazem-no. Um bot que bate repetidamente no limite de escrita por conversa é [suspenso automaticamente](../safety.md).
