import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveSetupForm } from '@/components/live/live-setup-form';
import { Text } from '@/components/ui/text';
import { CameraColors, Spacing, Typography } from '@/constants/theme';
import { t } from '@/i18n';

/**
 * Going live from a place: a direct chat (a joint live), a group, a channel.
 *
 *   /live/setup?chat=<id>       a direct chat (joint live) or a group
 *   /live/setup?channel=<id>    a channel
 *
 * A live with no place starts from the camera's LIVE mode instead, which
 * shows the same form over the lens. This screen has no camera of its own.
 */
export default function LiveSetupScreen() {
  const params = useLocalSearchParams<{ chat?: string; channel?: string; title?: string }>();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={24} color={CameraColors.onStage} />
          </Pressable>
          <Text style={styles.heading}>{t('live.setup_title')}</Text>
          <View style={styles.iconBtn} />
        </View>

        <LiveSetupForm chat={params.chat} channel={params.channel} initialTitle={params.title} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.stage },
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    height: 56,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { ...Typography.h3, color: CameraColors.onStage },
});
