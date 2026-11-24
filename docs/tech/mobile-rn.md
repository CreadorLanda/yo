# 📱 React Native Mobile

## Stack
- Expo SDK 52
- TypeScript
- React Navigation 6
- Zustand/Jotai: State
- Tamagui: UI
- Reanimated 3: Animations

---

## Calls

A call outlives its screen. `data/active-call.ts` is the call, `components/call/call-runner.tsx` runs it from the root layout (room, audio session, keep-alive, and the rules for no answer and everyone leaving), and the call screen and the green bar are two views of it. The screen reaches the room through `RoomContext.Provider`.

- Back or home leaves the call running. The bar returns to it and can end it.
- Android keeps it alive with the foreground service in `modules/call-keepalive`, which needs the microphone permission first, so it is requested before the call starts.
- The camera turns off when the person leaves the call screen or the app, and comes back when they return. A camera they turned off stays off.
- WebRTC is only loaded once there is a call. Web keeps its own call screen.
- A call with three or more people, and any group call, uses `components/call/group-stage.tsx`: one tile each, a ring on whoever is speaking, and tap to focus. How tiles share the stage is in `data/call-grid.ts`. One-to-one calls keep their own layout.
