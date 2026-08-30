import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { CachedImage } from '@/components/ui/cached-image';
import { appAlert } from '@/data/dialog-store';
import { MIN_STICKERS, type StickerPackDTO } from '@/data/api/stickers';
import {
  commitImport,
  previewFromBundle,
  previewFromFiles,
  type ImportPreview,
} from '@/data/sticker-import';
import {
  folderImportSupported,
  requestFolder,
  savedFolder,
  scanFolder,
  splitIntoPacks,
} from '@/data/sticker-folder';
import { bootstrapStickers, importPack, removePack, useStickerPacks } from '@/data/sticker-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function StickersScreen() {
  const { colors, isDark } = useTheme();
  const { packs, loaded } = useStickerPacks();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [packName, setPackName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void bootstrapStickers();
  }, []);

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        // .wastickers has no registered MIME type, so accept anything and
        // sort it out by extension below.
        type: ['image/webp', 'application/zip', 'application/octet-stream', '*/*'],
      });
      if (res.canceled || !res.assets?.length) return;

      setBusy(true);
      const bundle = res.assets.find((a) => /\.(wastickers|zip)$/i.test(a.name));
      const next = bundle
        ? await previewFromBundle(bundle.uri, bundle.name)
        : await previewFromFiles(res.assets.map((a) => ({ uri: a.uri, name: a.name })));

      setPreview(next);
      setPackName(next.packName);
    } catch {
      appAlert(t('stickers.import_failed_title'), t('stickers.import_failed_body'));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setBusy(true);
    setProgress({ done: 0, total: preview.stickers.length });
    try {
      const body = await commitImport(preview, packName, (done, total) =>
        setProgress({ done, total }),
      );
      await importPack(body);
      setPreview(null);
      setPackName('');
    } catch (err) {
      const key = err instanceof Error ? err.message : '';
      appAlert(
        t('stickers.import_failed_title'),
        key === 'too_few_stickers'
          ? t('stickers.too_few', { min: MIN_STICKERS })
          : t('stickers.import_failed_body'),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /**
   * Bulk import from a granted folder. One tap the first time; after that
   * the grant persists and re-scanning needs no prompt.
   */
  const importFolder = async () => {
    setBusy(true);
    try {
      const dir = (await savedFolder()) ?? (await requestFolder());
      if (!dir) return;

      setProgress({ done: 0, total: 0 });
      const scanned = await scanFolder(dir, (done, total) => setProgress({ done, total }));
      if (scanned.stickers.length < MIN_STICKERS) {
        appAlert(t('stickers.import_failed_title'), t('stickers.too_few', { min: MIN_STICKERS }));
        return;
      }

      const chunks = splitIntoPacks(scanned, t('stickers.folder_pack_name'));
      for (const chunk of chunks) {
        const body = await commitImport(chunk, chunk.packName, (done, total) =>
          setProgress({ done, total }),
        );
        await importPack(body);
      }
      appAlert(
        t('stickers.folder_done_title'),
        t('stickers.folder_done_body', { packs: chunks.length, count: scanned.stickers.length }),
      );
    } catch {
      appAlert(t('stickers.import_failed_title'), t('stickers.folder_failed_body'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const confirmDelete = (pack: StickerPackDTO) => {
    appAlert(t('stickers.delete_title'), t('stickers.delete_body', { name: pack.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chats.delete'),
        style: 'destructive',
        onPress: () => {
          removePack(pack.id).catch(() =>
            appAlert(t('chats.action_failed_title'), t('chats.action_failed_body')),
          );
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('stickers.title')}</Text>
        {folderImportSupported ? (
          <Pressable onPress={importFolder} hitSlop={12} style={styles.iconBtn} disabled={busy}>
            <Ionicons
              name="folder-open-outline"
              size={21}
              color={busy ? colors.textMuted : colors.textSecondary}
            />
          </Pressable>
        ) : null}
        <Pressable onPress={pick} hitSlop={12} style={styles.iconBtn} disabled={busy}>
          <Ionicons name="add" size={24} color={busy ? colors.textMuted : colors.primary} />
        </Pressable>
      </View>

      {preview ? (
        <ImportSheet
          preview={preview}
          packName={packName}
          onChangeName={setPackName}
          onCancel={() => setPreview(null)}
          onConfirm={confirmImport}
          busy={busy}
          progress={progress}
        />
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loaded ? (
              <View style={styles.empty}>
                <Ionicons name="happy-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {t('stickers.empty_title')}
                </Text>
                <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                  {t('stickers.empty_hint')}
                </Text>
                <Pressable
                  onPress={pick}
                  style={[styles.cta, { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.ctaText, { color: colors.onPrimary }]}>
                    {t('stickers.import_cta')}
                  </Text>
                </Pressable>
                {folderImportSupported ? (
                  <Pressable onPress={importFolder} disabled={busy} style={styles.linkBtn}>
                    <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
                    <Text style={[styles.linkText, { color: colors.primary }]}>
                      {t('stickers.import_folder')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ActivityIndicator style={{ marginTop: Spacing.xl }} color={colors.primary} />
            )
          }
          renderItem={({ item }) => (
            <Animated.View entering={FadeIn} exiting={FadeOut} layout={Layout.springify()}>
              <Pressable
                onLongPress={() => confirmDelete(item)}
                style={({ pressed }) => [
                  styles.packRow,
                  { backgroundColor: colors.surface },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <CachedImage
                  url={item.tray_url ?? item.stickers?.[0]?.url ?? ''}
                  style={styles.packTray}
                  contentFit="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.packName, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.packMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {t('stickers.pack_meta', { count: item.count })}
                    {item.animated ? ` · ${t('stickers.animated')}` : ''}
                    {item.author ? ` · ${item.author}` : ''}
                  </Text>
                </View>
                <Pressable onPress={() => confirmDelete(item)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </Pressable>
            </Animated.View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

/** Review step: what will be imported, and what was skipped and why. */
function ImportSheet({
  preview,
  packName,
  onChangeName,
  onCancel,
  onConfirm,
  busy,
  progress,
}: {
  preview: ImportPreview;
  packName: string;
  onChangeName: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  progress: { done: number; total: number } | null;
}) {
  const { colors } = useTheme();
  const enough = preview.stickers.length >= MIN_STICKERS;

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        {t('stickers.pack_name')}
      </Text>
      <TextInput
        value={packName}
        onChangeText={onChangeName}
        placeholder={t('stickers.pack_name_placeholder')}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
        editable={!busy}
      />

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        {t('stickers.will_import', { count: preview.stickers.length })}
        {preview.animated ? ` · ${t('stickers.animated')}` : ''}
      </Text>
      <View style={styles.previewGrid}>
        {preview.stickers.map((s, i) => (
          <Animated.View key={`${s.name}-${i}`} entering={FadeIn.delay(i * 20)}>
            <View style={[styles.previewCell, { backgroundColor: colors.surface }]}>
              <Image
                source={{ uri: toDataURI(s.bytes) }}
                style={styles.previewImg}
                contentFit="contain"
                autoplay
              />
            </View>
          </Animated.View>
        ))}
      </View>

      {preview.rejected.length > 0 ? (
        <View style={[styles.rejected, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={[styles.rejectedText, { color: colors.textSecondary }]}>
            {t('stickers.skipped', { count: preview.rejected.length })}
          </Text>
        </View>
      ) : null}

      {!enough ? (
        <Text style={[styles.warn, { color: colors.danger }]}>
          {t('stickers.too_few', { min: MIN_STICKERS })}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={[styles.btn, { backgroundColor: colors.surfaceMuted }]}
        >
          <Text style={[styles.btnText, { color: colors.text }]}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={busy || !enough}
          style={[
            styles.btn,
            { backgroundColor: enough ? colors.primary : colors.surfaceMuted, opacity: busy ? 0.7 : 1 },
          ]}
        >
          {busy ? (
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>
              {progress ? `${progress.done}/${progress.total}` : '…'}
            </Text>
          ) : (
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>
              {t('stickers.import_confirm')}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Preview straight from memory — the files are not uploaded yet. */
function toDataURI(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/webp;base64,${global.btoa(binary)}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    height: 52,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.h3, flex: 1, textAlign: 'center' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.md,
  },
  packTray: { width: 44, height: 44 },
  packName: { ...Typography.bodyStrong },
  packMeta: { ...Typography.caption },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.xl * 2 },
  emptyTitle: { ...Typography.h3 },
  emptyHint: { ...Typography.body, textAlign: 'center', paddingHorizontal: Spacing.xl },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  linkText: { ...Typography.body, fontWeight: '600' },
  cta: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
  },
  ctaText: { ...Typography.bodyStrong },
  sectionLabel: { ...Typography.caption, marginTop: Spacing.sm },
  input: {
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
  },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  previewCell: {
    width: 72,
    height: 72,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  previewImg: { width: '100%', height: '100%' },
  rejected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radii.sm,
  },
  rejectedText: { ...Typography.caption, flex: 1 },
  warn: { ...Typography.caption },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  btn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radii.md,
    alignItems: 'center',
  },
  btnText: { ...Typography.bodyStrong },
});
