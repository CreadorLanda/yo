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

### Modo privado
Um membro entrega a um bot o que lhe é dirigido (comando, menção, resposta ou interação) com `POST /chats/:id/bots/:botId/updates`, num envelope `soc1.` cifrado só para o bot. O servidor descarta as chaves de grupo dirigidas a bots sem `messages.read.all`, e dar, retirar a leitura total ou remover um bot com ela avança a época das chaves.

### Bot API (`/api/bot/v1`, token de bot)
`Authorization: Bot zsb_…`. `GET /me`, publicar chaves, carregar media, `GET /chats/:id/members` (`members.read`), enviar, editar, apagar e reagir a mensagens (`messages.send`). Sem instalação na conversa: `404`; sem a permissão: `403 scope_missing`. `GET /updates?offset=` devolve os envelopes dirigidos ao bot e confirma os anteriores ao `offset` (expiram ao fim de 7 dias). Com leitura total: `GET /chats/:id/messages`. Chaves de grupo do bot: `POST`/`GET /groups/:id/sender-keys`. Limites: 600 pedidos por minuto por bot e 30 escritas por minuto por bot em cada conversa (`429` com `retry_after`).
