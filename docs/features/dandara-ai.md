# 🤖 Dandara AI

> Complete documentation for Dandara AI - ZwoSocial's AI companion.

---

## Overview

Dandara AI is an AI assistant that:
- Summarizes messages
- Provides smart replies
- Joins group chats with humor
- Acts as personal assistant
- Runs mini games

---

## 1. Message Summary

### Use Cases

| Scenario | Description |
|----------|-------------|
| Group Summary | Summarize chat history when joining |
| Key Points | Extract important info |
| TL;DR | Quick summary for long chats |

### API

```http
POST /api/ai/summarize
{
  "chat_id": "chat_uuid",
  "messages": 100,
  "format": "bullets" | "text" | "tldr"
}
```

### Response

```json
{
  "summary": "Key points:\n- Project launch date: May 20\n- Team meeting: Friday 3pm\n- Budget approved"
}
```

---

## 2. Smart Replies

### How It Works

AI analyzes conversation and suggests responses.

```http
POST /api/ai/reply-suggestions
{
  "chat_id": "chat_uuid",
  "context": "last_message"
}
```

### Response

```json
{
  "suggestions": [
    "That sounds great! 🎉",
    "I'll check and get back to you",
    "Thanks for letting me know!"
  ]
}
```

---

## 3. Group Chat Humor

### Dandara in Groups

Dandara can join groups to:
- Add humor and comments
- Keep group active
- Respond to mentions

### Configuration

```typescript
interface DandaraGroupConfig {
  enabled: boolean;
  humor_level: 'low' | 'medium' | 'high';
  respond_to_mentions: boolean;
  auto_respond: boolean;
  participation_rate: number;  // messages per hour
}
```

### Commands

```
@dandara summary    - Summarize recent messages
@dandara joke     - Tell a joke
@dandara trivia  - Start a trivia game
@dandara help    - Show commands
```

### Humor Features

- Dad jokes
- Puns
- Reactions to messages
- Timely comments
- Keep conversation alive

---

## 4. Voice Assistant

### Voice Commands

| Command | Action |
|---------|-------|
| "Dandara, summarize" | Summarize chat |
| "Dandara, call mom" | Start call |
| "Dandara, remind me" | Set reminder |

### Voice Recognition

```http
POST /api/ai/voice
{
  "audio": "base64_audio",
  "language": "pt-BR" | "en-US"
}
```

---

## 5. Personal Assistant

### Capabilities

| Feature | Description |
|---------|-------------|
| Answer Questions | Ask anything |
| Send Messages | Compose and send |
| Schedule | Set reminders |
| Information | Get facts |

### API

```http
POST /api/ai/chat
{
  "message": "What's the weather today?",
  "context": {}
}
```

---

## 6. Mini Games

### Available Games

| Game | Type | Players |
|------|------|---------|
| 🎲 Dice | Random | Group |
| ✂️ RPS | Strategy | 1v1 |
| 📝 Trivia | Quiz | Group |
| 🧠 Quiz | Knowledge | Group |
| 🎯 Targets | Accuracy | Solo |

### Starting Games

```
@dandara roll dice
@dandara rps
@dandara trivia start
```

### Game API

```http
POST /api/ai/game
{
  "game": "dice",
  "players": ["user1", "user2"]
}
```

---

## 7. Dandara Voice

### Text-to-Speech

```http
POST /api/ai/speak
{
  "text": "Hello! I'm Dandara",
  "voice": "female"
}
```

---

## 8. Integration Points

### Message Processing

1. Dandara monitors group messages
2. Responds to @mentions
3. Adds humor at intervals
4. Summarizes on command

### Privacy

- All AI processing is local
- User data never leaves app
- Can be disabled per chat
