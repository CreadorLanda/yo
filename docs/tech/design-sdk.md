# Yo design SDK/API

The theme creator uses a versioned, local design document. The implementation is
in `mobile/data/theme-sdk.ts`; it has no network or native dependency and can be
used by import/export tooling, tests, and future marketplace adapters.

## Format

```json
{
  "format": "yo.design",
  "version": 1,
  "theme": {
    "id": "theme_example",
    "name": "Example",
    "tokens": { "light": {}, "dark": {} },
    "chat": { "light": {}, "dark": {} },
    "layout": {},
    "icons": {}
  },
  "capabilities": {
    "semanticTokens": true,
    "chatChrome": true,
    "icons": true,
    "layout": true,
    "effects": {
      "deterministicAnimations": true,
      "reducedMotion": "system",
      "maxConcurrentLayers": 3
    }
  }
}
```

`createThemeDesign(theme)` creates a document in memory. `serializeThemeDesign`
validates it and returns JSON. `parseThemeDesign(json)` rejects malformed JSON,
unknown format/version, missing design sections, and invalid custom CSS.
`previewThemeDesign(document)` returns metadata only; it does not apply or write
anything. The store's `importThemeDesign` validates, creates a new owned pack,
persists it, and applies it. `exportThemeDesign` is read-only.

Publishing is currently local: `publishThemeToMarketplace(id)` validates the
same document contract and marks the owned pack as published. It does not claim
server publication, upload user files, or make the pack visible to other
accounts. A remote marketplace must be added as a separate authenticated API
adapter.

## CSS editor

The editor accepts only `:root` custom properties in `mobile/data/theme-css.ts`.
The allowlist covers semantic colors, chat chrome, bounded layout numbers,
booleans, and enumerated layout values. Colors are limited to hex/rgb/rgba;
wallpaper images are limited to local `file://` or `content://` URIs. Unknown
properties, selectors, URLs, CSS functions, malformed declarations, and values
outside the documented ranges produce diagnostics and are not applied. Preview
values are clamped defensively, while saving/publishing remains blocked until
the document is valid.

The editor provides a bounded undo/redo history and reset-to-template action.

## Wallpapers and effects

Chat and group wallpaper overrides are device-local and keyed by conversation
id. Picker images are copied into app-owned document storage before persistence;
replacing or removing an unreferenced image releases it. A per-conversation
override has precedence over the active theme and survives app restart.

Animations are a fixed enum (`none`, `aurora`, `drift`, `pulse`, `liquid`). They
use bounded native views, never execute code from a design document, and honor
the operating system's reduced-motion setting. `liquid` is a composed backdrop,
not an arbitrary Lottie/Skia payload; untrusted animation code is not accepted
by the format.
