# 💬 Messaging Details

> Complete documentation for all messaging features and small details.

---

## 1. Message Filters

### Filter Bar

| Filter | Icon | Description |
|--------|------|-------------|
| All | 💬 | All messages |
| Unread | 🔵 | Unread messages |
| Starred | ⭐ | Starred/favorite messages |
| Media | 🖼️ | Media only |
| Documents | 📄 | Documents only |
| Links | 🔗 | Links only |
| Audio | 🎵 | Voice notes, audio |

### Usage

```
Chat → Search → Filter bar
     ↓
[All] [Unread] [⭐] [🖼️] [📄]
     ↓
Tap filter to apply
```

---

## 2. Message Options

### Long Press Menu

| Action | Description |
|--------|-------------|
| Reply | Reply to specific message |
| Copy | Copy text |
| Forward | Forward to another chat |
| Star | Add to favorites |
| React | Add reaction |
| Delete | Delete message |

### Swipe Actions

Message actions open on long press. Swiping a message to the right replies to it.

---

## 3. Media Sending

### Media Types

| Type | Max Size | Formats |
|------|---------|--------|
| Image | 25MB | JPEG, PNG, WebP, GIF |
| Video | 100MB | MP4, MOV, AVI |
| Audio | 25MB | MP3, WAV, M4A |
| Document | 100MB | PDF, DOC, ZIP |
| Voice Note | 25MB | M4A |

### Media Preview

- Grid view for multiple
- Crop before send
- Quality selection
- Caption addition

### Media Area Components

```
📷 Camera     → Take photo/video
🖼️ Gallery   → Select from device
🎤 Voice     → Voice note
📍 Location  → Send location
👤 Contact   → Send contact
📄 Document  → Attach file
```

---

## 4. Sticker Support

### WhatsApp Sticker Compatibility

**Import from WhatsApp:**
- ✅ Import .wasticker files
- ✅ Import from WhatsApp media
- ✅ Use without conversion

**Export:**
- ✅ Export as .wasticker
- ✅ Export as PNG pack
- ✅ Share to other apps

### Sticker Features

| Feature | Supported |
|---------|----------|
| Animated stickers | ✅ |
| Static stickers | ✅ |
| Sound stickers | ✅ |
| Sticker packs | ✅ |
| Custom packs | ✅ |

### Sticker API

```http
POST /api/stickers/import
{
  "source": "whatsapp" | "telegram" | "file"
}

POST /api/stickers/export
{
  "pack_id": "uuid",
  "format": "wasticker" | "png"
}
```

---

## 5. Message Input

### Input Features

- Character count
- Emoji picker
- GIF search (Giphy)
- Translate button
- Voice recording

### Input Menu (Long Press)

```
📷 Media
🎤 Voice
📍 Location
👤 Contact
📄 Document
🎭 Sticker
```

---

## 6. Message Bubbles

### Bubble Styles

| Style | Description |
|-------|-------------|
| Standard | Default WhatsApp style |
| Compact | Less padding |
| Bubble | Rounded corners |
| Square | Square corners |
| Minimal | Text only |

### Bubble Colors

- Custom background color
- Gradient support
- Opacity control

---

## 7. Link Preview

### Auto-Preview

When sending URL, automatically shows:
- Thumbnail
- Title
- Description
- Site icon

### Link Preview Data

```json
{
  "url": "https://...",
  "title": "Page Title",
  "description": "Page description...",
  "image": "preview.jpg",
  "icon": "favicon.ico"
}
```

### Disable Preview

```
Settings → Privacy → Link previews → Off
```

---

## 8. Status Indicators

### Per Message

| Indicator | Icon | Meaning |
|-----------|------|---------|
| Sending | ⏳ | Clock |
| Sent | ✅ | Single check |
| Delivered | ✅✅ | Double check |
| Read | 🔵 | Blue double check |
| Failed | ⚠️ | Retry |

### Chat Level

- Typing indicator (...)
- Recording indicator
- Online status
- Last seen

---

## 9. Reply & Forward

### Reply Bar

When replying, shows:
- Quoted message preview
- Original sender name
- Editable reply

### Forward Menu

- Forward to multiple
- Forward as copy (no sender)
- Forward with caption

---

## 10. Message Search

### Global Search

```
Search bar → Search messages
           ↓
Results grouped by chat
     ↓
Highlight match
     ↓
Jump to message
```

### Search Filters

| Filter | How |
|--------|-----|
| From me | from:me |
| Has media | has:media |
| Date range | date:2026-01-01 |
| Links only | has:link |

---

## 11. Message Actions

### Quick Actions

| Action | Gesture |
|--------|---------|
| Reply | Swipe right |
| Copy | Tap twice |
| Forward | Long press → Forward |
| Star | Swipe left |
| Delete | Long press → Delete |

### Edit Mode

- Select multiple messages
- Bulk forward
- Bulk delete
- Bulk star

---

## 12. Chat Settings (Per Chat)

### Per Chat Options

- Mute notifications
- Custom wallpaper
- Pin chat
- Archive chat
- Delete chat
- Block user

### Customization

- Per-chat wallpaper
- Per-chat notification sound
- Per-chat mute duration

---

## 13. Message Reactions

### Reaction Bar

```
❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 😍 👏 🙌 💪 🙏 😇
```

### Adding Reactions

- Tap once to add
- Long press for more
- See who reacted

---

## 14. Voice Messages

### Voice Features

- Waveform visualization
- Playback speed (0.5x, 1x, 1.5x, 2x)
- Skip 10s forward/back
- Background play

### Recording

- Hold to record
- Slide to cancel
- Lock recording (slide lock)

---

## 15. Emoji & GIF

### Emoji Picker

- Categories
- Recent
- Search
- Custom

### GIF Search

- Giphy integration
- Search by keyword
- Trending GIFs
