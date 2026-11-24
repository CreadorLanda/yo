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
