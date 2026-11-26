---
title: Eventos — gateway ou webhooks
sidebar_position: 3
---

# Eventos: gateway ou webhooks

Um bot recebe eventos de uma de duas formas: por um websocket que mantém aberto (o **gateway**), ou como POSTs assinados para um endereço (**webhooks**). Ambos levam o mesmo JSON:

```json
{"id": 42, "type": "command.invoked", "chat_id": "…", "data": {"…": "…"}, "created_at": "2026-11-25T12:00:00Z"}
```

Os eventos ficam guardados 7 dias e podem repetir-se depois de uma retoma ou de um webhook reenviado, por isso deduplica pelo `id`. Os SDKs fazem isto por ti.

## Tipos de evento

| Tipo | Quando |
|---|---|
| `message.created` | uma mensagem que o bot pode ler: as suas conversas directas, o que lhe é dirigido, ou todas as do grupo com leitura total |
| `message.updated`, `message.deleted`, `message.reaction` | só bots com leitura total |
| `command.invoked` | alguém usou um dos seus comandos |
| `interaction.created` | alguém clicou num dos seus componentes |
| `command.autocomplete` | alguém está a escrever uma opção que se autocompleta |
| `members.changed` | entraram ou saíram membros (`members.read`) |
| `bot.installed`, `bot.removed` | o bot foi adicionado a um grupo ou removido dele |
| `user.data_deletion` | alguém pediu ao bot que apague os seus dados (ver [Segurança](../safety.md)) |
| `ping` | o evento de teste do dono, sempre entregue |

Os dados de cada evento levam só ids e texto cifrado.

## Gateway

Com o SDK, `bot.start()` (TypeScript) ou `bot.Run(ctx)` (Go) abre o gateway. Envia heartbeats, volta a ligar com espera de 1 s até 30 s, e retoma a partir do último evento que tratou.

O protocolo, em `GET /api/bot/v1/gateway` (websocket, token do bot, até 5 ligações por bot):

| Sentido | Frame |
|---|---|
| servidor → | `{"op":"hello","d":{"heartbeat_interval":30000}}` |
| → servidor | `{"op":"identify","d":{"intents":["command.invoked"],"resume_from":41}}` em menos de 10 s. Sem intents recebe todos. |
| servidor → | os frames `dispatch` em falta, e depois `{"op":"ready","d":{"bot_id":"…","resumed":1}}` |
| servidor → | `{"op":"dispatch","t":"command.invoked","s":42,"d":{…}}` |
| → servidor | `{"op":"heartbeat"}` a cada intervalo, com resposta `{"op":"heartbeat_ack"}` |

Códigos de fecho:

| Código | Significado |
|---|---|
| `4000` | op desconhecido |
| `4001` | não identificado |
| `4002` | intents inválidas (definitivo; não voltes a ligar) |
| `4003` | heartbeat em falta |
| `4008` | ligações a mais |
| `4009` | demasiado lento; retoma a partir do teu último `s` |

## Webhooks

Define o endereço na app (**Os meus bots → o teu bot → Webhook**). Tem de ser `https` num servidor público. O segredo de assinatura só é mostrado uma vez.

Cada entrega é um `POST` com estes cabeçalhos:

- `X-ZwoSocial-Event` e `X-ZwoSocial-Delivery`
- `X-ZwoSocial-Timestamp`, em segundos Unix
- `X-ZwoSocial-Signature: sha256=<hex HMAC-SHA256(segredo, timestamp + "." + corpo)>`

Verifica a assinatura e recusa qualquer timestamp com mais de 5 minutos de diferença do teu relógio. É essa verificação que impede que uma entrega capturada seja repetida. Os SDKs fazem as duas coisas:

```ts
Bun.serve({ port: 3000, fetch: bot.webhook(process.env.WEBHOOK_SECRET!) });
```

```go
http.Handle("/zwosocial", zwosocial.WebhookHandler(secret, func(e zwosocial.Event) error { return bot.Handle(ctx, e) }))
```

Qualquer `2xx` em menos de 10 s conta como entregue, e os redirecionamentos não são seguidos. Uma entrega falhada tenta de novo ao fim de 10 s, 30 s, 2 min, 10 min e 1 h. Depois de 6 tentativas fica marcada como morta. A app mostra as últimas 100 entregas e pode enviar um `ping` de teste.
