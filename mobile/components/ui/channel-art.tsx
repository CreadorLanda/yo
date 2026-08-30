import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageStyle } from 'expo-image';

import { CachedImage } from '@/components/ui/cached-image';
import { Text } from '@/components/ui/text';
import { Radii, Typography } from '@/constants/theme';

/**
 * A channel's logo and cover, with a generated stand-in when there is none.
 *
 * Generated rather than a stock file: a shared placeholder makes every
 * channel without art look like the same channel, which is worse than an
 * empty box because it reads as real. The colour is derived from the handle,
 * so a channel keeps the same look everywhere it appears and across devices
 * without anything being stored.
 */

/** Deterministic hue from a string. Same handle, same colour, always. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function channelAccent(seed: string): string {
  return `hsl(${hueFor(seed)}, 62%, 46%)`;
}

/** First letter of the name, falling back to the handle. */
function initial(name: string, handle: string): string {
  const source = name.trim() || handle.replace(/^@/, '');
  return (source.charAt(0) || '#').toUpperCase();
}

export function ChannelLogo({
  url,
  name,
  handle,
  size = 48,
  style,
}: {
  url?: string;
  name: string;
  handle: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const dimensions = { width: size, height: size, borderRadius: Radii.pill };

  if (url) {
    return (
      <CachedImage
        url={url}
        style={[dimensions, style] as StyleProp<ImageStyle>}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={[dimensions, styles.center, { backgroundColor: channelAccent(handle) }, style]}
      accessibilityLabel={name}
    >
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial(name, handle)}</Text>
    </View>
  );
}

export function ChannelCover({
  url,
  handle,
  style,
}: {
  url?: string;
  handle: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (url) {
    return <CachedImage url={url} style={style as StyleProp<ImageStyle>} contentFit="cover" />;
  }
  // Two tones of the same derived hue — enough to read as intentional, and
  // it cannot be mistaken for a photograph that failed to load.
  const h = hueFor(handle);
  return (
    <View style={[style, { backgroundColor: `hsl(${h}, 55%, 38%)`, overflow: 'hidden' }]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.coverBand,
          { backgroundColor: `hsl(${(h + 28) % 360}, 60%, 48%)` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  initial: { ...Typography.h2, color: '#FFFFFF', fontWeight: '700' },
  coverBand: { top: '45%', transform: [{ rotate: '-8deg' }], opacity: 0.55 },
});
