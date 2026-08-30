import { Image } from 'expo-image';
import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageStyle } from 'expo-image';
import { SvgXml } from 'react-native-svg';

import { avatarSeed, defaultAvatarSvg } from '@/data/default-avatar';
import { useTheme } from '@/hooks/use-theme';

/**
 * Somebody's picture, or the one they were given.
 *
 * The app used to render `<Image source={{ uri: avatarUri }} />` directly, so
 * an account with no photo — and one whose photo is hidden by
 * `photo_visibility` — showed an empty grey circle. A list of grey circles is
 * a list you cannot read at a glance, which is most of what a chat list is
 * for.
 *
 * The generated face is deterministic from the id, so it is not a placeholder
 * that changes: it is that person's face until they choose another, on every
 * device, with nothing stored and no request made.
 */
export function Avatar({
  uri,
  id,
  username,
  size = 48,
  style,
}: {
  /** Their photo. Absent, empty, or hidden by their settings — all the same here. */
  uri?: string | null;
  id?: string;
  username?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const seed = avatarSeed({ id, username });

  // Rounded to a few sizes rather than the exact pixel value: a list, a header
  // and a picker ask for 40, 44 and 48, and caching three near-identical SVGs
  // per person is three times the work for a difference nobody can see.
  const bucket = size <= 32 ? 32 : size <= 48 ? 48 : size <= 72 ? 72 : 128;
  const svg = useMemo(
    () => (uri ? null : defaultAvatarSvg(seed, bucket)),
    [uri, seed, bucket],
  );

  // The two branches want different style types — expo-image takes an
  // ImageStyle, a View takes a ViewStyle — and the shared shape is the
  // intersection of both, so it is built once and cast at each use.
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden' as const,
  };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[frame, style as StyleProp<ImageStyle>]}
        contentFit="cover"
      />
    );
  }

  return (
    <View style={[frame, style]}>
      {svg ? <SvgXml xml={svg} width={size} height={size} /> : null}
    </View>
  );
}
