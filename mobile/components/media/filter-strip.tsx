import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  useImage,
} from '@shopify/react-native-skia';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { FILTERS, type FilterId } from '@/data/photo-filters';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const THUMB = 56;

/**
 * The filter picker.
 *
 * Each thumbnail is the actual photo through the actual matrix, not a coloured
 * square: picking a filter from a swatch means guessing how it lands on your
 * face, and the guess is usually wrong. It costs one decode — every tile
 * shares the same decoded image and differs only by the paint.
 */
export function FilterStrip({
  uri,
  value,
  onChange,
}: {
  uri: string;
  value: FilterId;
  onChange: (id: FilterId) => void;
}) {
  const { colors } = useTheme();
  const image = useImage(uri);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FILTERS.map((f) => {
        const active = f.id === value;
        return (
          <Pressable key={f.id} onPress={() => onChange(f.id)} style={styles.cell}>
            <View
              style={[
                styles.thumb,
                { borderColor: active ? colors.primary : 'transparent' },
              ]}
            >
              {image ? (
                <Canvas style={styles.canvas}>
                  <SkiaImage
                    image={image}
                    x={0}
                    y={0}
                    width={THUMB}
                    height={THUMB}
                    fit="cover"
                  >
                    {/* No matrix for `none`, so the identity is never applied —
                        multiplying every pixel by 1 costs the same as a real
                        filter and shows nothing for it. */}
                    {f.matrix ? <ColorMatrix matrix={f.matrix} /> : null}
                  </SkiaImage>
                </Canvas>
              ) : (
                <View style={[styles.canvas, { backgroundColor: colors.surfaceMuted }]} />
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: active ? colors.primary : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {t(`filters.${f.nameKey}`)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  cell: { alignItems: 'center', gap: 4, width: THUMB + 8 },
  thumb: {
    width: THUMB + 4,
    height: THUMB + 4,
    borderRadius: Radii.md,
    borderWidth: 2,
    padding: 2,
    overflow: 'hidden',
  },
  canvas: { width: THUMB, height: THUMB, borderRadius: Radii.sm - 2, overflow: 'hidden' },
  label: { ...Typography.micro },
});
