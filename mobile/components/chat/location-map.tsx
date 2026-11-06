import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { MAP_ZOOM, mapTiles, type LatLng } from '@/data/location-share';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Which app is asking. The tile host's usage policy requires an application to
 * identify itself, and a default HTTP-client agent is what gets blocked.
 */
const TILE_HEADERS = { 'User-Agent': 'ZwoSocial/1.0 (https://yo.alexandrelanda.com)' };

/**
 * A map of a small area with a pin in the middle.
 *
 * Built from tiles rather than a map SDK: this is a picture of where something
 * is, not a map to move around, and an SDK would add a native module, an API
 * key and a company that sees every position. The tile host is asked for an
 * area, which is all it learns.
 */
export function LocationMap({
  point,
  height,
  children,
}: {
  point: LatLng;
  height: number;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  const tiles = useMemo(
    () => (width > 0 ? mapTiles(point, width, height, MAP_ZOOM) : []),
    [point, width, height],
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View
      onLayout={onLayout}
      style={[styles.frame, { height, backgroundColor: colors.surfaceMuted }]}
      accessibilityIgnoresInvertColors
    >
      {tiles.map((tile) => (
        <Image
          key={`${tile.url}@${tile.left},${tile.top}`}
          source={{ uri: tile.url, headers: TILE_HEADERS }}
          style={[styles.tile, { left: tile.left, top: tile.top }]}
          cachePolicy="memory-disk"
          transition={120}
        />
      ))}

      {/* The foot of the pin is the point. */}
      <View pointerEvents="none" style={[styles.pin, { left: width / 2 - 17, top: height / 2 - 34 }]}>
        <Ionicons name="location" size={34} color={colors.danger} />
      </View>

      <View pointerEvents="none" style={styles.credit}>
        <Text style={styles.creditText}>{t('location.credit')}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: Radii.md, overflow: 'hidden' },
  tile: { position: 'absolute', width: 256, height: 256 },
  pin: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  credit: {
    position: 'absolute',
    right: Spacing.xs,
    bottom: 2,
    paddingHorizontal: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  creditText: { ...Typography.micro, fontSize: 9, color: '#333333' },
});
