# 💬 Detalhes de Mensagens

> Documentação completa para todos os recursos de mensagens e detalhes pequenos.

---

## 1. Filtros de Mensagens

| Filtro | Ícone | Descrição |
|--------|------|-------------|
| Todas | 💬 | Todas as mensagens |
| Não lidas | 🔵 | Mensagens não lidas |
| Favoritas | ⭐ | Mensagens favoritadas |
| Mídia | 🖼️ | Apenas mídia |
| Documentos | 📄 | Apenas documentos |
| Links | 🔗 | Apenas links |
| Áudio | 🎵 | Notas de voz, áudio |

---

## 2. Opções de Mensagens

### Menu ao Segurar

| Ação | Descrição |
|--------|-------------|
| Responder | Responder à mensagem específica |
| Copiar | Copiar texto |
| Encaminhar | Encaminhar para outro chat |
| Favoritar | Adicionar aos favoritos |
| Reagir | Adicionar reação |
| Excluir | Excluir mensagem |

As ações da mensagem aparecem ao manter a mensagem pressionada. Deslizar a mensagem para a direita responde a essa mensagem.

---

## 3. Envio de Mídia

### Tipos de Mídia

| Tipo | Tamanho Máx | Formatos |
|------|---------|--------|
| Imagem | 25MB | JPEG, PNG, WebP, GIF |
| Vídeo | 100MB | MP4, MOV, AVI |
| Áudio | 25MB | MP3, WAV, M4A |
| Documento | 100MB | PDF, DOC, ZIP |
| Nota de Voz | 25MB | M4A |

### Área de Mídia

```
📷 Câmera     → Tirar foto/vídeo
🖼️ Galeria   → Selecionar do dispositivo
🎤 Voz       → Nota de voz
📍 Localização  → Enviar localização
👤 Contato   → Enviar contato
📄 Documento  → Anexar arquivo
```

---

## 4. Suporte a Stickers

### Compatibilidade WhatsApp

**Importar do WhatsApp:**
- ✅ Importar arquivos .wasticker
- ✅ Importar da mídia do WhatsApp
- ✅ Usar sem conversão

**Exportar:**
- ✅ Exportar como .wasticker
- ✅ Exportar como PNG pack
- ✅ Compartilhar com outros apps

---

## 5.Entrada de Mensagem

### Menu de Entrada (Segurar)

```
📷 Mídia
🎤 Voz
📍 Localização
👤 Contato
📄 Documento
🎭 Sticker
```

---

## 6. Bolhas de Mensagem

### Estilos de Bolhas

| Estilo | Descrição |
|-------|-------------|
| Padrão | Estilo WhatsApp padrão |
| Compacto | Menos espaçamento |
| Bolha | Cantos arredondados |
| Quadrado | Cantos retos |
| Mínimo | Apenas texto |

---

## 7. Pré-visualização de Links

### Como funciona

- Enquanto a mensagem é escrita, o dispositivo de quem envia lê a página do primeiro link e mostra um cartão por cima do compositor: miniatura, site, título e descrição. O **X** envia a mensagem sem ele.
- O cartão viaja **dentro da mensagem cifrada de ponta a ponta**, junto ao texto. O servidor nunca sabe que a mensagem tinha um link, e quem recebe nunca vai à página para desenhar o cartão.
- A miniatura é reduzida no dispositivo de quem envia para um JPEG pequeno (no máximo 32 KB) e enviada como data URI.
- O envio nunca espera pela página: se o cartão ainda estiver a carregar, a mensagem vai sem ele.
- Não se cria cartão em conversas com **Confirmar antes de abrir links**, porque ler a página seria abri-la. Editar uma mensagem mantém o cartão enquanto o link continuar no texto.
- Tocar no cartão abre o link no browser da app (ver o browser da app, #348); no Android a página começa a carregar logo ao pressionar.

### Formato do corpo

Uma mensagem de texto sem cartão é o próprio texto. Com cartão, o texto claro selado no envelope é:

```json
{"zl1": {"text": "vê https://example.com", "preview": {
  "url": "https://example.com/",
  "title": "Título da página",
  "site": "Example",
  "description": "Opcional",
  "image": "data:image/jpeg;base64,…"
}}}
```

O dispositivo que recebe valida o cartão antes de o mostrar: só URLs `http(s)`, título obrigatório, comprimentos limitados e a imagem tem de ser um JPEG, PNG ou WebP pequeno e embutido. As notificações, a lista de conversas, as denúncias e os bots lêem só o `text`.

---

## 8. Indicadores de Status

### Por Mensagem

| Indicador | Ícone | Significado |
|-----------|------|---------|
| Enviando | ⏳ | Relógio |
| Enviado | ✅ | Check único |
| Recebido | ✅✅ | Check duplo |
| Lido | 🔵 | Check duplo azul |
| Falhou | ⚠️ | Retry |

---

## 9. Responder e Encaminhar

### Barra de Resposta

Ao responder, mostra:
- Pré-visualização da mensagem citada
- Nome do remetente original
- Resposta editável

---

## 10. Busca de Mensagens

### Busca Global

```
Barra de busca → Buscar mensagens
           ↓
Resultados agrupados por chat
     ↓
Destacar correspondência
     ↓
Ir para mensagem
```

---

## 11. Ações Rápidas

| Ação | Gesto |
|--------|---------|
| Responder | Deslizar direita |
| Copiar | Tocar duas vezes |
| Encaminhar | Segurar → Encaminhar |
| Favoritar | Deslizar esquerda |
| Excluir | Segurar → Excluir |

---

## 12. Reactions

### Barra de Reação

```
❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 😍 👏 🙌 💪 🙏 😇
```

---

## 13. Mensagens de Voz

### Recursos de Voz

- Visualização de onda
- Velocidade de reprodução (0.5x, 1x, 1.5x, 2x)
- Pular 10s para frente/trás
- Reprodução em segundo plano

---

## 14. Emoji e GIF

### Seletor de Emoji

- Categorias
- Recentes
- Busca

### Busca de GIF

- Integração Giphy
- Buscar por palavra-chave
- GIFs em tendência
