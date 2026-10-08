# 🖥️ ZwoSocial Screens

> Complete overview of all screens in ZwoSocial messaging app.

---

## 🎯 Screen List

| Screen | Status | Priority |
|--------|--------|----------|
| Login | ✅ Built | - |
| Registration | ✅ Built | - |
| Chats (Home) | ✅ Built | - |
| Messages | ✅ Built | - |
| Story Viewer | ✅ Built | - |
| Communities | 🚧 In Progress | High |
| Profile | 🔄 To Build | High |
| Settings | 🔄 To Build | High |
| Calls | 🔄 To Build | Medium |
| Notifications | 🔄 To Build | Low |

---

## Login Screen ✅

### Elements
- Logo
- Phone input (+55...)
- Password input
- "Forgot Password" button
- Login button (primary)
- "Create Account" link

---

## Registration Screen ✅

### Elements
- Phone verification (OTP)
- Photo picker
- Display name input
- Username input (optional)
- Continue button

---

## Chats Screen (Home) ✅

### Elements
- AppBar with logo
- Stories ring (top)
  - Your story circle
  - Contacts' stories
- Search bar
- Chat list
  - Avatar
  - Name
  - Last message preview
  - Timestamp
  - Unread badge
- FAB: New Chat

### Features
- Pull to refresh
- Long press for options
- Swipe to archive

---

## Messages Screen ✅

### Header
- Back button
- Avatar
- Name
- Online status
- Call buttons (voice/video)
- More button (⋮)

### Message List
- Text messages
- Image messages
- Voice notes
- Sticker reactions

### Input Area
- Attachment button
- Text input
- Emoji button
- Microphone

### Features
- Long press for reactions
- Double tap for like
- Link preview

---

## Story Viewer ✅

### Your Stories
- Add story button
- Story thumbnails (24h)

### Viewing Stories
- Progress bar
- Tap left/right to navigate
- Long press for reactions

---

## Communities Screen 🚧

### Elements
- Community list
- Search
- Create community FAB

### Community Card
- Avatar
- Name
- Members count
- Last activity

---

## Profile Screen 🔄

### Header
- Large avatar
- Edit button
- Cover photo area

### Info Section
- Display name
- Username (@username)
- Bio
- Stats (posts, followers, following)

### Action Buttons
- Edit Profile
- Share Profile
- More options

### Tabs
- Media
- Stories
- Notes

---

## Settings Screen 🔄

### Sections
- Account
  - Change phone
  - Change email
  - Delete account
- Privacy
  - Last seen
  - Profile photo
  - Read receipts
- Notifications
  - Message notifications
  - Group notifications
  - Call ringtones
- Theme
  - Dark mode
  - Theme selection
  - Wallpaper
- Storage
  - Storage usage
  - Clear cache
- Help
  - FAQ
  - Contact us
  - Privacy policy
- About
  - Version
  - Terms

---

## Calls Screen 🔄

### Tabs
- All
- Missed

### Call Card
- Avatar
- Name
- Timestamp
- Call type icon
- Callback button

---

## Community Detail (In Progress) 🚧

### Header
- Community avatar
- Name
- Description
- Members count
- Admin badge

### Channels List
- #general
- #announcements
- Custom channels

### Members Tab
- Admin list
- Moderator list
- Member list
- Invite button

### Settings
- Edit community
- Mute notifications
- Leave community

---

## Dandara AI Screen (Features)

### AI Companion Features

1. **Message Summary**
   - Summarize group chat history
   - Key points extraction
   
2. **Smart Replies**
   - AI-generated quick responses
   
3. **Group Humor**
   - Join group chats (with permission)
   - Add humor/comments
   - Keep group alive
   
4. **Voice Assistant**
   - Voice commands
   - Call Dandara to summarize
   
5. **Personal Assistant**
   - Answer questions
   - Send messages
   - Schedule reminders
   
6. **Mini Games**
   - Trivia
   - Quiz
   - Dice
   - Rock Paper Scissors

---

## Screen Flow

```
Splash → Login → Registration → Chats (Home)
                              ↓
         ┌─────────────────────┼─────────────────────┐
         ↓                     ↓                     ↓
    Messages              Stories              Communities
         ↓
    Settings ←────────── Profile
```

---

## Screen Requirements

### Login → Registration
- [x] Phone input validation
- [x] OTP verification
- [ ] Profile photo picker (basic)
- [ ] Username availability check

### Chats → Messages
- [x] Chat list loading
- [x] Message display
- [x] Message input
- [ ] Message reactions
- [ ] Link preview

### Stories
- [x] Story viewer
- [x] Add story
- [ ] Multi-emoji reactions
- [ ] Comments on stories

### Communities
- [x] Community list
- [ ] Create community
- [ ] Channel management
- [ ] Member management
