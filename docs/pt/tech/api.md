# 📡 API

## Autenticação

### POST /auth/register
```json
{"phone": "+5511999999999", "password": "123", "display_name": "João"}
```

### POST /auth/login
```json
{"phone": "+5511999999999", "password": "123"}
```

## Usuários

### GET /users/search?q=username
Buscar usuários por username

### PUT /users/me/username
Atualizar configurabilidade do username

## Posts e reels

Posts permanentes no perfil. Um `post` é um carrossel de 1 a 10 fotos ou vídeos; um `reel` é exatamente um vídeo. A media é enviada primeiro com `POST /media/upload` e o post refere-a pelo id.

### POST /posts
Corpo: `kind` (`post` ou `reel`), `caption` (até 2200 caracteres), `visibility` (`contacts`, por omissão, ou `public`), `media_ids` (pela ordem dos slides; têm de ser imagens ou vídeos enviados por quem publica). Devolve `201` com o post e a sua `media`. Publicar retira a media do prazo de expiração dos uploads; apagar o último post que a mostra volta a libertá-la.

### GET /posts?author=&kind=&before=&limit=
Uma página da grelha de um autor, do mais recente para o mais antigo. `author` é um id ou `me` (por omissão). Posts que quem pede não pode ver ficam de fora; um bloqueio em qualquer sentido esconde todos.

### GET /posts/:id
Um post. `404 post_not_found` se não existir ou não puder ser visto.

### DELETE /posts/:id
Só o autor; `204`. Qualquer outra pessoa recebe `404`.

## Bots

Como os bots encaixam na cifra de ponta a ponta está decidido no [ADR 0002](../../decisions/0002-bots-and-e2ee.md): um bot é um participante com chaves próprias e o servidor nunca decifra por ele. Tudo o que um bot envia é um envelope `soc1.`/`soc1g.`, como o cliente de uma pessoa.

### Gerir bots (sessão de utilizador)
`POST /bots` cria um bot (`username` acaba em `bot`) e devolve o token uma única vez; `GET /bots` lista os teus; `PATCH`/`DELETE /bots/:id` só para o dono; `POST /bots/:id/tokens` roda o token (revoga os anteriores); `DELETE /bots/:id/tokens` revoga todos; `POST /bots/:id/dm` abre a conversa direta com o bot.

### Bots numa conversa
`GET /chats/:id/bots` para qualquer membro; `POST`, `PATCH` e `DELETE /chats/:id/bots[/:botId]` só para admins do grupo. Adicionar, remover e ligar ou desligar a leitura total deixam uma mensagem de sistema no grupo. Por omissão um bot recebe `messages.read.commands`, `messages.send` e `members.read`.

Os membros de um grupo trazem `is_bot`, uma conversa direta com um bot traz `peer_is_bot` e as mensagens de um bot trazem `sender_is_bot`, para a app mostrar o distintivo BOT onde quer que o nome apareça. Adicionar, remover e dar ou retirar a leitura total deixam mensagens de sistema `bot:added|removed|read_all:<ator>:<bot>[:on|off]`, que a app mostra na língua de quem lê.

### Modo privado
Um membro entrega a um bot o que lhe é dirigido (comando, menção, resposta ou interação) com `POST /chats/:id/bots/:botId/updates`, num envelope `soc1.` cifrado só para o bot. O servidor descarta as chaves de grupo dirigidas a bots sem `messages.read.all`, e dar, retirar a leitura total ou remover um bot com ela avança a época das chaves.

### Bot API (`/api/bot/v1`, token de bot)
`Authorization: Bot zsb_…`. `GET /me`, publicar chaves, carregar media, `GET /chats/:id/members` (`members.read`), enviar, editar, apagar e reagir a mensagens (`messages.send`). Sem instalação na conversa: `404`; sem a permissão: `403 scope_missing`. `GET /updates?offset=` devolve os envelopes dirigidos ao bot e confirma os anteriores ao `offset` (expiram ao fim de 7 dias). Com leitura total: `GET /chats/:id/messages`. Chaves de grupo do bot: `POST`/`GET /groups/:id/sender-keys`. Limites: 600 pedidos por minuto por bot e 30 escritas por minuto por bot em cada conversa (`429` com `retry_after`).

### Comandos com /
Um bot regista os comandos a que responde com `PUT /api/bot/v1/commands` (globais, até 100) ou `PUT /api/bot/v1/chats/:id/commands` (só numa conversa onde está; substitui o global com o mesmo nome). Qualquer membro vê os comandos dos bots da conversa com `GET /chats/:id/commands`. Cada comando tem `name` (1–32 de `a-z0-9_-`), descrição (até 100 caracteres, com `description_pt` opcional) e até 10 opções (`string`, `number`, `user`, `datetime` em RFC 3339 ou `choice` com 1–25 escolhas; as obrigatórias primeiro). O autocomplete (`POST /chats/:id/bots/:botId/autocomplete`) leva o texto escrito num envelope `soc1.` para o bot, que recebe `command.autocomplete` e responde em 3 s com `POST /api/bot/v1/autocomplete/:request_id`. Um comando é enviado como texto (`/remind when:... what:"..."`, com `@bot` quando dois bots partilham o nome), e o bot em modo privado recebe as opções já separadas em `command.invoked`. O servidor vê o registo e as sugestões do bot, nunca o que a pessoa escreve.

### Segurança
`GET /chats/:id/bots/audit` (admins) devolve a actividade dos bots do grupo; `POST /bots/:id/reactivate` (dono) levanta uma suspensão automática; `POST /bots/:id/forget-me` pede ao bot que apague os dados de quem pede. Um bot suspenso recebe `403 bot_suspended` e `BOTS_DISABLED=true` faz a Bot API responder `503 bots_disabled`. Detalhes e regras para quem desenvolve bots: [Bots: abuso, limites e dados](../security/bots.md).

### Mensagens interactivas
Os cartões, botões, menus e formulários de um bot vão dentro da mensagem cifrada, num corpo `{"zi1": {text, card, components, expires_at}}`. Como o servidor não os vê, é a app que os valida: estilos de botão `primary`, `secondary`, `danger` e `link` (só https, aberto segundo as regras de links da conversa), cores de cartão dos tokens do tema, campos de formulário `text`, `number`, `date` e `choice`, até 5 linhas, 5 botões por linha, 25 opções, 5 campos de formulário e 10 campos de cartão; o resto é descartado e o texto é sempre simples. Depois de `expires_at`, ou com `disabled`, os componentes aparecem desativados. Um clique é uma actualização `interaction` (também numa conversa direta com o bot) com `{v, kind, message_id, component_id, values}`, que o bot recebe como `interaction.created`. `POST /api/bot/v1/chats/:id/ephemeral` (`{user_id, content}`) envia uma resposta que só essa pessoa vê, em direto como `bot.ephemeral`, sem a guardar.

### Eventos: gateway e webhooks
Um bot recebe eventos de duas formas, como no Discord: um websocket que mantém aberto, ou um webhook para onde o servidor faz `POST`. Cada evento fica registado uma vez com um `id` crescente e os dois canais levam o mesmo JSON: `{id, type, chat_id, data, created_at}`.

Tipos (intents): `message.created`, `message.updated`, `message.deleted`, `message.reaction` (só bots com leitura total), `command.invoked`, `interaction.created` (vindos dos envelopes de `/updates`; menções e respostas chegam como `message.created`), `members.changed` (`members.read`), `bot.installed`, `bot.removed` e `ping` (o evento de teste do dono, sempre entregue). Os payloads levam só cifrado e ids. Os eventos guardam-se 7 dias e podem repetir-se (retoma, novas tentativas): o bot descarta duplicados pelo `id`.

**Gateway** — `GET /api/bot/v1/gateway` (websocket, token de bot, sem `Origin`; até 5 ligações por bot). O servidor manda `hello` com `heartbeat_interval`; o bot responde em 10 s com `identify` (`intents`, vazio = todos, e `resume_from` para receber o que perdeu, até 1000); seguem-se os eventos repetidos e `ready`. Cada evento chega como `{"op":"dispatch","t":<tipo>,"s":<id>,"d":<evento>}`; o bot manda `heartbeat` a cada intervalo e recebe `heartbeat_ack`. Códigos de fecho: `4000` op desconhecida, `4001` sem identify, `4002` intents inválidos, `4003` heartbeat em falta, `4008` ligações a mais, `4009` demasiado lento (retomar a partir do último `s`).

**Webhooks** (sessão do dono): `GET`/`PUT`/`DELETE /bots/:id/webhook` (`{url, intents?}`; só `https` para um anfitrião público, recusando endereços privados, loopback e de metadados também depois do DNS; a primeira resposta traz o `secret`, mostrado uma vez), `POST /bots/:id/webhook/secret` roda o segredo, `GET /bots/:id/deliveries` mostra as últimas 100 tentativas e `POST /bots/:id/test-event` envia um `ping`.

Cada entrega é um `POST` com `X-ZwoSocial-Event`, `X-ZwoSocial-Delivery`, `X-ZwoSocial-Timestamp` (segundos unix) e `X-ZwoSocial-Signature: sha256=<hex HMAC-SHA256(segredo, timestamp + "." + corpo)>`. Quem recebe valida a assinatura e recusa timestamps a mais de 5 minutos do seu relógio — é a proteção contra repetição (`bots.VerifySignature` em Go faz as duas coisas). Qualquer `2xx` em 10 s conta como entregue; redirecionamentos não são seguidos. Falhas repetem-se após 10 s, 30 s, 2 min, 10 min e 1 h; ao fim de 6 tentativas a entrega fica morta.
