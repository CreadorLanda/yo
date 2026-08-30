# 🎨 Customization

What a theme can change, and what it cannot. The token set and the rationale
are in [design-system.md](../tech/design-system.md#21-themes-on-top-of-the-tokens);
this page is the feature as somebody uses it.

Everything here is stored on-device and survives a restart. Nothing is
enabled by default — an app nobody has configured looks exactly as it always
did.

## Themes

Sixteen bundled packs, eight of them built around something other than
colour. A pack sets semantic tokens, chat chrome (bubbles, wallpaper, header,
composer), ~55 layout knobs and its icons; install one, apply it, or fork it
in the editor and change anything.

Personal overrides sit on top of whichever pack is active, so a bubble colour
you set yourself survives trying on a new theme.

## Typeface

Six choices: the system font, **Inter**, **Nunito**, **Lora**, **Space
Grotesk**, **JetBrains Mono**. The five named families ship with the app —
four weights each — so they work offline and there is no font download.

The system font is the default, and is the only one that keeps iOS dynamic
type: naming a font is what costs it those metrics.

## True black (AMOLED)

A switch, not a palette. It flattens dark backgrounds to `#000000` over
whichever pack is active, keeping that pack's colours — an OLED panel does not
light a black pixel, so the power saving is real, and there is no reason to
give up the theme you chose to get it. No effect in light mode.

## Frosted chrome

The chat header and composer blur what is behind them. The header floats over
the thread and the messages scroll underneath, which is the point — blur over
a flat colour is that same flat colour. Strength is adjustable.

## Wallpaper motion

`Aurora`, `Drift` or `Pulse`: slow movement behind the thread in the theme's
own colours, on top of a solid or photo wallpaper. Suppressed when the phone
is set to reduce motion.

## Bubble styles

`tail`, `rounded`, `pill` or `square`, with radius, padding, max width,
shadow, tails and which side your own messages sit on all adjustable
separately.

## Icons

In-app icons follow the theme: Ionicons outline, filled or sharp,
MaterialIcons, or an image of your own per slot. The slot list is a closed
one — the surfaces you look at all day, not all ~50 call sites.

## App icon

Four alternates for the home screen, recoloured from the same artwork and
named for the packs they were drawn for. Not part of any pack: applying a
theme should not rearrange your home screen.

Needs a native build — the picker does not appear in Expo Go or on the web,
because the OS-level swap it depends on is not there. On iOS the system shows
a confirmation you can decline.

## What does not exist

- **Dynamic / wallpaper-derived themes** (Material You). Not wired.
- **Per-conversation themes.** A theme is app-wide.
- **A real marketplace.** Seven of the packs listed are fictional third-party
  entries with invented authors; whether the marketplace becomes real or is
  removed is still open — see issue #114.
