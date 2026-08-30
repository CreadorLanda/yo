import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';

import { resolveIcon, type IconSlot } from '@/data/theme-icons';
import { useTheme } from '@/hooks/use-theme';

/**
 * An icon the active theme gets a say in.
 *
 * Call sites name what the icon *means* — `slot="send"` — and the theme
 * decides the drawing: which Ionicons/Material set, at what scale, or an image
 * the person picked instead. A plain `<Ionicons name="send" />` cannot be
 * themed, which is why every icon a theme can reach goes through here.
 *
 * `size` is the size the screen would have used. The theme's icon scale is
 * applied on top, so a layout tuned around a 22pt icon stays in proportion
 * when someone asks for larger icons everywhere.
 */
export function AppIcon({
  slot,
  size = 22,
  color,
}: {
  slot: IconSlot;
  size?: number;
  color: string;
}) {
  const { layout, icons } = useTheme();
  const resolved = resolveIcon(slot, layout.iconSet, icons);
  const px = Math.round(size * layout.iconScale);

  if (resolved.kind === 'image') {
    // Deliberately untinted: a custom icon is usually the point of being
    // custom, and painting it in the theme's foreground colour would reduce
    // someone's artwork to a silhouette.
    return (
      <Image
        source={{ uri: resolved.uri }}
        style={{ width: px, height: px }}
        contentFit="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }

  if (resolved.glyph.family === 'material') {
    return (
      <MaterialIcons
        name={resolved.glyph.name as ComponentProps<typeof MaterialIcons>['name']}
        size={px}
        color={color}
      />
    );
  }

  return (
    <Ionicons
      name={resolved.glyph.name as ComponentProps<typeof Ionicons>['name']}
      size={px}
      color={color}
    />
  );
}
