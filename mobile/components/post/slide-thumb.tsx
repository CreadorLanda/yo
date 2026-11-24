import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { CachedImage } from '@/components/ui/cached-image';
import { CameraColors } from '@/constants/theme';
import { ensureLocal, mediaIdFromURL, useCacheState } from '@/data/media-cache';

/**
 * First frames already pulled out of videos, by the uri they came from.
 *
 * Module-level so scrolling a grid back and forth does not decode the same
 * video again each time its tile comes on screen.
 */
const posters = new Map<string, string>();

/**
 * A still picture of one slide: the photo itself, or a video's first frame.
 *
 * The server stores no poster for a video, so the frame is taken on the
 * device, which means the file has to be here first. Until it is, the tile is
 * a plain surface with a play mark rather than a broken image.
 */
export function SlideThumb({
  uri,
  kind,
  style,
  contentFit = 'cover',
}: {
  /** A server path, or a local file. */
  uri: string;
  kind: 'image' | 'video';
  style?: StyleProp<ImageStyle & ViewStyle>;
  contentFit?: 'cover' | 'contain';
}) {
  if (kind === 'image') {
    return <CachedImage url={uri} style={style} contentFit={contentFit} />;
  }
  return <VideoPoster uri={uri} style={style} contentFit={contentFit} />;
}

function VideoPoster({
  uri,
  style,
  contentFit,
}: {
  uri: string;
  style?: StyleProp<ImageStyle & ViewStyle>;
  contentFit: 'cover' | 'contain';
}) {
  const local = useLocalMedia(uri, 'video/mp4');
  const [poster, setPoster] = useState<string | null>(posters.get(uri) ?? null);

  useEffect(() => {
    const known = posters.get(uri);
    if (known) {
      setPoster(known);
      return;
    }
    setPoster(null);
    if (!local) return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(local, { time: 0 })
      .then((frame) => {
        posters.set(uri, frame.uri);
        if (!cancelled) setPoster(frame.uri);
      })
      .catch(() => {
        // No frame is not an error worth showing: the play mark stays.
      });
    return () => {
      cancelled = true;
    };
  }, [uri, local]);

  if (poster) {
    return <Image source={{ uri: poster }} style={style} contentFit={contentFit} transition={140} />;
  }
  return (
    <View style={[style, styles.placeholder]}>
      <Ionicons name="play" size={20} color={CameraColors.onStageFaint} />
    </View>
  );
}

/**
 * A file on this device for a slide: at once for a local uri, after the
 * download for a server one. Null until then, or if it cannot be fetched.
 */
export function useLocalMedia(uri: string, mime: string): string | null {
  const remoteId = uri.startsWith('file:') ? null : mediaIdFromURL(uri);
  const cache = useCacheState(remoteId ?? undefined);

  useEffect(() => {
    if (remoteId) void ensureLocal(remoteId, { mime });
  }, [remoteId, mime]);

  if (!remoteId) return uri;
  return cache.status === 'ready' ? cache.uri : null;
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: CameraColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
