import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const alex = require('@/assets/images/alex.png');

const dicebear = (style: string, seed: string, bg: string) =>
  `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&backgroundColor=${bg.replace('#', '')}&size=240`;

const robohash = (seed: string, set: 'set1' | 'set2' | 'set3' | 'set4' | 'set5') =>
  `https://robohash.org/${encodeURIComponent(seed)}.png?set=${set}&size=240x240`;

type Bubble = {
  size: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  bg: string;
  source?: number | { uri: string };
  hero?: boolean;
};

const BUBBLES: Bubble[] = [
  { size: 70,  top: '0%',    left: '6%',   bg: Palette.accent.yellow, source: { uri: dicebear('lorelei', 'mira', Palette.accent.yellow) } },
  { size: 64,  top: '2%',    left: '40%',  bg: Palette.brand[200],    source: { uri: dicebear('avataaars', 'Anthony Web3', Palette.brand[200]) } },
  { size: 84,  top: '6%',    right: '4%',  bg: Palette.accent.purple, source: { uri: robohash('Nova', 'set1') } },

  { size: 132, top: '26%',   left: '14%',  bg: Palette.neutral[100],  source: alex, hero: true },
  { size: 76,  top: '32%',   left: '55%',  bg: Palette.accent.green,  source: { uri: dicebear('big-smile', 'Samuel Garu', Palette.accent.green) } },
  { size: 52,  top: '30%',   right: '4%',  bg: Palette.accent.pink,   source: { uri: robohash('Mia Kitten', 'set4') } },

  { size: 60,  top: '58%',   left: '2%',   bg: Palette.brand[400],    source: { uri: dicebear('pixel-art', 'Joe Felix', Palette.brand[400]) } },
  { size: 96,  bottom: '4%', left: '20%',  bg: Palette.accent.teal,   source: { uri: dicebear('micah', 'Margareth Joanne', Palette.accent.teal) } },
  { size: 70,  bottom: '8%', left: '60%',  bg: Palette.accent.yellow, source: { uri: dicebear('adventurer', 'Iris Sky', Palette.accent.yellow) } },
  { size: 56,  bottom: '0%', right: '8%',  bg: Palette.accent.red,    source: { uri: robohash('Zed Monster', 'set2') } },
];

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const handleCreateAccount = () => {
    router.push('/auth/phone');
  };

  const handleRestore = () => {
    router.push('/auth/phone');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={[styles.headline, { color: colors.text }]}>
          {t('onboarding.line1')}{'\n'}{t('onboarding.line2')}{'\n'}
          <Text style={[styles.headlineAccent, { color: colors.primary }]}>
            {t('onboarding.accent1')}{'\n'}{t('onboarding.accent2')}
          </Text>
        </Text>
      </View>

      <View style={styles.hero}>
        <View style={styles.bubbleField}>
          {BUBBLES.map((b, i) => (
            <View
              key={i}
              style={[
                styles.bubble,
                {
                  width: b.size,
                  height: b.size,
                  borderRadius: b.size / 2,
                  backgroundColor: b.bg,
                  top: b.top as any,
                  left: b.left as any,
                  right: b.right as any,
                  bottom: b.bottom as any,
                },
                b.hero && [styles.bubbleHero, { borderColor: colors.surface }],
              ]}
            >
              {b.source ? (
                <Image
                  source={b.source}
                  style={styles.bubbleImage}
                  contentFit="cover"
                  transition={250}
                />
              ) : null}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={handleCreateAccount}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary, shadowColor: colors.primary },
            pressed && styles.primaryButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.cta_create')}
        >
          <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
            {t('onboarding.cta_create')}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleRestore}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.cta_restore')}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
            {t('onboarding.cta_restore')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  headline: {
    ...Typography.display,
  },
  headlineAccent: {},
  hero: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  bubbleField: {
    flex: 1,
    position: 'relative',
  },
  bubble: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: Palette.neutral[900],
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  bubbleHero: {
    shadowColor: Palette.brand[900],
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
    borderWidth: 3,
  },
  bubbleImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  primaryButton: {
    borderRadius: Radii.xl,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    ...Typography.bodyStrong,
  },
  secondaryButton: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonPressed: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    ...Typography.bodyStrong,
  },
});
