# 💬 Mensagens

> Documentação completa dos recursos de mensagens do ZwoSocial.

---

## 1. Chat Direto (1:1)

### Enviando Mensagens

```typescript
interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  content_type: 'text' | 'image' | 'video' | 'audio' | 'document';
  created_at: string;
  delivered_at?: string;
  read_at?: string;
}

// Enviar mensagem de texto
const message = await chatService.sendMessage({
  chat_id: 'chat_uuid',
  content: 'Olá! 👋',
  content_type: 'text'
});
```

### Tipos de Mensagem

| Tipo | Descrição | Tamanho Máximo | Suporte |
|------|-------------|----------|---------|
| `text` | Texto simples | 10.000 chars | ✅ |
| `image` | JPEG, PNG, WebP | 25MB | ✅ |
| `video` | MP4,MOV | 100MB | ✅ |
| `audio` | Áudio/Nota de voz | 25MB | ✅ |
| `document` | PDF, ZIP, etc | 100MB | ✅ |
| `location` | Coordenadas GPS | - | ✅ |
| `contact` | Contato vCard | - | ✅ |

### Reações

```
❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 😍 👏 
🙌 💪 🙏 😇 ❤️‍🔥 💯 ⭐ 🌟 ✨ 🆕
```

Para reagir:
1. Toque e segure na mensagem
2. Toque na barra de reações
3. Selecione o emoji

Em canais, o mesmo toque abre um menu flutuante com reações rápidas e a opção **Comentar**.

### Edição de Mensagens

- Editar dentro de **15 minutos** após enviar
- Mostra rótulo "Editado"
- Histórico de edições disponível

### Exclusão de Mensagens

| Opção | Efeito |
|--------|--------|
| **Excluir para mim** | Apenas você não vê |
| **Excluir para todos** | Removido para todos |

---

## 2. Grupos

### Criando um Grupo

1. Toque em "Novo Chat"
2. Selecione "Novo Grupo"
3. Adicione participantes (3-1000)
4. Defina nome do grupo
5. Adicione foto (opcional)
6. Toque em "Criar"

### Cargos no Grupo

| Cargo | Permissões |
|------|-------------|
| **Criador** | Todas permissões, pode excluir grupo |
| **Admin** | Gerenciar membros, alterar configurações |
| **Moderador** | Remover mensagens, silenciar membros |
| **Membro** | Enviar mensagens, reagir |

### Limites do Grupo

| Recurso | Limite |
|----------|-------|
| Membros | 1.000 |
| Admins | 50 |
| Descrição | 500 chars |
| Nome do grupo | 100 chars |
| Foto | 10MB |

---

## 3. Canais

### Criando um Canal

1. Vá para "Canais"
2. Toque em "+"
3. Escolha "Criar Canal"
4. Configure:
   - Nome (obrigatório)
   - Descrição (opcional)
   - Foto (opcional)
   - Público/Privado
5. Toque em "Criar"

### Recursos do Canal

- Transmissão para membros ilimitados
- Modo lento (1 mensagem por X segundos)
- Apenas publicadores aprovados podem enviar (admins ou membros designados)
- Membros podem reagir aos posts (reações são anônimas por padrão)
- Membros podem comentar se aprovados por admins

#### Reações e Comentários do Canal

- Toque e segure um post do canal para abrir um menu flutuante com reações rápidas e **Comentar**.
- Comentários podem ser anônimos ou identificados; o autor escolhe por comentário.
- Comentários anônimos nunca revelam identidade para ninguém (nem admins).
- Postagens continuam limitadas a publicadores aprovados.

---

## 4. Mensagens Agendadas

### Agendar uma Mensagem

1. Escreva sua mensagem
2. Toque e segure o botão enviar
3. Selecione "Agendar"
4. Escolha data e hora
5. Confirme

---

## 5. Indicadores de Status

| Status | Ícone | Significado |
|--------|------|---------|
| ⏳ | Relógio | Enviando |
| ✅ | Check único | Enviado ao servidor |
| 📖 | Check duplo azul | Lido |
| ⚠️ | Aviso | Erro - toque para retry |

---

## 6. Notas de Voz

### Gravando

1. Toque e segure o botão 🎤 microphone
2. Solte para enviar
3. Deslize para cima para cancelar

---

## 7. Busca de Mensagens

Buscar mensagens em um chat:

1. Abra o chat
2. Toque no ícone de busca 🔍
3. Digite a consulta
4. Resultados mostram com contexto
