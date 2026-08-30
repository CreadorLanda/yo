import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useRegistration } from '@/store/registration';

type Toggle = {
  key: 'contacts' | 'notifications';
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  subtitleKey: string;
};

const TOGGLES: Toggle[] = [
  {
    key: 'contacts',
    icon: 'people',
    titleKey: 'auth.permissions.contacts_title',
    subtitleKey: 'auth.permissions.contacts_subtitle',
  },
  {
    key: 'notifications',
    icon: 'notifications',
    titleKey: 'auth.permissions.notifications_title',
    subtitleKey: 'auth.permissions.notifications_subtitle',
  },
];

export default function PermissionsScreen() {
  const { data, set, reset } = useRegistration();
  const [contacts, setContacts] = useState(data.contactsGranted);
  const [notifications, setNotifications] = useState(data.notificationsGranted);
  const { colors } = useTheme();

  const handleFinish = () => {
    set('contactsGranted', contacts);
    set('notificationsGranted', notifications);
    // Last step of onboarding — clear the wizard state before entering the app.
    reset();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <StepHeader
        step={5}
        total={5}
        title={t('auth.permissions.title')}
        subtitle={t('auth.permissions.subtitle')}
      />

      <View style={styles.body}>
        {TOGGLES.map((item) => {
          const value = item.key === 'contacts' ? contacts : notifications;
          const onChange = item.key === 'contacts' ? setContacts : setNotifications;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(!value)}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: value }}
            >
              <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons name={item.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.text}>
                <Text style={[styles.title, { color: colors.text }]}>{t(item.titleKey)}</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {t(item.subtitleKey)}
                </Text>
              </View>
              <Switch
                value={value}
                onValueChange={onChange}
                trackColor={{ false: colors.divider, true: colors.primary }}
                thumbColor={value ? colors.primary : colors.surface}
                ios_backgroundColor={colors.divider}
              />
            </Pressable>
          );
        })}

        <View style={styles.notice}>
          <Ionicons name="lock-closed" size={16} color={colors.success} />
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            {t('auth.permissions.e2e_notice')}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label={t('auth.permissions.cta')} onPress={handleFinish} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    borderWidth: 1,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { ...Typography.bodyStrong },
  subtitle: { ...Typography.caption, marginTop: 2 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  noticeText: { ...Typography.caption, flex: 1 },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
});
