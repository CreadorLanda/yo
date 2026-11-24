import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Typography } from '@/constants/theme';

/**
 * The small pieces the camera and its composers share, so a round button over
 * the lens and one over a captured photo are the same button.
 */

export function Waveform({ live }: { live?: boolean }) {
  return (
    <View style={styles.waveform}>
      {Array.from({ length: 22 }, (_, i) => (
        <View
          key={i}
          style={[
            styles.waveBar,
            {
              height: live ? 6 + ((i * 7) % 18) : 4 + (i % 3) * 3,
              opacity: live ? 0.9 : 0.35,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function RoundBtn({
  icon,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.roundBtn, active && { backgroundColor: 'rgba(255,255,255,0.28)' }]}
      hitSlop={6}
    >
      <Ionicons name={icon} size={22} color="#FFF" />
    </Pressable>
  );
}

export function SideTool({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.sideTool, active && { opacity: 1 }]} hitSlop={4}>
      <Ionicons name={icon} size={22} color="#FFF" />
      <Text style={styles.sideToolLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: '#FFF' },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideTool: { alignItems: 'center', gap: 3, minWidth: 52 },
  sideToolLabel: { ...Typography.micro, color: '#FFF', fontWeight: '600', fontSize: 10 },
});
