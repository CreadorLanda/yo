# 📝 Changelog

> Histórico de todas as versões do Socialize.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Não lançado]

### ❌️ Added (Adicionado)

#### Stories
- Reacções múltiplas: uma pessoa pode deixar vários emojis no mesmo story. Cada story passa a trazer as contagens por emoji (`reactions`) e as escolhas de quem lê (`my_reactions`), no feed e no story individual
- `GET /api/stories/reactions` publica o conjunto de emojis aceites, para o cliente não guardar a sua própria cópia e ficar a divergir da lista

### ✏️ Changed (Alterado)

#### Stories
- `POST /api/stories/:id/react` aceita `{"reactions": [...]}` e responde com o story e as contagens novas. A forma antiga `{"emoji": "..."}` continua a funcionar e substitui o conjunto, como sempre fez
- `GET /api/stories/:id/viewers` traz `emojis` por espectador; `emoji` fica a ser o primeiro deles, para clientes que não conhecem a lista

## [0.0.2-alpha] - 2026-05-21

### ✏️ Changed (Alterado)

#### Documentação
- Especificação de canais: reações anônimas por padrão, comentários opcionais (anônimos ou identificados) com aprovação de admin

## [0.0.1-alpha] - 2026-05-14

### ❌️ Added (Adicionado)

#### Documentação
- Readme expandido com visão, filosofia e quick start
- Estrutura de documentação completa
- Getting Started guide
- FAQ completo

#### Tech Stack Definida
- Backend: Go + Gin/Echo + gRPC
- Mobile: React Native + Expo + TypeScript
- Database: PostgreSQL + MongoDB + Redis
- AI: Dandara AI Integration
- WhatsApp: Evolution API

#### Features Planejadas
- 💬 Messaging core (chat, grupos, canais)
- 🔒 Privacidade (ghost mode, E2E, app lock)
- 🎨 Customização (temas dinâmicos, AMOLED, glassmorphism)
- 🤖 AI features (assistente, smart replies)
- 🎮 Recursos estilo MSN (nudges, winks, display pictures)
- 🌐 Comunidades
- 📱 Multi-plataforma

### 📋 Planned (Próximas Versões)

#### v0.1.0 - Alpha Release
- [ ] Autenticação básica (JWT)
- [ ] Chat em tempo real (WebSocket)
- [ ] Envio de mensagens de texto
- [ ] Interface mobile básica
- [ ] Estrutura de banco de dados

#### v0.2.0 - Beta 1
- [ ] Grupos e canais
- [ ] Compartilhamento de mídia
- [ ] Reações a mensagens
- [ ] Busca de conversas
- [ ] Perfil de usuário

#### v1.0.0 - First Release
- [ ] Criptografia E2E
- [ ] Aplicativo Android
- [ ] Aplicativo iOS
- [ ] Aplicativo Web
- [ ] Integração Dandara AI
- [ ] Sistema de temas
- [ ] Modo Ghost

#### v2.0.0 - Community Update
- [ ] Comunidades
- [ ] Chamadas de voz/vídeo
- [ ] Mini apps platform
- [ ] Loja de temas
- [ ] Sync na nuvem

#### v3.0.0 - Desktop Release
- [ ] Aplicativo desktop
- [ ] Plugins
- [ ] API pública
- [ ] Bot ecosystem

---

## 🔄 Como Contribuir para o Changelog

1. Certifique-se que o change está em `main`
2. Use convenção de commit convencional:
   - `feat:` para novas features
   - `fix:` para bug fixes
   - `docs:` para documentação
   - `style:` para formatação
   - `refactor:` para refatoração
   - `test:` para testes
   - `chore:` para manutenção
3. Adicione entry apropriada no changelog

---

## 🏷️ Convenções de Versão

| Tipo | Sigla | Descrição |
|------|------|-----------|
| Major | x.0.0 | Mudanças incompatíveis |
| Minor | x.x.0 | Novas features compatíveis |
| Patch | x.x.x | Bug fixes compatíveis |

### Prefixos de Release

- **alpha**: Versão de desenvolvimento
- **beta**: Versão de teste
- **rc**: Release candidate
- **stable**: Versão estável

---

## 📄 Formato de Entrada

```markdown
### Added
- Nova featurexyz (#123)

### Changed
- Atualização no componenteABC

### Fixed
- Bug no login(#456)

### RemovedFeature
- DeprecatedAPImethod
```

---

## 🙏 Agradecimentos

Obrigado a todos os contribuidores que tornaram este projeto possível!

---

## 📟 Formato de Data

Use ISO 8601: `YYYY-MM-DD`

Exemplo: `2026-05-14`

---

<p align="right">
  <em>Última atualização: 2026-05-14</em>
</p>