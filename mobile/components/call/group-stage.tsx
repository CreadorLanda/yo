import { Ionicons } from '@expo/vector-icons';
import {
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallAvatar } from '@/components/call/call-ui';
import { Text } from '@/components/ui/text';
import { CallColors, Radii, Spacing, Typography } from '@/constants/theme';
import { callGrid, tileHueIndex } from '@/data/call-grid';
import { t } from '@/i18n';

const GAP = Spacing.sm;
const STRIP_TILE = 112;

const showsVideo = (tr: TrackReferenceOrPlaceholder) =>
  isTrackReference(tr) && tr.publication.kind === Track.Kind.Video && !tr.publication.isMuted;

const identityOf = (tr: TrackReferenceOrPlaceholder) => tr.participant.identity;

/**
 * A call with more than two people, as a room rather than a conversation.
 *
 * Everyone gets a tile, the person using the phone included, so it is clear at a
 * glance who is here. A ring shows who is talking, which is the question a call
 * with several voices keeps asking. Tapping a tile brings it to the front.
 */
export function GroupStage({
  title,
  status,
  tiles,
  notice,
  controls,
  onMinimize,
  onAddPeople,
}: {
  title: string;
  status: string;
  tiles: TrackReferenceOrPlaceholder[];
  notice: ReactNode;
  controls: ReactNode;
  onMinimize: () => void;
  onAddPeople: () => void;
}) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [focused, setFocused] = useState<string | null>(null);

  // The other people first: the tile of the person holding the phone is the
  // least interesting one on it.
  const ordered = useMemo(
    () => [...tiles].sort((a, b) => Number(a.participant.isLocal) - Number(b.participant.isLocal)),
    [tiles],
  );

  // They may have left since being tapped.
  const main = focused ? ordered.find((tr) => identityOf(tr) === focused) : undefined;
  const toggleFocus = (identity: string) => setFocused((f) => (f === identity ? null : identity));

  const onLayout = (e: LayoutChangeEvent) =>
    setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const grid = callGrid(ordered.length, area.w, area.h, GAP);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <RNStatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable
          onPress={onMinimize}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={t('call.minimize')}
        >
          <Ionicons name="chevron-down" size={22} color={CallColors.onStage} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {status}
          </Text>
        </View>
        <Pressable
          onPress={onAddPeople}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={t('call.add_people')}
        >
          <Ionicons name="person-add" size={19} color={CallColors.onStage} />
        </Pressable>
      </View>

      {notice}

      <View style={styles.stage} onLayout={onLayout}>
        {area.w === 0 ? null : main ? (
          <View style={styles.focus}>
            <Tile tile={main} style={styles.focusMain} large onPress={toggleFocus} />
            {ordered.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripRow}
                contentContainerStyle={styles.strip}
              >
                {ordered
                  .filter((tr) => identityOf(tr) !== focused)
                  .map((tr) => (
                    <Tile key={identityOf(tr)} tile={tr} style={styles.stripTile} onPress={toggleFocus} />
                  ))}
              </ScrollView>
            ) : null}
          </View>
        ) : (
          <ScrollView scrollEnabled={grid.scrolls} showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
            {ordered.map((tr, i) => {
              const last = grid.spanLast && i === ordered.length - 1;
              return (
                <Tile
                  key={identityOf(tr)}
                  tile={tr}
                  large={grid.columns === 1 || last}
                  style={{ width: last ? area.w : grid.tileWidth, height: grid.tileHeight }}
                  onPress={toggleFocus}
                />
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.dock}>{controls}</View>
    </SafeAreaView>
  );
}

function Tile({
  tile,
  style,
  large,
  onPress,
}: {
  tile: TrackReferenceOrPlaceholder;
  style: StyleProp<ViewStyle>;
  large?: boolean;
  onPress: (identity: string) => void;
}) {
  const { participant } = tile;
  const speaking = useIsSpeaking(participant);
  const muted = useIsMuted({ participant, source: Track.Source.Microphone });
  const name = participant.isLocal
    ? t('hangout.you')
    : participant.name || participant.identity;
  const hue = CallColors.tileHues[tileHueIndex(participant.identity, CallColors.tileHues.length)];

  return (
    <Pressable
      onPress={() => onPress(participant.identity)}
      style={[styles.tile, { backgroundColor: hue }, style]}
      accessibilityRole="button"
      accessibilityLabel={speaking ? `${name}. ${t('call.speaking')}` : name}
    >
      {showsVideo(tile) && isTrackReference(tile) ? (
        <VideoTrack
          trackRef={tile}
          style={StyleSheet.absoluteFillObject}
          objectFit="cover"
          mirror={participant.isLocal}
        />
      ) : (
        <View style={styles.tileCenter}>
          <CallAvatar name={participant.name || participant.identity} size={large ? 96 : 64} />
        </View>
      )}

      <View style={styles.nameTag}>
        {muted ? <Ionicons name="mic-off" size={12} color={CallColors.muted} /> : null}
        <Text style={styles.nameText} numberOfLines={1}>
          {name}
        </Text>
      </View>

      {/* Over the picture and never touched: a border on the tile itself would
          resize its contents each time someone drew breath. */}
      {speaking ? <View pointerEvents="none" style={styles.speakingRing} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CallColors.stage },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerText: { flex: 1 },
  title: { ...Typography.bodyStrong, color: CallColors.onStage },
  status: { ...Typography.caption, color: CallColors.onStageMuted, fontVariant: ['tabular-nums'] },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CallColors.tile,
  },
  stage: { flex: 1, marginHorizontal: Spacing.sm, marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  focus: { flex: 1, gap: GAP },
  focusMain: { flex: 1 },
  stripRow: { flexGrow: 0, height: STRIP_TILE },
  strip: { gap: GAP },
  stripTile: { width: STRIP_TILE, height: STRIP_TILE },
  tile: { borderRadius: Radii.lg, overflow: 'hidden' },
  tileCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nameTag: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    backgroundColor: CallColors.scrim,
  },
  nameText: { ...Typography.micro, color: CallColors.onStage, fontWeight: '600' },
  speakingRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radii.lg,
    borderWidth: 3,
    borderColor: CallColors.speaking,
  },
  dock: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    margin: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.xxl,
    backgroundColor: CallColors.tile,
  },
});
