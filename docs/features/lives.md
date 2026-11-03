# Lives

A live is one or more people broadcasting video to an audience that watches, comments and sends hearts. It is not a call: viewers cannot publish unless a host brings them on stage, and the SFU enforces that in their token.

Lives are **not end-to-end encrypted**. An audience has no shared session to derive a key from, so the streams are encrypted to the SFU and the SFU can read them. The app says so on the live screen.

## Where a live starts

| Started from | Hosts | Moderators | Audience by default |
|---|---|---|---|
| Stories | the person | the person, plus anyone they appoint | their contacts |
| A direct chat (**joint live**) | both people | both, plus anyone they appoint | the two of them |
| A group | the person | group admins and moderators, plus appointees | the group |
| A channel | the person | channel owner and admins, plus appointees | the channel's followers (anyone, if public) |

In a **joint live** the other person is invited the way a call rings them. Accepting joins them as a host. Declining is "not now": they keep their seat and can join later with full host rights. Either host can end it.

## Choosing the audience

The host picks who may watch when going live:

- **place**: the members of the chat, group or channel (not available from Stories).
- **contacts**: everyone either host has an accepted one-to-one conversation with.
- **selected**: only the people picked, plus anyone a moderator invites later.
- **public**: anyone with the link. It is announced to the hosts' contacts.

## Tools

- **Comments** are stored, pushed in real time over the websocket, and the last 50 are shown to anyone who joins late. Max 300 characters. Authors and moderators can delete them. Moderators can turn comments off; they can still write, to say why.
- **Hearts** animate over LiveKit's data channel; the count is sent to the API in batches of at most 50.
- **Stage**: a viewer can ask to speak. A moderator calling someone who asked puts them straight on; calling anyone else sends an invitation they accept or decline. Publishing rights are granted and revoked in the SFU at once, not on the next connect.
- **Moderators** can ban, unban, invite people to watch, manage the stage and delete comments. Only hosts appoint moderators, and only hosts can ban a moderator. Hosts cannot be banned.
- **Ban** removes the person from the room immediately and refuses them on rejoin. Their comments stop being accepted.
- **Stats** (hosts and moderators, during and after): viewers now, peak, unique viewers, hearts, comments, duration.

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/lives` `{chat_id? channel_id? title audience viewer_ids}` | anyone allowed to broadcast there |
| POST | `/api/lives/:id/join`, `/leave`, `/end` | audience; end: hosts |
| GET | `/api/lives/:id` | audience: live, members, your role, recent comments |
| POST | `/api/lives/:id/respond` `{accept}` | co-host invitation or stage invitation |
| GET/POST | `/api/lives/:id/comments` `{body}` | audience |
| DELETE | `/api/lives/:id/comments/:cid` | author or moderator |
| POST | `/api/lives/:id/hearts` `{n}` | audience |
| POST | `/api/lives/:id/stage/request`, `/stage/leave` | audience |
| POST/DELETE | `/api/lives/:id/stage/:uid` | moderators |
| PUT/DELETE | `/api/lives/:id/moderators/:uid` | hosts |
| GET, PUT/DELETE | `/api/lives/:id/bans`, `/bans/:uid` | moderators |
| GET | `/api/lives/:id/audience`, `/stats` | moderators |
| POST | `/api/lives/:id/invite` `{user_ids}` | moderators |
| PATCH | `/api/lives/:id/settings` `{comments_enabled}` | moderators |

Websocket events: `live.started`, `live.ended`, `live.viewers`, `live.cohost_invite`, `live.invite`, `live.stage_invite`, `live.stage`, `live.member`, `live.comment`, `live.comment_deleted`, `live.settings`, `live.banned`.
