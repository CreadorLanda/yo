# Socialize — Mobile

The Socialize mobile app, built with [Expo](https://expo.dev) (SDK 54), React Native 0.81, TypeScript and `expo-router` (file-based routing).

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- iOS Simulator (macOS), Android Studio, or [Expo Go](https://expo.dev/go)

## Get started

```bash
bun install
bun run start      # Metro dev server
bun run android    # launch Android
bun run ios        # launch iOS (macOS only)
bun run web        # launch in browser
```

## Project structure

```
mobile/
├── app/                # expo-router file-based routes
│   ├── (tabs)/
│   ├── _layout.tsx
│   └── modal.tsx
├── components/         # shared components
│   └── ui/             # primitive UI (built from design tokens)
├── constants/
│   └── theme.ts        # design tokens: Palette, Colors, Spacing, Radii, Typography, Fonts
├── hooks/              # custom hooks (theme, color-scheme, …)
├── assets/
└── scripts/
```

## Push notifications

On login / settings the app requests permission via `expo-notifications` and
registers a push token with `PUT /api/notifications/devices`
(`mobile/data/push.ts`). iOS uses an Expo push token so Expo can deliver it
through APNs; Android uses its native FCM token for direct FCM delivery:

| Token shape | Backend |
| --- | --- |
| iOS `ExponentPushToken[...]` | Expo Push API → APNs |
| Android native FCM token | FCM HTTP v1 when `FCM_PROJECT_ID` + credentials are set on the server |

The EAS project must have an Apple Push Notification key configured for iOS
delivery. The development, preview, and production EAS profiles can build iOS;
Apple signing and APNs credentials are required for device builds. Physical
device recommended; iOS Simulator will skip registration.

## Design system

All visual decisions flow from `constants/theme.ts`. Read the full spec — palette, themes, spacing, radii, typography, recipes — in [`docs/tech/design-system.md`](../docs/tech/design-system.md).

Quick rule: components must consume **semantic** tokens (`Colors.light.surface`, `Colors.light.primary`), never raw palette values, so dark mode flips automatically.

## Reset to a blank project

```bash
bun run reset-project
```

Moves the starter code to `app-example/` and leaves a blank `app/` to build into.

## Learn more

- [Expo docs](https://docs.expo.dev/)
- [expo-router](https://docs.expo.dev/router/introduction)
- [React Native](https://reactnative.dev/)
