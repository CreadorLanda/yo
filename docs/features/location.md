# 📍 Location

> Sharing where you are in a chat: once, or live for as long as you choose.

---

## What a person can do

| | |
|---|---|
| **Send current location** | One position, as it is now. |
| **Share live location** | The position keeps updating for 15 minutes, 1 hour, or until it is turned off. |
| **Stop** | The sharer can stop from the bubble at any time. The last position stays, marked as ended. |
| **Open** | Tapping a bubble opens the phone's own map app. |

Before anything is sent the sheet shows a map of the position, so the preview is what the others will get.

## How it travels

A location is a message of type `location`. Its body is JSON, encrypted end to end like any other message, so **the server never sees a coordinate in the clear**.

```json
{ "kind": "location", "lat": -8.83833, "lng": 13.23444, "accuracy": 12,
  "live": true, "expiresAt": "2026-11-05T15:00:00Z", "updatedAt": "2026-11-05T14:00:00Z" }
```

A live share is **one message that is edited**, not a stream of new ones: each update is an encrypted edit of the same message, so the thread does not fill with positions and the server stores only the latest sealed body.

- The end is inside the message (`expiresAt`). A phone that dies mid-share is still read as ended by everyone who looks.
- If no update arrives for 3 minutes the bubble says when the last one came, so a silent share is not mistaken for a live one.
- Updates are sent when the sharer has moved at least 10 m and 8 s have passed, and at least once a minute while standing still.
- The chat privacy setting that blocks message types applies: a chat that does not allow locations refuses both kinds.

## Android and iOS

Live updates run through `expo-location` and `expo-task-manager`. On Android that is a foreground service, which is also the notification that says the person is sharing. It is started while the app is on screen, so **background location permission is not requested**. A share that was running when the app closed resumes at the next start, if permission is still granted and it has not run out. Logging out stops every share.

## The map and what it reveals

The preview is built from OpenStreetMap tiles, fetched by the phone. The tile host learns **which area was shown** (about 600 m across), not who is looking or in which chat, and the app's server learns nothing. That is the one third party in this feature. No map SDK or API key is used, and no street name is looked up: the address line is the coordinates, because reverse geocoding would send the exact position to a geocoder.

The public tile server is for light use. For production, host the tiles or use a provider, and change `host` in `mapTiles` (`data/location-share.ts`).

## Where the code is

| | |
|---|---|
| `data/location-share.ts` | Pure: distance, when to publish, live state, tile maths, map links |
| `data/live-location.ts` | The running share: permission, sending, editing, stopping, resuming |
| `components/chat/location-map.tsx` | The map with its pin |
| `components/chat/attachment-bubbles.tsx` | The bubble (`LocationCard`) |
| `components/chat/attachment-composer.tsx` | The share sheet |
