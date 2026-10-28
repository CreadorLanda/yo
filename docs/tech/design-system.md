# ZwoSocial — Design System

> Single source of truth for visual language across mobile, web and desktop.

The design language is **clean, calm and trustworthy**: neutral chrome, a confident violet primary action, and vivid accents reserved for avatars / status / reactions. The interface should feel familiar to anyone fluent in WhatsApp, Telegram or Signal, then a notch more precise: one type scale, one control height, one shape per kind of control.

Tokens live in [`mobile/constants/theme.ts`](../../mobile/constants/theme.ts). This document is the human-readable companion — keep them in sync.

---

## 1. Color Palette

### 1.1 Brand (Violet)

The primary action color. Used for CTAs, links, focused inputs, the active tab indicator, and selection.

| Token | Hex | Usage |
|---|---|---|
| `brand.50`  | `#F2EFFF` | Subtle tinted backgrounds, hovered surfaces |
| `brand.100` | `#E6E0FF` | Soft chips, pressed-state highlights |
| `brand.200` | `#CEC2FF` | Disabled primary, dividers in branded sections |
| `brand.300` | `#B3A2FF` | Decorative accents |
| `brand.400` | `#9680FF` | **Dark-mode primary** |
| `brand.500` | `#7A5CFF` | Decorative only — fails contrast as a primary |
| `brand.600` | `#5B3DF5` | **Light-mode primary — CTA, links, focus ring** |
| `brand.700` | `#4A2FD1` | Hover / pressed primary |
| `brand.800` | `#3B26A6` | Headings on tinted backgrounds |
| `brand.900` | `#2E1F7D` | High-emphasis text on brand surfaces |

The hue comes from the logo: a Z in a speech bubble whose gradient runs
`#8C6EFF` → `#5235F0`.

Two shades carry the brand, not one, and neither is lifted from the gradient.
Measured against WCAG, the bubble's midpoint `#6F52F8` scores 4.95:1 with white
text and 3.87:1 on the dark background — it scrapes through in light mode and
fails in dark. `600` gives 6.12:1 with white text and 5.80:1 on the light
background; `400` gives 6.23:1 on dark. Same hue as the logo, moved for
legibility.

### 1.2 Neutral (Greys)

Backgrounds, surfaces, text and borders. The ramp carries a trace of the
brand hue (chroma well under 0.01), so the violet primary sits *in* the
interface rather than on top of a blue-grey one borrowed from somewhere else.

| Token | Hex | Usage |
|---|---|---|
| `neutral.0`    | `#FFFFFF` | Surface (cards, sheets, bottom bar) |
| `neutral.50`   | `#F8F8FB` | App background (light) |
| `neutral.100`  | `#F1F1F6` | Muted surface: chips, search fields, pressed rows |
| `neutral.200`  | `#E6E6EE` | Borders, dividers |
| `neutral.300`  | `#D2D2DD` | Disabled borders, skeleton |
| `neutral.400`  | `#8E8EA0` | Muted text, timestamps |
| `neutral.500`  | `#686879` | Secondary text, icon default |
| `neutral.600`  | `#4B4B5A` | Body emphasis |
| `neutral.700`  | `#363643` | Strong body text |
| `neutral.800`  | `#23232E` | Headings |
| `neutral.900`  | `#15151D` | Primary text |
| `neutral.1000` | `#0B0B10` | Deepest ground |

### 1.3 Accents

Reserved for **expressive surfaces**: avatar fills, reactions, sticker frames, badges, story rings. Never use accents for primary actions.

| Token | Hex |
|---|---|
| `accent.yellow` | `#FFD93D` |
| `accent.red`    | `#FF5A5F` |
| `accent.green`  | `#4ADE80` |
| `accent.pink`   | `#FF6FB5` |
| `accent.teal`   | `#22D3EE` |
| `accent.purple` | `#A78BFA` |

### 1.4 Semantic

| Token | Hex | Usage |
|---|---|---|
| `semantic.success` | `#10B981` | Online status, delivered/read, success toasts |
| `semantic.warning` | `#F59E0B` | Caution, rate-limit, unsynced |
| `semantic.danger`  | `#EF4444` | Destructive actions, errors, unread badge |
| `semantic.info`    | `#3B82F6` | Informational banners, tips |

---

## 2. Light & Dark Themes

Theme tokens map raw palette → semantic role. Components must consume **semantic** tokens (`Colors.light.surface`), not raw palette values, so dark mode flips automatically.

### Light

| Role | Token | Hex |
|---|---|---|
| Background | `neutral.50` | `#F8F8FB` |
| Surface | `neutral.0` | `#FFFFFF` |
| Surface muted | `neutral.100` | `#F1F1F6` |
| Border | `neutral.200` | `#E6E6EE` |
| Divider | `neutral.200` | `#E6E6EE` (drawn as a hairline) |
| Text | `neutral.900` | `#15151D` |
| Text secondary | `neutral.500` | `#686879` |
| Text muted | `neutral.400` | `#8E8EA0` |
| Primary | `brand.600` | `#5B3DF5` |
| On-primary | `neutral.0` | `#FFFFFF` |
| Icon | `neutral.500` | `#686879` |
| Tab icon (inactive) | `neutral.400` | `#8E8EA0` |
| Tab icon (active) | `brand.600` | `#5B3DF5` |

### Dark

| Role | Hex |
|---|---|
| Background | `#0E0F13` |
| Surface | `#191A21` |
| Surface elevated | `#23242D` |
| Surface muted | `#131419` |
| Border | `#2C2E38` |
| Divider | `#202129` |
| Text | `#ECEDF2` |
| Text secondary | `#9A9CA8` |
| Text muted | `#6C6E7A` |
| Primary | `#9680FF` |
| On-primary | `#FFFFFF` |

Brand is lightened in dark mode (`brand.400`) so contrast against the dark surface stays comfortable.

### 2.1 Themes on top of the tokens

The tables above are the *base*. What a screen actually paints with is resolved
at runtime by [`mobile/data/theme-store.ts`](../../mobile/data/theme-store.ts),
which layers, bottom to top:

1. base `Colors` (this document),
2. the active theme pack — semantic tokens, chat chrome, layout, icons,
3. the person's always-on personal overrides.

Screens read the result through `useTheme()`; a hardcoded hex or a bare
`<Ionicons>` is the one way to opt a surface out of theming. A theme may set:

| Layer | Type | Examples |
|---|---|---|
| Tokens | `ThemeTokens` | `primary`, `surface`, `text`, `danger` — the semantic set |
| Chat chrome | `ChatChrome` | bubble colours, wallpaper (solid or photo), header, composer |
| Layout | `ThemeLayout` | bubble shape and radius, density, font scale, typeface, tab bar position and content, attach side, ~55 knobs |
| Icons | `ThemeIcons` + `iconSet` | Ionicons outline / filled / sharp, MaterialIcons, or the person's own image per slot |

The shapes and their defaults live in
[`mobile/data/theme-model.ts`](../../mobile/data/theme-model.ts) — pure, no
state — and every choice is stored on-device, so a theme survives a restart.
Icon slots are a closed list in
[`mobile/data/theme-icons.ts`](../../mobile/data/theme-icons.ts); a call site
opts in by rendering `<AppIcon slot="…" />` instead of a literal glyph.

### 2.2 Default chrome

An unconfigured app uses a **neutral header** (`headerStyle: 'minimal'`) and a
**bottom navigation bar** (`tabBarPosition: 'bottom'`, `tabBarLabels: 'both'`).
That is where every current messenger keeps navigation, and where the thumb
is. The selected tab gets a primary-tinted pill behind its icon and a
semibold label; inactive tabs stay `textSecondary`, never a saturated colour.
The swipeable pager is kept — only the strip changes. The status bar follows
the header's foreground, so a pale header gets dark status icons.

Packs can still ask for the violet bar (`brand`, `colored`) and tabs on top;
the defaults moved, the knobs did not.

Chat bubbles default to a radius of 18, 12×8 padding, a 16/21 text size and a
faint shadow on the incoming side only (`bubbleShadowStrength: 0.2`). The
conversation list reads `listAvatarSize` (default 52), which it used to
ignore.

### 2.3 Typeface, true black, glass and motion

Four knobs reach past colour and shape. All four default to off, so an app
nobody has configured looks exactly as it did.

**`fontFamily`** — `system` (the default), `inter`, `nunito`, `lora`, `space`,
`jetbrains`. The five named families are bundled as four weights each and load
from disk, so they work offline; `system` is the only value that leaves
`fontFamily` unset, which is what keeps iOS dynamic type working. React Native
0.81 exposes `Text` through a getter with no setter, so there is no global
patch point — screens import `Text` and `TextInput` from
[`mobile/components/ui/text.tsx`](../../mobile/components/ui/text.tsx), which
translates `fontWeight` into a named face (a bundled family does not respond
to numeric weight) and drops the weight afterwards to stop iOS double-bolding
an already-bold face. **A screen importing `Text` from `react-native` opts
itself out of the theme's typeface** — that is the one thing to remember.

**`amoledBlack`** — flattens dark backgrounds to `#000000` over whatever pack
is active, keeping its `primary`, `text` and semantic accents. A switch, not a
palette: someone on an OLED panel wants the power saving without giving up the
colours they chose. Ignored in light mode. Surfaces above the ground are
lifted to `#0A0A0A`/`#141414` so cards still have an edge.

**`glassChrome`** / **`glassIntensity`** — the chat header and composer become
frosted, via
[`GlassSurface`](../../mobile/components/ui/glass-surface.tsx). The header
floats over the thread rather than sitting above it, and the message list is
padded by its measured height; blur over a flat colour is that same flat
colour, so the content has to pass underneath for the effect to mean anything.
`GlassSurface` is opaque when the knob is off, which is what keeps that one
code path instead of two.

**`wallpaperAnimation`** — `none`, `aurora`, `drift`, `pulse`, `liquid`. The
first three are soft blobs of the theme's own colours drifting behind the
thread, on the Reanimated UI thread, no gradient library. `primary` and `info`
are the two hues, so `info` is the handle a pack author has on what the
animation does. Suppressed when the OS asks for reduced motion.

`liquid` is drawn differently: one SkSL fragment shader in
[`LiquidBackdrop`](../../mobile/components/ui/liquid-backdrop.tsx) warps the
plane by itself a few times, so the two hues fold into each other like ink in
water, with a thin caustic glint along the folds. Uniforms come from Skia's
clock on the UI thread. It pauses (and resumes where it stopped) when its
screen is covered and freezes on a still frame under reduced motion. If the
shader fails to compile, the plain background remains.

### 2.4 Liquid

With `wallpaperAnimation: 'liquid'` **and** `glassChrome: true`
(`isLiquidLayout`), liquid reaches past the chat:

- The tab shell draws the liquid behind everything; the header turns
  transparent and groups its actions in a glass capsule.
- Screens inside the shell paint their ground with `useTheme().canvas`, which
  is `transparent` under liquid and `background` otherwise. Pushed screens
  keep `background`, or the screen under them would show through.
- The bottom bar floats as a glass capsule with a lit top rim. Its selection
  is one shape driven by the pager's `position`, so it tracks a swipe under
  the finger and stretches (`scaleX` 1.32) halfway between tabs.

The official **ZwoSocial Liquid** pack (`official-liquid`) turns it on. Its
opaque surfaces stay opaque (sheets and dialogs use them); translucency lives
in `surfaceMuted`, `border`, `divider` and the bubbles, which only sit on the
liquid. The flow is kept deep in dark mode and pale in light, so text
contrast comes from the ground, not from where the colour happens to be.

On Android, `expo-blur` without an experimental blur method renders glass as
a translucent tint rather than a real blur.

### 2.5 The launcher icon

Deliberately *not* part of a pack. Applying a theme changes bubble colours;
it must not quietly rearrange somebody's home screen. It is a preference of
its own in
[`mobile/data/theme-app-icons.ts`](../../mobile/data/theme-app-icons.ts), and
the four alternates are recolourings of the same artwork, named for the packs
they were drawn for.

Changing it is not a repaint: it asks the OS to swap a component alias, needs
the `expo-alternate-app-icons` plugin to have run through a prebuild, and on
iOS shows a system dialog the person can decline. The store records the new
icon only once the swap has actually happened, and the picker is hidden
entirely where the native side is absent — Expo Go and web — because a row of
tiles that silently does nothing is worse than no row.

---

## 3. Spacing

4px base unit. Use tokens, never raw numbers.

| Token | px |
|---|---|
| `xxs` | 2 |
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 24 |
| `xxl` | 32 |
| `xxxl` | 48 |

---

## 4. Radii

| Token | px | Usage |
|---|---|---|
| `none` | 0 | — |
| `sm` | 6 | Tags, micro-chips |
| `md` | 10 | Inputs, small buttons |
| `lg` | 14 | Cards, list rows |
| `xl` | 20 | Dialogs |
| `xxl` | 28 | Bottom sheets (top corners) |
| `pill` | 999 | Avatars, chips, badges, icon buttons |

Buttons and text fields are **not** pills: primary buttons use `lg`, fields
`md`. Floating action buttons are rounded squares (`lg + 2`), the shape both
platforms' current guidelines give them.

---

## 5. Typography

System fonts by default (`Fonts.sans`); a theme can pick a bundled family.
The scale is tight (about 1.2 between steps) and body is 16, the size both
platforms read at. Headings track slightly negative, which system faces need
at display sizes.

| Style | Size / Line | Weight | Tracking | Usage |
|---|---|---|---|---|
| `display` | 30 / 36 | 700 | -0.6 | Onboarding hero |
| `h1` | 26 / 32 | 700 | -0.5 | Step titles, large screen titles |
| `h2` | 21 / 26 | 700 | -0.3 | Wordmark, profile name |
| `h3` | 17 / 22 | 600 | -0.2 | Screen header titles, sheet titles |
| `body` | 16 / 22 | 400 | 0 | Default body, row labels |
| `bodyStrong` | 16 / 22 | 600 | 0 | Conversation name, buttons |
| `callout` | 15 / 20 | 400 | 0 | Message preview, row values |
| `caption` | 13 / 18 | 400 | 0 | Helper text, hints |
| `label` | 13 / 16 | 600 | 0 | Chips, segmented controls, sender names |
| `micro` | 12 / 16 | 500 | 0 | Timestamps, badges, uppercase section headers |

Numbers that change in place (timestamps, counters, OTP cells) use
`fontVariant: ['tabular-nums']` so they do not jitter.

Unread state is carried by the time and badge turning primary, not by
bolding the name and preview further.

---

## 5.1 Sizes and elevation

`Sizes` fixes the dimensions that must match from screen to screen.

| Token | px | Usage |
|---|---|---|
| `hitTarget` | 44 | Minimum touch target, header icon buttons on the home screen |
| `iconButton` | 40 | Back buttons and header actions elsewhere |
| `control` | 52 | Primary buttons, single-line fields, settings rows |
| `listAvatar` | 52 | Conversation and contact rows (fallback for `listAvatarSize`) |
| `headerAvatar` | 36 | Avatar in a header |
| `tabBar` | 64 | Bottom bar, excluding the home-indicator inset |

`Shadows` has two steps, both neutral black: `sm` for small floating
controls, `md` for the FAB. No coloured glows under buttons: the colour
already says "this is the action".

---

## 6. Component recipes

These are *examples* showing how tokens compose. Implement once in `mobile/components/ui/`.

### Primary CTA

Use `<PrimaryButton>`; do not rebuild it per screen.

```tsx
backgroundColor:   colors.primary,     // flat, no shadow
color:             colors.onPrimary,
borderRadius:      Radii.lg,           // 14
minHeight:         Sizes.control,      // 52
paddingHorizontal: Spacing.xl,         // 24
...Typography.bodyStrong
// pressed: opacity 0.88, scale 0.985
```

### Text field

`<TextField>`: `Radii.md`, `Sizes.control` tall, a 1px border that becomes a
2px primary ring on focus (padding gives back the extra pixel so the text does
not move). Label above in `label`, hint or error below in `caption`.

### Filter chip

32 tall, pill, no border. Inactive: `surfaceMuted` with `textSecondary`.
Active: primary at 14% opacity with `primary` text, never a solid fill.

### Secondary / text button ("Restore" in the reference)

```tsx
backgroundColor: 'transparent',
color:           Colors.light.text,
...Typography.bodyStrong
```

### Chat list row

```tsx
minHeight: 76, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
// avatar: layout.listAvatarSize (52), pill
// name:      colors.text,          ...Typography.bodyStrong
// preview:   colors.textSecondary, ...Typography.callout (text when unread)
// timestamp: colors.textMuted,     ...Typography.micro (primary when unread)
// unread badge: 22 tall, colors.primary / colors.onPrimary
// separator: hairline, inset to the text column
```

### Settings row

`Sizes.control` minimum height, 21px icon in `textSecondary`, label in
`body`, value in `callout`, chevron in `textMuted`. Dividers are hairlines
inset to the label so the icons read as one column; groups are hairline-
bordered `Radii.lg` cards under an uppercase `micro` header.

### Online status dot

```tsx
backgroundColor: Colors.light.success,  // #10B981
borderRadius:    Radii.pill,
width: 10, height: 10
```

---

## 7. Accessibility

- **Contrast** — body text on background ≥ 4.5:1 (WCAG AA). `neutral.900` on `neutral.50` ≈ 16:1 ✓. `brand.500` on white ≈ 5.9:1 ✓.
- **Touch targets** — minimum 44×44 px on iOS, 48×48 dp on Android. `Sizes.hitTarget` and `Sizes.control` exist so nobody has to remember the number.
- **Color is never the only signal** — pair online-green with a label, unread red with a count, etc.

---

## 8. Do / Don't

**Do**
- Use **primary** for *one* primary action per screen.
- Use **accents** only for content/identity (avatars, reactions, story rings).
- Compose new components from semantic tokens, not raw palette values.

**Don't**
- Don't introduce new hex values in components. Add to the palette first.
- Don't use a semantic color for decoration (e.g. `danger` for a divider).
- Don't mix accent colors and brand in the same control.

---

## 9. Source of truth

- Code: [`mobile/constants/theme.ts`](../../mobile/constants/theme.ts) — `Palette`, `Colors`, `Spacing`, `Radii`, `Typography`, `Sizes`, `Shadows`, `Fonts`.
- This document: human-readable rules and rationale.

When adding a token, update **both** in the same PR.
