# Yo — Design System

> Single source of truth for visual language across mobile, web and desktop.

The design language is **clean, playful and trustworthy**: airy backgrounds, a confident indigo primary action, and vivid accents reserved for avatars / status / reactions.

Tokens live in [`mobile/constants/theme.ts`](../../mobile/constants/theme.ts). This document is the human-readable companion — keep them in sync.

---

## 1. Color Palette

### 1.1 Brand (Royal Blue)

The primary action color. Used for CTAs, links, focused inputs, the active tab indicator, and selection.

| Token | Hex | Usage |
|---|---|---|
| `brand.50`  | `#EEF2FF` | Subtle tinted backgrounds, hovered surfaces |
| `brand.100` | `#E0E7FF` | Soft chips, pressed-state highlights |
| `brand.200` | `#C7D2FE` | Disabled primary, dividers in branded sections |
| `brand.300` | `#A5B4FC` | Decorative accents |
| `brand.400` | `#818CF8` | **Dark-mode primary** |
| `brand.500` | `#6366F1` | Decorative only — fails contrast as a primary |
| `brand.600` | `#4F46E5` | **Light-mode primary — CTA, links, focus ring** |
| `brand.700` | `#4338CA` | Hover / pressed primary |
| `brand.800` | `#3730A3` | Headings on tinted backgrounds |
| `brand.900` | `#312E81` | High-emphasis text on brand surfaces |

The hue comes from the logo, whose bubble is `#566EF7`.

Two shades carry the brand, not one, and neither is the bubble's own colour.
Measured against WCAG, `#566EF7` scores 4.23:1 with white text and 4.53:1 on
the dark background — it fails as an action colour in light mode and only
scrapes through in dark. `600` gives 6.29:1 with white text and 5.96:1 on the
light background; `400` gives 6.42:1 on dark. Same hue as the logo, moved for
legibility.

### 1.2 Neutral (Greys)

Backgrounds, surfaces, text and borders.

| Token | Hex | Usage |
|---|---|---|
| `neutral.0`    | `#FFFFFF` | Surface (cards, list rows, modals) |
| `neutral.50`   | `#F7F9FC` | App background (light) |
| `neutral.100`  | `#EEF1F6` | Page background tint, dividers |
| `neutral.200`  | `#E5E9F0` | Borders, separators |
| `neutral.300`  | `#D1D7E0` | Disabled borders, skeleton |
| `neutral.400`  | `#9AA3B2` | Muted text, inactive tab icon |
| `neutral.500`  | `#6B7280` | Secondary text, icon default |
| `neutral.600`  | `#4B5563` | Body emphasis |
| `neutral.700`  | `#374151` | Strong body text |
| `neutral.800`  | `#1F2937` | Headings |
| `neutral.900`  | `#111827` | Primary text |
| `neutral.1000` | `#0B1020` | App background (dark) |

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
| Background | `neutral.50` | `#F7F9FC` |
| Surface | `neutral.0` | `#FFFFFF` |
| Border | `neutral.200` | `#E5E9F0` |
| Divider | `neutral.100` | `#EEF1F6` |
| Text | `neutral.900` | `#111827` |
| Text secondary | `neutral.500` | `#6B7280` |
| Text muted | `neutral.400` | `#9AA3B2` |
| Primary | `brand.600` | `#4F46E5` |
| On-primary | `neutral.0` | `#FFFFFF` |
| Icon | `neutral.500` | `#6B7280` |
| Tab icon (inactive) | `neutral.400` | `#9AA3B2` |
| Tab icon (active) | `brand.600` | `#4F46E5` |

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
| Primary | `#818CF8` |
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

### 2.2 Typeface, true black, glass and motion

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

**`wallpaperAnimation`** — `none`, `aurora`, `drift`, `pulse`. Soft blobs of
the theme's own colours drifting behind the thread, on the Reanimated UI
thread, no gradient library. `primary` and `info` are the two hues, so `info`
is the handle a pack author has on what the aurora does. Suppressed when the
OS asks for reduced motion.

### 2.3 The launcher icon

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
| `xl` | 20 | Modals, sheets, primary CTA |
| `pill` | 999 | Avatars, FABs, status pills |

The reference design uses `xl` (20px) on the CTA button and `pill` on avatars.

---

## 5. Typography

System fonts for now (`Fonts.sans`). Custom font can be loaded later via `expo-font` without changing component code.

| Style | Size / Line | Weight | Usage |
|---|---|---|---|
| `display` | 32 / 40 | 700 | Onboarding hero ("Start a Fun Communication with Anonymity") |
| `h1` | 26 / 34 | 700 | Screen titles |
| `h2` | 22 / 30 | 600 | Section titles |
| `h3` | 18 / 26 | 600 | Card titles, chat names |
| `body` | 15 / 22 | 400 | Default body |
| `bodyStrong` | 15 / 22 | 600 | Unread row title, emphasis |
| `caption` | 13 / 18 | 400 | Last message preview, helper text |
| `micro` | 11 / 14 | 500 | Timestamps, badges |

---

## 6. Component recipes

These are *examples* showing how tokens compose. Implement once in `mobile/components/ui/`.

### Primary CTA (from reference design)

```tsx
backgroundColor: Colors.light.primary,    // #4F46E5
color:           Colors.light.onPrimary,  // #FFFFFF
borderRadius:    Radii.xl,                // 20
paddingVertical: Spacing.lg,              // 16
paddingHorizontal: Spacing.xl,            // 24
...Typography.bodyStrong
```

### Secondary / text button ("Restore" in the reference)

```tsx
backgroundColor: 'transparent',
color:           Colors.light.text,
...Typography.bodyStrong
```

### Chat list row

```tsx
backgroundColor: Colors.light.surface,
borderBottomColor: Colors.light.divider,
// avatar
borderRadius:    Radii.pill,
// name
color: Colors.light.text,  ...Typography.bodyStrong
// preview
color: Colors.light.textSecondary,  ...Typography.caption
// timestamp
color: Colors.light.textMuted,  ...Typography.micro
// unread badge
backgroundColor: Colors.light.primary,
color: Colors.light.onPrimary
```

### Online status dot

```tsx
backgroundColor: Colors.light.success,  // #10B981
borderRadius:    Radii.pill,
width: 10, height: 10
```

---

## 7. Accessibility

- **Contrast** — body text on background ≥ 4.5:1 (WCAG AA). `neutral.900` on `neutral.50` ≈ 16:1 ✓. `brand.500` on white ≈ 5.9:1 ✓.
- **Touch targets** — minimum 44×44 px on iOS, 48×48 dp on Android. Achievable with `Spacing.lg` vertical padding on a `body` row.
- **Color is never the only signal** — pair online-green with a label, unread red with a count, etc.

---

## 8. Do / Don't

**Do**
- Use **brand.500** for *one* primary action per screen.
- Use **accents** only for content/identity (avatars, reactions, story rings).
- Compose new components from semantic tokens, not raw palette values.

**Don't**
- Don't introduce new hex values in components. Add to the palette first.
- Don't use a semantic color for decoration (e.g. `danger` for a divider).
- Don't mix accent colors and brand in the same control.

---

## 9. Source of truth

- Code: [`mobile/constants/theme.ts`](../../mobile/constants/theme.ts) — `Palette`, `Colors`, `Spacing`, `Radii`, `Typography`, `Fonts`.
- This document: human-readable rules and rationale.

When adding a token, update **both** in the same PR.
