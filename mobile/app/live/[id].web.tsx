import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Live broadcasts are not available in the browser yet.
 *
 * The native screen is built on `@livekit/react-native`, which needs a native
 * WebRTC module. Calls have their own web screen on `livekit-client`; Lives
 * do not, so the browser says so instead of failing to load the bundle.
 */
export default function LiveScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <Ionicons name="radio-outline" size={44} color={colors.textMuted} />
        <Text style={[styles.text, { color: colors.text }]}>{t('live.web_unavailable')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={[styles.link, { color: colors.primary }]}>{t('common.close')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  text: { ...Typography.body, textAlign: 'center' },
  link: { ...Typography.bodyStrong },
});
