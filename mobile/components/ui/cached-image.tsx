import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import type { MediaKey } from '@/data/crypto/media-crypto';
import { ensureLocal, mediaIdFromURL, useCacheState } from '@/data/media-cache';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Image backed by the media cache.
 *
 * Server media is no longer readable by URL — the endpoint needs an auth
 * header and the bytes may be encrypted — so nothing can point <Image> at
 * it directly. This fetches through the cache and renders the decrypted
 * local file.
 *
 * With `manual`, nothing downloads until the user taps: the placeholder
 * shows the size instead. That is the default for anything large.
 */
export function CachedImage({
  url,
  mediaKey,
  mime,
  style,
  contentFit = 'cover',
  manual = false,
  sizeBytes,
  transition = 140,
  onLongPress,
}: {
  /** Server path or absolute URL; local file:// URIs render directly. */
  url: string;
  mediaKey?: MediaKey | null;
  mime?: string;
  /** Shared by the image and its placeholder, so both size identically. */
  style?: StyleProp<ImageStyle & ViewStyle>;
  contentFit?: ImageContentFit;
  manual?: boolean;
  sizeBytes?: number;
  transition?: number;
  /**
   * Forwarded to the placeholder. It is a Pressable, so without this the
   * bubble's long-press menu was unreachable until the image finished
   * downloading — exactly when you most want "retry" or "delete".
   */
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const isLocal = url.startsWith('file:') || url.startsWith('data:');
  const id = isLocal ? null : mediaIdFromURL(url);
  // Anything that is not one of our media objects — an avatar service, a
  // remote thumbnail — has no cache entry and never will. Without this it
  // would sit on the placeholder forever, since the placeholder is what
  // renders whenever there is no id to wait on.
  const isForeign = !isLocal && id === null;
  const state = useCacheState(id ?? undefined);

  useEffect(() => {
    if (!id || manual) return;
    void ensureLocal(id, { key: mediaKey, mime });
    // mediaKey is a fresh object each render; its identity would loop here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manual, mime]);

  if (isLocal || isForeign) {
    return <Image source={{ uri: url }} style={style} contentFit={contentFit} transition={transition} />;
  }

  if (state.status === 'ready') {
    return (
      <Image source={{ uri: state.uri }} style={style} contentFit={contentFit} transition={transition} />
    );
  }

  const download = () => {
    if (id) void ensureLocal(id, { key: mediaKey, mime });
  };

  return (
    <Pressable
      onPress={state.status === 'downloading' ? undefined : download}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[styles.placeholder, { backgroundColor: colors.surfaceMuted }, style]}
    >
      {state.status === 'downloading' ? (
        <ActivityIndicator color={colors.primary} />
      ) : state.status === 'failed' ? (
        <View style={styles.center}>
          <Ionicons
            name={state.reason === 'expired' ? 'time-outline' : 'refresh'}
            size={22}
            color={colors.textMuted}
          />
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {state.reason === 'expired' ? t('media.expired') : t('media.retry')}
          </Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Ionicons name="arrow-down-circle-outline" size={26} color={colors.primary} />
          {sizeBytes ? (
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              {formatBytes(sizeBytes)}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** Human-readable file size, used by every media placeholder. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  center: { alignItems: 'center', gap: Spacing.xs },
  label: { ...Typography.micro },
});
