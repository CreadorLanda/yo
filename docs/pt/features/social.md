# 🌟 Recursos Sociais

> Documentação completa dos recursos sociais do Yo.

---

## 1. Stories

> Posts temporários que expiram após um tempo definido.

### Visão Geral

| Recurso | Descrição |
|---------|-------------|
| Duração | Padrão 24h, configurável até 3 dias (72h) |
| Tipos de Mídia | Texto, Imagem, Vídeo |
| Visibilidade | Apenas contatos, Público, Personalizado |
| Auto-Corte | Vídeos > 2 minutos são Cortados |

---

### 1.1 Criando Stories

**Criando via App:**

1. Toque na foto do seu perfil (circular, topo)
2. Selecione "Adicionar ao Story"
3. Escolha o tipo:
   - 📷 **Câmera** - Tire foto/vídeo
   - 🖼️ **Galeria** - Selecione da galeria
   - ✏️ **Texto** - Crie story de texto
4. Adicione efeitos (texto, stickers, etc.)
5. Defina duração (opcional)
6. Defina visibilidade (opcional)
7. Toque em "Compartilhar"

---

### 1.2 Duração do Story

| Configuração | Segundos | Horas |
|---------|---------|-------|
| **Padrão** | 86.400 | 24h |
| 1 hora | 3.600 | 1h |
| 6 horas | 21.600 | 6h |
| 12 horas | 43.200 | 12h |
| **24 horas** | 86.400 | 24h |
| **2 dias** | 172.800 | 48h |
| **3 dias** | 259.200 | 72h |

---

### 1.3 Visibilidade do Story

| Tipo | Quem Pode Ver |
|------|-------------|
| **Contatos** | Apenas contatos salvos |
| **Público** | Qualquer pessoa, mesmo não contatos |
| **Personalizado** | Selecione usuários específicos |

**Stories Públicos:**

```
Opções de Visibilidade:
├── 🔒 Apenas Contatos   (padrão)
├── 🌐 Público         (qualquer um pode ver)
└── 👥 Personalizado  [Selecionar usuários]
```

**Ver Stories Públicos:**

```http
GET /api/stories/public
GET /api/stories/public?user_id=xxx
```

---

### 1.4 Auto-Corte de Vídeos

> Vídeos com mais de 2 minutos são automaticamente cortados.

**Como Funciona:**

```
Vídeo Original: 5 minutos (300s)
         ↓
Auto-Corte: Primeiros 2 minutos (120s)
         ↓
Story: Vídeo de 2 minutos
```

**Configuração:**

```typescript
interface AutoCropSettings {
  enabled: boolean;       // padrão: true
  max_duration: number;    // padrão: 120 (2 min)
  trim_start: boolean;     // manter começo
}
```

---

### 1.5 Reações nos Stories

Deixe vários emojis no mesmo story.

**Emojis Suportados:**

```
Padrão:    ❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 😍 👏
Extend:    🙌 💪 🙏 😇 ❤️‍🔥 💯 ⭐ 🌟 ✨ 🆕 😁 😎 🥳
```

O conjunto é fechado — uma reacção fora dele volta como `400 invalid_emoji`.
Duas diferenças são absorvidas em vez de recusadas, porque os teclados não
concordam sobre elas e quem envia não as vê: o selector de variação (`❤` é
guardado como `❤️`) e o tom de pele (`👍🏽` conta como `👍`).

Lê a lista em vez de a fixar no código:

```http
GET /api/stories/reactions
```

```json
{
  "standard": ["❤️", "😂", "..."],
  "extended": ["🙌", "💪", "..."]
}
```

**Reagindo:**

Uma chamada define todo o conjunto de quem reage, substituindo o que tinha
deixado antes. A forma em array é a que se deve enviar; o campo único é o
que os clientes antigos enviam e continua a funcionar.

```http
POST /api/stories/:id/react
{
  "reactions": ["🔥", "❤️", "🎉"]
}
```

```http
POST /api/stories/:id/react
{
  "emoji": "🔥"
}
```

`"reactions": []` retira todas. Um corpo sem nenhum dos campos dá `400` em
vez de limpar, para que um erro do cliente não apague as reacções de alguém.

**Resposta:** o story, com as contagens como ficaram.

```json
{
  "id": "…",
  "reactions": [
    { "emoji": "❤️", "count": 12 },
    { "emoji": "🔥", "count": 5 },
    { "emoji": "🎉", "count": 3 }
  ],
  "my_reactions": ["🔥", "❤️"]
}
```

`reactions` é de todos, das mais movimentadas para as menos. `my_reactions`
é só de quem lê, na ordem em que escolheu — o cliente precisa das duas:
quais os chips a preencher, e qual o tamanho de cada número. Ambas vêm
presentes e vazias, não ausentes, quando ninguém reagiu.

Os mesmos dois campos vêm em `GET /api/stories` e `GET /api/stories/:id`,
logo o feed desenha contagens sem uma segunda chamada.

O autor do story também vê quem deixou o quê, na lista de espectadores:

```http
GET /api/stories/:id/viewers
```

```json
[{ "user_id": "…", "username": "ana", "emojis": ["🔥", "❤️"] }]
```

**Na app:**

1. A barra de reacções fica sob o story
2. Toque nos emojis para adicionar, toque outra vez para retirar
3. O conjunto completo abre a partir da barra

---

### 1.6 Comentários nos Stories

> Comentar nos stories (quando ativado).

**Ativando Comentários:**

```json
{
  "content": "Meu story",
  "allow_comments": true
}
```

**Comentando:**

```http
POST /api/stories/:id/comments
{
  "text": "Incrível! 🔥"
}
```

---

### 1.7 Visualizador de Stories

**Ver Stories:**

```http
GET /api/stories
// Retorna: seus stories + stories de contatos

GET /api/stories/public
// Retorna: stories públicos de qualquer pessoa

GET /api/users/:id/stories
// Retorna: stories de usuário específico
```

---

### 1.8 Análise do Story

**Para Criadores:**

```http
GET /api/stories/:id/insights
```

**Retorna:**

```json
{
  "views": 150,
  "unique_viewers": 120,
  "reactions": {"❤️": 5, "🔥": 3},
  "comments": 2,
  "shares": 10,
  "completion_rate": 0.85,
  "avg_watch_time": "12s"
}
```

---

## 2. Perfis Multi-Identidade

### Criando Perfis

```http
POST /api/profiles
{
  "name": "Perfil Trabalho",
  "bio": "Desenvolvedor na Empresa"
}
```

---

## 3. Status de Música

### Exibir Música Atual

```json
{
  "music_status": {
    "song": "Bohemian Rhapsody",
    "artist": "Queen"
  }
}
```

---

## 4. Mini Apps

### Apps Populares

| App | Descrição |
|-----|-------------|
| 🧮 Calculadora | Cálculos rápidos |
| 📅 Calendário | Eventos e lembretes |
| 📝 Enquetes | Criar enquetes |
| ⏱️ Timer | Cronômetro |
| 💱 Moeda | Conversor de moeda |
| 🎲 Dados | Jogar dados |

---

## 5. Configurações de Privacidade do Story

```typescript
interface StoryPrivacy {
  allow_replies: 'none' | 'contacts' | 'everyone';
  allow_reactions: boolean;
  allow_screenshots: boolean;
}
```
