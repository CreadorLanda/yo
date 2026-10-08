# 💬 Messaging

> Complete documentation for ZwoSocial messaging features.

---

## 1. Direct Chat (1:1)

### Sending Messages

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

// Send a text message
const message = await chatService.sendMessage({
  chat_id: 'chat_uuid',
  content: 'Hello! 👋',
  content_type: 'text'
});
```

### Message Types

| Type | Description | Max Size | Support |
|------|-------------|----------|---------|
| `text` | Plain text | 10,000 chars | ✅ |
| `image` | JPEG, PNG, WebP | 25MB | ✅ |
| `video` | MP4,MOV | 100MB | ✅ |
| `audio` | Audio/Voice note | 25MB | ✅ |
| `document` | PDF, ZIP, etc | 100MB | ✅ |
| `location` | GPS coordinates | - | ✅ |
| `contact` | vCard contact | - | ✅ |

### Reactions

Supported emoji reactions:

```
❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 😍 👏 
🙌 💪 🙏 😇 ❤️‍🔥 💯 ⭐ 🌟 ✨ 🆕
```

To react:
1. Long-press on a message
2. Tap the reaction bar
3. Select emoji

In channels, the same long-press opens a floating bar with quick reactions and a **Comment** action.

### Message Editing

- Edit within **15 minutes** of sending
- Shows "Edited" label
- Edit history available

```
Message: "Hello world"
         ↓ [Edit]
Message: "Hello everyone" (Edited)
```

### Message Deletion

| Option | Effect |
|--------|--------|
| **Delete for me** | Only you can't see it |
| **Delete for everyone** | Removed for all participants |

---

## 2. Groups

### Creating a Group

1. Tap "New Chat"
2. Select "New Group"
3. Add participants (3-1000)
4. Set group name
5. Add photo (optional)
6. Tap "Create"

### Group Roles

| Role | Permissions |
|------|-------------|
| **Creator** | All permissions, can delete group |
| **Admin** | Manage members, change settings, pin messages |
| **Moderator** | Remove messages, mute members |
| **Member** | Send messages, react |

### Group Limits

| Resource | Limit |
|----------|-------|
| Members | 1,000 |
| Admins | 50 |
| Description | 500 chars |
| Group name | 100 chars |
| Photo size | 10MB |

### Group Types

| Type | Description |
|------|-------------|
| **Public** | Anyone can find and join |
| **Private** | Invite only |
| **Community** | Sub-groups supported |

---

## 3. Channels

### Creating a Channel

1. Go to "Channels"
2. Tap "+"
3. Choose "Create Channel"
4. Configure:
   - Name (required)
   - Description (optional)
   - Photo (optional)
   - Public/Private
5. Tap "Create"

### Channel Features

- Broadcasting to unlimited members
- Slow mode (1 message per X seconds)
- Only approved publishers can send (admins or designated members)
- Members can react to posts (reactions are anonymous by default)
- Members can comment if approved by admins

#### Channel Reactions and Comments

- Long-press a channel post to open a floating action bar with quick reactions and **Comment**.
- Comments can be anonymous or identified; the author chooses per comment.
- Anonymous comments never reveal identity to anyone (including admins).
- Posting remains limited to approved publishers.

---

## 4. Scheduled Messages

### Schedule a Message

1. Write your message
2. Long-press send button
3. Select "Schedule"
4. Choose date and time
5. Confirm

```
Scheduled Messages appear in:
├── 💭 Drafts (editable)
└── ⏰ Scheduled (view/cancel)
```

### Management

| Action | How |
|--------|-----|
| View scheduled | Go to chat → Scheduled tab |
| Edit | Tap message → Edit |
| Cancel | Tap message → Delete |

---

## 5. Status Indicators

| Status | Icon | Meaning |
|--------|------|---------|
| ⏳ | Clock | Sending |
| ✅ | Single check | Sent to server |
| 📖 | Double check blue | Read |
| ⚠️ | Warning | Error - tap to retry |

---

## 6. Voice Notes

### Recording

1. Long-press 🎤 microphone button
2. Release to send
3. Swipe up to cancel

### Voice Note Features

- Maximum 2 minutes
- Waveform visualization
- Playback speed control
- Skip forward/back 10s

---

## 7. Message Search

Search messages within a chat:

1. Open chat
2. Tap search icon 🔍
3. Type query
4. Results show with context

```
Search: "project"
Results: 5 messages found
├── "Let's start the project"
├── "Project update:"
├── "Check the project board"
└── ...
```
