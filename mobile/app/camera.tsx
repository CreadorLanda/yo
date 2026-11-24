import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { CameraCapture } from '@/components/camera/camera-capture';
import { PostComposer } from '@/components/camera/post-composer';
import { StoryComposer } from '@/components/camera/story-composer';
import { CameraColors } from '@/constants/theme';
import { bakeFilter } from '@/data/bake-filter';
import { parseCameraMode, POST_MAX_ITEMS, type CameraMode, type CapturedItem } from '@/data/camera-modes';
import type { FilterId } from '@/data/photo-filters';

/**
 * The camera. Everything that is made with a lens starts here.
 *
 *   /camera                       a story, the default
 *   /camera?mode=post|reel|live   open on another mode
 *   /camera?forwardText=…&forwardMedia=…&forwardKind=video
 *                                 a message forwarded to a story: straight
 *                                 to the story editor, no lens
 *
 * One pipeline: capture, then the composer for whatever was captured. There
 * is no second camera screen for posts, reels or lives. The capture view
 * stays mounted underneath a composer with its lens released, so going back
 * to shoot again does not rebuild the camera.
 */
type Composing =
  | { kind: 'story'; item: CapturedItem | null; filter: FilterId; caption: string }
  | { kind: 'post' }
  | { kind: 'reel'; item: CapturedItem };

export default function CameraScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    title?: string;
    forwardText?: string;
    forwardMedia?: string;
    forwardKind?: string;
  }>();

  // A forward arrives with its content already chosen, so it starts in the
  // editor. Opening the lens would ask for something the person just handed
  // over.
  const forwarded = !!(params.forwardMedia || params.forwardText);
  const [mode, setMode] = useState<CameraMode>(parseCameraMode(params.mode));
  const [tray, setTray] = useState<CapturedItem[]>([]);
  const [composing, setComposing] = useState<Composing | null>(
    forwarded
      ? {
          kind: 'story',
          item: params.forwardMedia
            ? { uri: params.forwardMedia, kind: params.forwardKind === 'video' ? 'video' : 'image' }
            : null,
          filter: 'none',
          caption: params.forwardText ?? '',
        }
      : null,
  );

  const leaveComposer = useCallback(() => {
    // Nothing to go back to when the editor was the way in.
    if (forwarded) router.back();
    else setComposing(null);
  }, [forwarded]);

  // The hardware back button leaves the composer before it leaves the camera.
  useEffect(() => {
    if (!composing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveComposer();
      return true;
    });
    return () => sub.remove();
  }, [composing, leaveComposer]);

  const addToTray = (items: CapturedItem[]) => {
    setTray((current) => [...current, ...items].slice(0, POST_MAX_ITEMS));
  };

  const onCapture = async (item: CapturedItem, filter: FilterId) => {
    if (mode === 'story') {
      // The story editor can still change the filter, so it is handed over
      // rather than written into the file here.
      setComposing({ kind: 'story', item, filter, caption: '' });
      return;
    }
    if (mode === 'reel') {
      setComposing({ kind: 'reel', item });
      return;
    }
    // A post has no editor: what the viewfinder showed is what goes in the
    // carousel, so the filter is baked now.
    const uri = item.kind === 'image' ? await bakeFilter(item.uri, filter) : item.uri;
    addToTray([{ ...item, uri }]);
  };

  const onLibrary = (items: CapturedItem[]) => {
    if (mode === 'story') {
      setComposing({ kind: 'story', item: items[0], filter: 'none', caption: '' });
    } else if (mode === 'reel') {
      setComposing({ kind: 'reel', item: items[0] });
    } else {
      // Picked rather than shot: the choosing is done, go on to share.
      addToTray(items);
      setComposing({ kind: 'post' });
    }
  };

  const removeFromTray = (index: number) => {
    setTray((current) => current.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {forwarded ? null : (
        <CameraCapture
          active={!composing}
          mode={mode}
          onModeChange={setMode}
          tray={tray}
          onCapture={onCapture}
          onLibrary={onLibrary}
          onStoryText={() => setComposing({ kind: 'story', item: null, filter: 'none', caption: '' })}
          onTrayRemove={removeFromTray}
          onTrayNext={() => setComposing({ kind: 'post' })}
          liveTitle={params.title}
          onClose={() => router.back()}
        />
      )}

      {composing ? (
        <View style={styles.composer}>
          {composing.kind === 'story' ? (
            <StoryComposer
              // A new capture is a new story: nothing typed on the last one carries over.
              key={composing.item?.uri ?? 'text'}
              item={composing.item}
              initialFilter={composing.filter}
              initialCaption={composing.caption}
              onDiscard={leaveComposer}
            />
          ) : composing.kind === 'reel' ? (
            <PostComposer kind="reel" items={[composing.item]} onRemove={() => {}} onBack={leaveComposer} />
          ) : (
            <PostComposer kind="post" items={tray} onRemove={removeFromTray} onBack={leaveComposer} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.stage },
  composer: { ...StyleSheet.absoluteFillObject, backgroundColor: CameraColors.stage },
});
