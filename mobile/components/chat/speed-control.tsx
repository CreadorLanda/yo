import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';

/**
 * Playback-rate picker shared by voice notes and the video viewer, so the
 * two never drift apart on which rates exist.
 */

export const SPEEDS = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Next rate in the cycle — used by the compact tap-to-cycle pill. */
export function nextSpeed(current: number): Speed {
  const i = SPEEDS.indexOf(current as Speed);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

export function formatSpeed(s: number): string {
  return `${s % 1 === 0 ? s : s.toFixed(1)}×`;
}

/** Full picker, shown from the gear in the viewer. */
export function SpeedControl({
  speed,
  onChange,
  onClose,
  bottom,
}: {
  speed: number;
  onChange: (s: number) => void;
  onClose: () => void;
  bottom: number;
}) {
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.sheet, { bottom }]}>
        {SPEEDS.map((s) => {
          const active = Math.abs(s - speed) < 0.01;
          return (
            <Pressable
              key={s}
              onPress={() => {
                onChange(s);
                onClose();
              }}
              style={[styles.item, active && styles.itemActive]}
            >
              <Text style={[styles.itemText, active && styles.itemTextActive]}>
                {formatSpeed(s)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(20,20,24,0.95)',
    maxWidth: '90%',
  },
  item: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  itemActive: { backgroundColor: '#fff' },
  itemText: { ...Typography.caption, color: '#fff', fontWeight: '600' },
  itemTextActive: { color: '#111' },
});
