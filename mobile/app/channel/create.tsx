import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { ChannelCover, ChannelLogo } from '@/components/ui/channel-art';
import { appAlert } from '@/data/dialog-store';
import { checkHandleAvailable } from '@/data/api/channels';
import { uploadMedia } from '@/data/api/media';
import {
  createChannel,
  isHandleAvailable,
  normalizeHandle,
  type ChannelVisibility,
  type JoinMode,
  type PostPermission,
} from '@/data/channel-store';
import { CHANNEL_CATEGORIES, type ChannelCategory } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const CATEGORIES = CHANNEL_CATEGORIES.filter((c) => c !== 'all') as Exclude<
  ChannelCategory,
  'all'
>[];

export default function CreateChannelScreen() {
  const { colors, isDark } = useTheme();

  // Local URIs until publish. Uploading on pick would leave orphaned files
  // on the server every time someone changes their mind and backs out.
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const pickImage = async (which: 'logo' | 'cover') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // Square for the logo, wide for the cover — cropping here beats
      // discovering the framing was wrong after publishing.
      aspect: which === 'logo' ? [1, 1] : [16, 9],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const uri = res.assets[0].uri;
    if (which === 'logo') setLogoUri(uri);
    else setCoverUri(uri);
  };

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Exclude<ChannelCategory, 'all'>>('tech');
  const [visibility, setVisibility] = useState<ChannelVisibility>('public');
  const [whoCanPost, setWhoCanPost] = useState<PostPermission>('admins');
  const [joinMode, setJoinMode] = useState<JoinMode>('open');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [allowAnonymousComments, setAllowAnonymousComments] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  const previewHandle = useMemo(() => {
    if (handle.trim()) return normalizeHandle(handle);
    if (name.trim()) return normalizeHandle(name);
    return '';
  }, [handle, name]);

  /**
   * Handle availability, asked of the server.
   *
   * The local check only knows about channels already loaded into this
   * device's store, so a handle someone else took anywhere in the world
   * read as free — and the failure surfaced as a rejected create with no
   * explanation of which field was wrong.
   *
   * The local check stays as the first gate: it costs nothing and catches
   * your own channels without a round trip.
   */
  const [remoteHandle, setRemoteHandle] = useState<{
    handle: string;
    available: boolean;
  } | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);

  useEffect(() => {
    if (previewHandle.length < 3 || !isHandleAvailable(previewHandle)) {
      setRemoteHandle(null);
      return;
    }
    let cancelled = false;
    setCheckingHandle(true);
    const timer = setTimeout(() => {
      checkHandleAvailable(previewHandle)
        .then((res) => {
          if (!cancelled) setRemoteHandle({ handle: previewHandle, available: res.available });
        })
        .catch(() => {
          // Offline: fall back to the local answer rather than blocking a
          // create over a check that could not run.
          if (!cancelled) setRemoteHandle({ handle: previewHandle, available: true });
        })
        .finally(() => {
          if (!cancelled) setCheckingHandle(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setCheckingHandle(false);
    };
  }, [previewHandle]);

  const remoteSaysTaken =
    remoteHandle?.handle === previewHandle && !remoteHandle.available;
  const handleOk =
    previewHandle.length >= 3 && isHandleAvailable(previewHandle) && !remoteSaysTaken;
  const canCreate = name.trim().length >= 2 && handleOk && !checkingHandle;

  const onCreate = async () => {
    if (!canCreate || uploading) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Upload first: a channel created with a half-finished upload would
    // show the generated art and never pick up the picture that was chosen.
    let avatarUrl: string | undefined;
    let coverUrl: string | undefined;
    if (logoUri || coverUri) {
      setUploading(true);
      try {
        if (logoUri) {
          avatarUrl = (await uploadMedia({ uri: logoUri, mimeType: 'image/jpeg' })).url;
        }
        if (coverUri) {
          coverUrl = (await uploadMedia({ uri: coverUri, mimeType: 'image/jpeg' })).url;
        }
      } catch {
        setUploading(false);
        appAlert(t('chats.action_failed_title'), t('channel_create.image_failed'));
        return;
      }
      setUploading(false);
    }

    const channel = createChannel({
      name,
      avatarUri: avatarUrl,
      coverUri: coverUrl,
      handle: previewHandle,
      description,
      category,
      visibility,
      whoCanPost,
      commentsEnabled,
      allowAnonymousComments,
      reactionsEnabled,
      joinMode,
    });
    router.replace(`/channel/${channel.id}`);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('channel_create.title')}</Text>
        <Pressable
          onPress={onCreate}
          disabled={!canCreate}
          style={[
            styles.createBtn,
            {
              backgroundColor: canCreate ? colors.primary : colors.surfaceMuted,
            },
          ]}
        >
          <Text
            style={[
              styles.createBtnText,
              { color: canCreate ? colors.onPrimary : colors.textMuted },
            ]}
          >
            {t('channel_create.create')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lead, { color: colors.textSecondary }]}>
          {t('channel_create.lead')}
        </Text>

        {/* Cover with the logo sitting on it, the way the channel will read.
            Both show the generated art until a picture is chosen, so the
            preview is never an empty grey box pretending to be a choice. */}
        <Pressable onPress={() => pickImage('cover')} style={styles.coverPick}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ChannelCover handle={previewHandle || name} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.coverScrim} />
          <View style={styles.coverHint}>
            <Ionicons name="image-outline" size={16} color="#FFFFFF" />
            <Text style={styles.coverHintText}>
              {coverUri ? t('channel_create.change_cover') : t('channel_create.add_cover')}
            </Text>
          </View>

          <Pressable
            onPress={() => pickImage('logo')}
            style={[styles.logoPick, { borderColor: colors.background }]}
          >
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.logoImg} contentFit="cover" />
            ) : (
              <ChannelLogo name={name} handle={previewHandle || name} size={64} />
            )}
            <View style={[styles.logoBadge, { backgroundColor: colors.primary }]}>
              <Ionicons name="camera" size={12} color={colors.onPrimary} />
            </View>
          </Pressable>
        </Pressable>

        <Text style={[styles.artHint, { color: colors.textMuted }]}>
          {t('channel_create.art_hint')}
        </Text>

        <Field label={t('channel_create.name')} colors={colors}>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (!handle) setHandle(normalizeHandle(v).replace(/^@/, ''));
            }}
            placeholder={t('channel_create.name_placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
            maxLength={60}
          />
        </Field>

        <Field label={t('channel_create.handle')} colors={colors}>
          <View
            style={[
              styles.handleRow,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: previewHandle
                  ? handleOk
                    ? colors.success
                    : colors.danger
                  : 'transparent',
              },
            ]}
          >
            <Text style={[styles.at, { color: colors.textSecondary }]}>@</Text>
            <TextInput
              value={handle.replace(/^@/, '')}
              onChangeText={(v) => setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder={t('channel_create.handle_placeholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.handleInput, { color: colors.text }]}
              maxLength={24}
            />
          </View>
          {previewHandle ? (
            <Text
              style={[
                styles.hint,
                {
                  color: checkingHandle
                    ? colors.textSecondary
                    : handleOk
                      ? colors.success
                      : colors.danger,
                },
              ]}
            >
              {/* "Checking" is its own state: showing "available" while the
                  request is still out invites a tap that then fails. */}
              {checkingHandle
                ? t('channel_create.handle_checking')
                : handleOk
                  ? t('channel_create.handle_ok', { handle: previewHandle })
                  : t('channel_create.handle_taken')}
            </Text>
          ) : null}
        </Field>

        <Field label={t('channel_create.description')} colors={colors}>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t('channel_create.description_placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              styles.textarea,
              { color: colors.text, backgroundColor: colors.surfaceMuted },
            ]}
            multiline
            maxLength={500}
          />
        </Field>

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('channel_create.category')}
        </Text>
        <View style={styles.chipWrap}>
          {CATEGORIES.map((cat) => {
            const active = category === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? colors.onPrimary : colors.textSecondary },
                  ]}
                >
                  {t(`discover.cat_${cat}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('channel_create.visibility')}
        </Text>
        <OptionCard
          active={visibility === 'public'}
          icon="globe-outline"
          title={t('channel_create.vis_public')}
          hint={t('channel_create.vis_public_hint')}
          onPress={() => setVisibility('public')}
          colors={colors}
        />
        <OptionCard
          active={visibility === 'private'}
          icon="lock-closed-outline"
          title={t('channel_create.vis_private')}
          hint={t('channel_create.vis_private_hint')}
          onPress={() => setVisibility('private')}
          colors={colors}
        />

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('channel_create.who_can_post')}
        </Text>
        {(
          [
            ['admins', t('channel_create.post_admins'), t('channel_create.post_admins_hint')],
            ['publishers', t('channel_create.post_publishers'), t('channel_create.post_publishers_hint')],
            ['everyone', t('channel_create.post_everyone'), t('channel_create.post_everyone_hint')],
          ] as const
        ).map(([id, title, hint]) => (
          <OptionCard
            key={id}
            active={whoCanPost === id}
            icon={
              id === 'admins'
                ? 'shield-checkmark-outline'
                : id === 'publishers'
                  ? 'create-outline'
                  : 'people-outline'
            }
            title={title}
            hint={hint}
            onPress={() => setWhoCanPost(id)}
            colors={colors}
          />
        ))}

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('channel_create.join_mode')}
        </Text>
        {(
          [
            ['open', t('channel_create.join_open'), t('channel_create.join_open_hint')],
            ['request', t('channel_create.join_request'), t('channel_create.join_request_hint')],
            ['invite', t('channel_create.join_invite'), t('channel_create.join_invite_hint')],
          ] as const
        ).map(([id, title, hint]) => (
          <OptionCard
            key={id}
            active={joinMode === id}
            icon={
              id === 'open' ? 'enter-outline' : id === 'request' ? 'hand-left-outline' : 'mail-outline'
            }
            title={title}
            hint={hint}
            onPress={() => setJoinMode(id)}
            colors={colors}
          />
        ))}

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('channel_create.engagement')}
        </Text>
        <ToggleRow
          title={t('channel_create.comments')}
          hint={t('channel_create.comments_hint')}
          value={commentsEnabled}
          onChange={setCommentsEnabled}
          colors={colors}
        />
        {commentsEnabled ? (
          <ToggleRow
            title={t('channel_create.anon_comments')}
            hint={t('channel_create.anon_comments_hint')}
            value={allowAnonymousComments}
            onChange={setAllowAnonymousComments}
            colors={colors}
          />
        ) : null}
        <ToggleRow
          title={t('channel_create.reactions')}
          hint={t('channel_create.reactions_hint')}
          value={reactionsEnabled}
          onChange={setReactionsEnabled}
          colors={colors}
        />

        <Pressable
          onPress={() => {
            if (!canCreate) {
              appAlert(t('channel_create.title'), t('channel_create.fill_required'));
              return;
            }
            onCreate();
          }}
          style={({ pressed }) => [
            styles.bottomCta,
            { backgroundColor: canCreate ? colors.primary : colors.surfaceMuted },
            pressed && canCreate && { opacity: 0.9 },
          ]}
        >
          <Ionicons
            name="radio-outline"
            size={18}
            color={canCreate ? colors.onPrimary : colors.textMuted}
          />
          <Text
            style={[
              styles.bottomCtaText,
              { color: canCreate ? colors.onPrimary : colors.textMuted },
            ]}
          >
            {t('channel_create.create')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  children,
  colors,
}: {
  label: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

function OptionCard({
  active,
  icon,
  title,
  hint,
  onPress,
  colors,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.option,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? `${colors.primary}10` : colors.surface,
        },
      ]}
    >
      <View
        style={[
          styles.optionIcon,
          { backgroundColor: active ? colors.primary : colors.surfaceMuted },
        ]}
      >
        <Ionicons name={icon} size={16} color={active ? colors.onPrimary : colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.optionHint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
      <Ionicons
        name={active ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={active ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onChange,
  colors,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.optionHint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        thumbColor="#FFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.bodyStrong, flex: 1, fontSize: 16 },
  createBtn: {
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: { ...Typography.caption, fontWeight: '700' },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  lead: { ...Typography.body, lineHeight: 21, marginBottom: Spacing.xs },
  field: { gap: 6 },
  label: { ...Typography.micro, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  coverPick: {
    height: 132,
    borderRadius: Radii.lg,
    overflow: 'visible',
    marginBottom: 34,
    justifyContent: 'flex-end',
  },
  coverScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: Radii.lg },
  coverHint: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  coverHintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  logoPick: {
    position: 'absolute',
    left: 16,
    bottom: -26,
    width: 68,
    height: 68,
    borderRadius: Radii.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: 62, height: 62, borderRadius: Radii.pill },
  logoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artHint: { fontSize: 12, marginBottom: 16 },
  input: {
    ...Typography.body,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
  },
  at: { ...Typography.bodyStrong, marginRight: 2 },
  handleInput: { ...Typography.body, flex: 1, paddingVertical: Spacing.md },
  hint: { ...Typography.micro, marginTop: 4 },
  section: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: Spacing.sm,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  chipText: { ...Typography.caption, fontWeight: '700' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
  },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: { ...Typography.bodyStrong, fontSize: 14 },
  optionHint: { ...Typography.caption, marginTop: 2, lineHeight: 17 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  bottomCta: {
    marginTop: Spacing.md,
    minHeight: 50,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  bottomCtaText: { ...Typography.bodyStrong },
});
