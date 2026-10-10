# 🤖 Dandara AI

> Documentação completa da Dandara AI - assistente de IA do ZwoSocial.

---

## Visão Geral

Dandara AI é um assistente de IA que:
- Resume mensagens
- Fornece respostas inteligente
- Entra em grupos com humor
- Age como assistente pessoal
- Roda mini jogos

---

## 1. Resumo de Mensagens

### Casos de Uso

| Cenário | Descrição |
|----------|-------------|
| Resumo de Grupo | Resume histórico do chat |
| Pontos-Chave | Extrai informações importantes |
| TL;DR | Resumo rápido para chats longos |

---

## 2. Respostas Inteligentes

### Como Funciona

IA analisa conversa e sugere respostas.

---

## 3. Humor em Grupos

### Dandara em Grupos

Dandara pode entrar em grupos para:
- Adicionar humor e comentários
- Manter grupo ativo
- Responder a @menções

### Comandos

```
@dandara summary    - Resume mensagens recentes
@dandara joke     - Conta uma piada
@dandara trivia  - Inicia jogo de trivia
@dandara help    - Mostra comandos
```

---

## 4. Assistente de Voz

### Comandos de Voz

| Comando | Ação |
|---------|-------|
| "Dandara, resuma" | Resume chat |
| "Dandara, ligue para mamae" | Inicia ligação |
| "Dandara, lembre-me" | Define lembrete |

---

## 5. Assistente Pessoal

### Capacidades

| Recurso | Descrição |
|---------|-------------|
| Responder Perguntas | Pergunte qualquer coisa |
| Enviar Mensagens | Compor e enviar |
| Agendar | Definir lembretes |
| Informações | Obter fatos |

---

## 6. Mini Jogos

### Jogos Disponíveis

| Jogo | Tipo | Jogadores |
|------|------|---------|
| 🎲 Dados | Aleatório | Grupo |
| ✂️ PPT | Estratégia | 1v1 |
| 📝 Trivia | Quiz | Grupo |
| 🧠 Quiz | Conhecimento | Grupo |
| 🎯 Alvos | Precisão | Solo |

### Iniciando Jogos

```
@dandara roll dice
@dandara rps
@dandara trivia start
```

---

## 7. Voz da Dandara

### Texto para Fala

```http
POST /api/ai/speak
{
  "text": "Olá! Sou Dandara",
  "voice": "female"
}
```

---

## 8. Pontos de Integração

### Processamento de Mensagens

1. Dandara monitora mensagens do grupo
2. Responde a @menções
3. Adiciona humor em intervalos
4. Resume sob comando
