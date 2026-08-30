import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';

import { AnonInbox } from '@/components/story/anon-inbox';
import { ReactionBar } from '@/components/story/reaction-bar';
import { StoryVideo } from '@/components/story/story-video';
import { Text, TextInput } from '@/components/ui/text';
import { appAlert } from '@/data/dialog-store';
import { ViewersSheet } from '@/components/story/viewers-sheet';
import { CachedImage } from '@/components/ui/cached-image';
import { ensureLocal, mediaIdFromURL } from '@/data/media-cache';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SlideSwap } from '@/components/ui/slide-swap';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  addComment,
  deleteStory,
  listComments,
  deleteComment,
  viewStory,
  writeAnon,
  type StoryCommentDTO,
} from '@/data/api/stories';
import type { Story, StoryComment } from '@/data/mock';
import { toggleReaction } from '@/data/story-reactions';
import {
  bootstrapStories,
  ensureStory,
  markStoryViewedLocal,
  removeStoryLocal,
  setStoryReactions,
  useStories,
} from '@/data/story-store';
import { t } from '@/i18n';

type ReplyMode = 'comment' | 'private';

/** Poll/question captions may be plain text or JSON `{ q, a?, b? }`. */
function parseInteractiveCaption(
  caption: string,
  kind: string,
): { q: string; a?: string; b?: string } {
  const trimmed = (caption || '').trim();
  if ((kind === 'poll' || kind === 'question') && trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as { q?: string; a?: string; b?: string };
      return { q: o.q || trimmed, a: o.a, b: o.b };
    } catch {
      /* fall through */
    }
  }
  return { q: trimmed };
}

export default function StoryViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const allStories = useStories();
  // Include own stories so "Your frame" opens the real API story.
  const visibleStories = allStories;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [reactBurst, setReactBurst] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [replyMode, setReplyMode] = useState<ReplyMode>('comment');
  const [replyAnonymous, setReplyAnonymous] = useState(false);
  const [localComments, setLocalComments] = useState<Record<string, StoryComment[]>>({});
  const [hydrating, setHydrating] = useState(true);

  // Ensure feed + target story exist from the API (no mock fallback).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHydrating(true);
      await bootstrapStories().catch(() => {});
      if (id) await ensureStory(id).catch(() => {});
      if (!cancelled) setHydrating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * Position on the story the route asked for — once.
   *
   * `id` is fixed for the life of this screen, but `visibleStories` gets a
   * new identity on every store emit, and marking a story viewed is itself
   * an emit. Re-running meant advancing to the second story marked it seen,
   * which fired this, which found the original id back at index 0 and threw
   * the viewer there — so it was impossible to move past the first one.
   */
  const positionedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!id || visibleStories.length === 0) return;
    if (positionedFor.current === id) return;
    const found = visibleStories.findIndex((item) => item.id === id);
    if (found >= 0) {
      positionedFor.current = id;
      setIndex(found);
    }
  }, [id, visibleStories]);

  const story = visibleStories[index];
  const isOwnStory = !!story?.isOwn;
  const [replyTo, setReplyTo] = useState<{ id: number; author: string } | null>(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [anonOpen, setAnonOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Delete this story, then get out of its way.
   *
   * The local removal happens first so the viewer never renders a story the
   * server has already dropped — the request is confirmed by the time the
   * next frame draws. Advancing rather than always closing keeps a run of
   * your own stories watchable while you prune them.
   */
  const removeStory = () => {
    if (!story || deleting) return;
    const doomed = story.id;
    const hasNext = index < visibleStories.length - 1;
    setDeleting(true);
    deleteStory(doomed)
      .then(() => {
        removeStoryLocal(doomed);
        if (hasNext) setPaused(false);
        else router.back();
      })
      .catch(() => {
        setToast(t('stories.delete_failed'));
        setPaused(false);
      })
      .finally(() => setDeleting(false));
  };
  // The sheet covers the story, so let the timer stop while it is open.
  useEffect(() => {
    if (viewersOpen) setPaused(true);
  }, [viewersOpen]);

  // Swiping from someone else's story onto your own leaves the mode on
  // 'private', and the tab that would change it back is no longer rendered
  // — the composer would keep pretending to send private replies to
  // yourself.
  useEffect(() => {
    if (isOwnStory && replyMode === 'private') setReplyMode('comment');
  }, [isOwnStory, replyMode]);
  const progress = useSharedValue(0);

  // Mark viewed on server + local when story changes (skip optimistic uploads).
  useEffect(() => {
    if (!story?.id || story.uploadStatus) return;
    if (/^[0-9a-f-]{36}$/i.test(story.id)) {
      viewStory(story.id).catch(() => {});
    }
    markStoryViewedLocal(story.id);
  }, [story?.id, story?.uploadStatus]);

  /**
   * Comments from the server, replacing the fixture the sheet used to read.
   *
   * `story.comments` only ever existed on the bundled mock, so every real
   * story opened an empty sheet no matter how much had been written on it.
   * Optimistic local entries still sit on top until the fetch lands.
   */
  const [serverComments, setServerComments] = useState<StoryCommentDTO[]>([]);
  const commentsFor = story?.id;
  useEffect(() => {
    if (!commentsFor || !/^[0-9a-f-]{36}$/i.test(commentsFor)) {
      setServerComments([]);
      return;
    }
    let cancelled = false;
    listComments(commentsFor)
      .then((list) => {
        if (!cancelled) setServerComments(list ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [commentsFor]);

  const comments = useMemo(() => {
    if (!story) return [] as StoryComment[];

    const toUI = (c: StoryCommentDTO): StoryComment => ({
      id: String(c.id),
      author: c.is_anonymous ? t('stories.anonymous_author') : c.author_name || c.author_username,
      avatarUri: c.author_avatar,
      text: c.body,
      postedAt: relativeCommentTime(c.created_at),
      isAnonymous: c.is_anonymous,
      // Comes from the server, which knows the author of an anonymous
      // comment without telling anyone who it is.
      isMine: c.is_mine,
    });

    // The server sends one flat list with parent_id; the sheet renders a
    // tree. Nesting here rather than server-side keeps the wire format
    // simple and means an unmatched parent — a reply whose top comment was
    // deleted — degrades to a top-level row instead of disappearing.
    const tops = new Map<string, StoryComment>();
    for (const c of serverComments) {
      if (c.parent_id == null) tops.set(String(c.id), { ...toUI(c), replies: [] });
    }
    for (const c of serverComments) {
      if (c.parent_id == null) continue;
      const parent = tops.get(String(c.parent_id));
      if (parent) parent.replies = [...(parent.replies ?? []), toUI(c)];
      else tops.set(String(c.id), toUI(c));
    }

    const extra = localComments[story.id] ?? [];
    return [...extra, ...Array.from(tops.values())];
  }, [story, serverComments, localComments]);

  /**
   * Remove a comment.
   *
   * The rule already existed on the server — author of the comment or author
   * of the story — and no client ever called it, so nothing written under a
   * story could be taken back by either of the two people entitled to.
   *
   * The row goes immediately and comes back if the request fails: a delete
   * that appears to work and silently didn't is worse than one that visibly
   * failed.
   */
  const removeComment = (commentId: number) => {
    const snapshot = serverComments;
    setServerComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_id !== commentId));
    deleteComment(commentId).catch(() => {
      setServerComments(snapshot);
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    });
  };

  // Warm the neighbours so a swipe lands on a picture, not a spinner.
  // Image.prefetch cannot do this any more: it fetches without credentials,
  // so it was priming a 401 for every story either side of this one.
  useEffect(() => {
    [visibleStories[index - 1], visibleStories[index + 1]].forEach((item) => {
      if (!item || item.kind === 'text' || item.kind === 'audio') return;
      const mediaId = mediaIdFromURL(item.coverUri);
      if (mediaId) void ensureLocal(mediaId);
    });
  }, [index, visibleStories]);

  // Pause auto-advance while comments sheet is open.
  useEffect(() => {
    if (commentsOpen) setPaused(true);
    else setPaused(false);
  }, [commentsOpen]);

  const goPrev = useCallback(() => {
    setReply('');
    setCommentsOpen(false);
    if (index > 0) setIndex((i) => i - 1);
    else router.back();
  }, [index]);

  const goNext = useCallback(() => {
    setReply('');
    setCommentsOpen(false);
    if (index < visibleStories.length - 1) setIndex((i) => i + 1);
    else router.back();
  }, [index, visibleStories.length]);

  // Read out the three fields the countdown depends on.
  //
  // Depending on `story` itself restarted the timer on every store emit —
  // the object is rebuilt each time — so the bar kept jumping back to zero
  // and a story never finished on its own. Naming the fields keeps the
  // dependency list both honest and stable.
  const storyId = story?.id;
  const storyDuration = story?.durationSec;

  useEffect(() => {
    if (!storyId || paused) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    const durationMs = Math.max(4, storyDuration ?? 0) * 1000;
    progress.value = withTiming(
      1,
      { duration: durationMs, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(goNext)();
      },
    );
    return () => cancelAnimation(progress);
  }, [storyId, storyDuration, paused, progress, goNext]);

  const longPress = Gesture.LongPress()
    .minDuration(160)
    .onStart(() => {
      runOnJS(setPaused)(true);
    })
    .onEnd(() => {
      runOnJS(setPaused)(false);
    })
    .onFinalize(() => {
      runOnJS(setPaused)(false);
    });

  /**
   * Swipe sideways to move between stories.
   *
   * The only way through a set was tapping the left or right half, which is
   * discoverable but blunt: every move is the same canned turn regardless of
   * intent. A drag says which way and how much you meant it.
   *
   * Composed with the long press rather than replacing it — holding still
   * pauses, and a hold that turns into a drag becomes a swipe.
   */
  const swipe = Gesture.Pan()
    .activeOffsetX([-18, 18])
    // Vertical slack, or a thumb dragging down the reply sheet takes a story
    // with it. The comment sheet and the reply box both live below.
    .failOffsetY([-24, 24])
    .onEnd((e) => {
      const far = Math.abs(e.translationX) > 60;
      const fast = Math.abs(e.velocityX) > 500;
      if (!far && !fast) return;
      runOnJS(e.translationX < 0 ? goNext : goPrev)();
    });

  const storyGestures = Gesture.Race(swipe, longPress);

  /**
   * A chip is a toggle, not a send button: with several reactions allowed,
   * tapping one that is already lit has to mean "take it back", and the whole
   * set goes to the server in one call.
   */
  const onToggleReaction = (emoji: string) => {
    if (!story) return;
    const mine = story.myReactions ?? [];
    const adding = !mine.includes(emoji);
    if (adding) {
      setReactBurst(emoji);
      setTimeout(() => setReactBurst(null), 700);
    }
    setToast(adding ? t('stories.react_sent') : t('stories.react_removed'));
    setTimeout(() => setToast(null), 1400);
    void setStoryReactions(story.id, toggleReaction(mine, emoji));
  };

  const sendReply = () => {
    const text = reply.trim();
    if (!text || !story) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();

    if (replyMode === 'private') {
      setReply('');
      // An anonymous story cannot take an ordinary private reply: opening a
      // chat names both people, so the first reply would undo exactly the
      // anonymity the author was promised. It goes through the blind
      // channel instead.
      if (story.isAnonymous && /^[0-9a-f-]{36}$/i.test(story.id)) {
        writeAnon(story.id, text).catch(() => {});
        setToast(t('anon.sent'));
      } else {
        setToast(t('stories.private_reply_sent'));
      }
      setTimeout(() => setToast(null), 1400);
      return;
    }

    if (story.allowComments === false) {
      setToast(t('stories.comments_off'));
      setTimeout(() => setToast(null), 1400);
      return;
    }

    postComment(text, replyAnonymous);
    setReply('');
    if (!commentsOpen) setCommentsOpen(true);
  };

  /**
   * Post a comment. The only place that does.
   *
   * There used to be two copies of this — one behind the composer, one
   * behind the sheet's own input — and only the first was ever wired to the
   * server. Comments typed where people actually type them went into local
   * state and nowhere else, so they vanished on reload.
   */
  const postComment = (raw: string, anonymous: boolean, parentId?: number) => {
    const text = raw.trim();
    if (!text || !story) return;

    const anon = anonymous && story.allowAnonymousReplies !== false;
    const optimistic: StoryComment = {
      id: `local-${Date.now()}`,
      author: anon ? t('stories.anonymous_author') : 'You',
      avatarUri: anon
        ? 'https://api.dicebear.com/9.x/shapes/png?seed=anon-me&backgroundColor=374151&size=200'
        : 'https://api.dicebear.com/9.x/avataaars/png?seed=you&backgroundColor=EEF2FF&size=200',
      text,
      postedAt: t('channel.just_now'),
      isAnonymous: anon,
    };
    const storyId = story.id;
    // A reply shows up nested straight away; only top-level comments go into
    // the optimistic list, or a reply would briefly appear as its own thread
    // and then jump under its parent when the fetch lands.
    if (parentId == null) {
      setLocalComments((prev) => ({
        ...prev,
        [storyId]: [optimistic, ...(prev[storyId] ?? [])],
      }));
    } else {
      setServerComments((prev) => [
        ...prev,
        {
          id: -Date.now(),
          story_id: storyId,
          parent_id: parentId,
          body: text,
          author_id: '',
          author_name: 'You',
          author_username: '',
          author_avatar: '',
          is_anonymous: anon,
          is_mine: true,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setToast(t('stories.comment_sent'));
    setTimeout(() => setToast(null), 1400);

    if (!/^[0-9a-f-]{36}$/i.test(storyId)) return;

    const dropOptimistic = () => {
      if (parentId == null) {
        setLocalComments((prev) => ({
          ...prev,
          [storyId]: (prev[storyId] ?? []).filter((c) => c.id !== optimistic.id),
        }));
      } else {
        // Negative ids are the placeholders minted above; the server never
        // issues one, so this cannot remove a real row.
        setServerComments((prev) => prev.filter((c) => c.id > 0));
      }
    };

    addComment(storyId, text, { anonymous: anon, parentId })
      .then((saved) => {
        // Swap the placeholder for the stored row, so the id is real and a
        // later delete has something to act on.
        dropOptimistic();
        setServerComments((prev) => [...prev, saved]);
      })
      .catch(() => {
        dropOptimistic();
        setToast(t('stories.comment_failed'));
        setTimeout(() => setToast(null), 1600);
      });
  };

  if (!story) {
    return (
      <SafeAreaView style={styles.fallback}>
        <StatusBar style="light" />
        <Pressable onPress={() => router.back()} style={styles.closeFallback}>
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 24 }}>
          {hydrating ? '…' : t('stories.add_title')}
        </Text>
      </SafeAreaView>
    );
  }

  const isTextStory =
    story.kind === 'text' ||
    story.kind === 'poll' ||
    story.kind === 'question' ||
    !story.coverUri;
  const isAudio = story.kind === 'audio';
  const interactive = parseInteractiveCaption(story.caption, story.kind);
  const displayName = story.isAnonymous ? t('stories.anonymous_author') : story.user;
  const commentsEnabled = story.allowComments !== false;
  const totalComments = comments.length + comments.reduce((n, c) => n + (c.replies?.length ?? 0), 0);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <SlideSwap index={index}>
        {isTextStory || isAudio ? (
          <View style={[styles.textBackdrop, { backgroundColor: isAudio ? '#12141A' : story.accent }]}>
            <View style={styles.textOrbA} />
            <View style={styles.textOrbB} />
            <View style={styles.textGrain} />
          </View>
        ) : (
          <>
            {/* Through the cache, not straight to <Image>. The media endpoint
                is authenticated and expo-image cannot attach the header, so
                every story cover came back 401 and rendered as nothing. */}
            <CachedImage
              url={story.coverUri}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
            />
            {/* Plays on top of its own cover, so the frame is never blank
                while the file downloads. */}
            {story.kind === 'video' ? (
              <StoryVideo url={story.coverUri} active paused={paused} />
            ) : null}
            <View style={styles.vignetteTop} />
            <View style={styles.vignetteBottom} />
          </>
        )}

      </SlideSwap>

      {/*
        The chrome stays put.
        
        All of this used to be inside the transition, so the progress bar, the
        avatar and the reply row turned away with the photo. Only the picture
        is changing; the frame around it is not.
      */}
      <SafeAreaView style={[styles.safe, StyleSheet.absoluteFill]} edges={['top']}>
          <View style={styles.progressRow}>
            {visibleStories.map((item, i) => (
              <View key={item.id} style={styles.progressTrack}>
                {i < index ? (
                  <View style={[styles.progressFill, { width: '100%' }]} />
                ) : i === index ? (
                  <ProgressFill progress={progress} />
                ) : (
                  <View style={[styles.progressFill, { width: 0 }]} />
                )}
              </View>
            ))}
          </View>

          <View style={styles.header}>
            <View
              style={[
                styles.avatarRing,
                { borderColor: story.isViewed ? 'rgba(255,255,255,0.45)' : story.accent },
              ]}
            >
              <Image
                source={{ uri: story.isAnonymous ? story.avatarUri : story.avatarUri }}
                style={styles.avatar}
                contentFit="cover"
              />
            </View>

            <View style={styles.identity}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
                <VisibilityPill visibility={story.visibility} />
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {`${story.postedAt} · ${t('stories.expires', { time: story.expiresIn })}`}
              </Text>
            </View>

            {paused && !commentsOpen ? (
              <Animated.View entering={FadeIn.duration(120)} style={styles.pausePill}>
                <Ionicons name="pause" size={12} color="#FFF" />
                <Text style={styles.pauseText}>{t('stories.hold_to_pause')}</Text>
              </Animated.View>
            ) : null}

            {isOwnStory && story.isAnonymous ? (
              <Pressable
                onPress={() => {
                  setPaused(true);
                  setAnonOpen(true);
                }}
                hitSlop={12}
                style={styles.iconButton}
                accessibilityLabel={t('anon.inbox_title')}
              >
                <Ionicons name="eye-off-outline" size={22} color="#FFFFFF" />
              </Pressable>
            ) : null}

            {isOwnStory ? (
              <Pressable
                onPress={() => {
                  setPaused(true);
                  appAlert(t('stories.delete_title'), t('stories.delete_body'), [
                    {
                      text: t('common.cancel'),
                      style: 'cancel',
                      onPress: () => setPaused(false),
                    },
                    { text: t('stories.delete'), style: 'destructive', onPress: removeStory },
                  ]);
                }}
                hitSlop={12}
                style={styles.iconButton}
                accessibilityLabel={t('stories.delete')}
              >
                <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={styles.iconButton}
              accessibilityLabel={t('stories.close')}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>

          <GestureDetector gesture={storyGestures}>
            <View style={styles.tapLayer}>
              <Pressable onPress={goPrev} style={styles.tapZone} accessibilityLabel={t('stories.previous')} />
              <Pressable onPress={goNext} style={styles.tapZone} accessibilityLabel={t('stories.next')} />
            </View>
          </GestureDetector>

          <View style={styles.storyBody} pointerEvents="none">

            {isAudio ? (
              <View style={styles.audioCard}>
                <View style={styles.audioOrb}>
                  <Ionicons name="mic" size={34} color="#FFF" />
                </View>
                <Text style={styles.audioLabel}>{t('stories.play_audio')}</Text>
                <Text style={styles.audioDuration}>{story.audioSec ?? story.durationSec}s</Text>
              </View>
            ) : null}

            {story.kind === 'poll' ? (
              <View style={styles.pollPreview}>
                <Text style={styles.pollEyebrow}>{t('stories.poll_mode')}</Text>
                <Text style={styles.pollQuestion}>{interactive.q || story.caption}</Text>
                <View style={styles.pollOpt}>
                  <Text style={styles.pollOptText}>
                    {interactive.a || t('stories.poll_yes')}
                  </Text>
                </View>
                <View style={styles.pollOpt}>
                  <Text style={styles.pollOptText}>
                    {interactive.b || t('stories.poll_no')}
                  </Text>
                </View>
              </View>
            ) : story.kind === 'question' ? (
              <View style={styles.pollPreview}>
                <Text style={styles.pollEyebrow}>{t('stories.question_mode')}</Text>
                <Text style={styles.pollQuestion}>{interactive.q || story.caption}</Text>
                <View style={[styles.pollOpt, { backgroundColor: '#EEF2FF' }]}>
                  <Text style={[styles.pollOptText, { color: story.accent }]}>
                    {t('stories.answer_placeholder')}
                  </Text>
                </View>
              </View>
            ) : story.caption ? (
              <Text style={[styles.caption, isTextStory && styles.textCaption]}>
                {story.caption}
              </Text>
            ) : null}
          </View>

          {reactBurst ? (
            <Animated.View
              entering={FadeInDown.springify()}
              exiting={FadeOut.duration(200)}
              style={styles.burst}
              pointerEvents="none"
            >
              <Text style={styles.burstEmoji}>{reactBurst}</Text>
            </Animated.View>
          ) : null}

          {toast ? (
            <Animated.View entering={FadeIn.duration(150)} style={styles.toast}>
              <Text style={styles.toastText}>{toast}</Text>
            </Animated.View>
          ) : null}
      </SafeAreaView>


      <AnonInbox
        visible={anonOpen}
        onClose={() => {
          setAnonOpen(false);
          setPaused(false);
        }}
      />

      <ViewersSheet
        visible={viewersOpen}
        storyId={story.id}
        totalViewers={story.viewers}
        onClose={() => {
          setViewersOpen(false);
          setPaused(false);
        }}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <View style={styles.metrics}>
          {/* Tappable only on your own story — the endpoint refuses anyone
              else, so offering the tap to a viewer would promise something
              that comes back 403. */}
          {isOwnStory ? (
            <Pressable onPress={() => setViewersOpen(true)} hitSlop={8}>
              <Metric
                icon="eye-outline"
                label={t('stories.views', { count: story.viewers })}
                chevron
              />
            </Pressable>
          ) : (
            <Metric icon="eye-outline" label={t('stories.views', { count: story.viewers })} />
          )}
          <Pressable onPress={() => commentsEnabled && setCommentsOpen(true)} hitSlop={8}>
            <Metric
              icon="chatbubble-ellipses-outline"
              label={t('stories.comments_count', { count: totalComments || story.replies })}
            />
          </Pressable>
        </View>

        <View style={styles.reactTray}>
          <ReactionBar
            counts={story.reactions ?? []}
            mine={story.myReactions ?? []}
            onToggle={onToggleReaction}
            onSheetOpenChange={setPaused}
          />
          {commentsEnabled ? (
            <Pressable onPress={() => setCommentsOpen(true)} style={styles.commentsBtn}>
              <Ionicons name="chatbubbles" size={17} color="#FFF" />
              <Text style={styles.commentsBtnText}>
                {t('stories.view_comments')}
              </Text>
            </Pressable>
          ) : null}
        </View>


        {/* Reply mode switcher.

            Private reply is absent on your own story: it would open a chat
            with yourself. Commenting and reacting still make sense there —
            authors do both on their own posts everywhere else. */}
        {isOwnStory ? null : (
          <View style={styles.modeSwitch}>
            <ModeTab
              active={replyMode === 'comment'}
              label={t('stories.comment_public')}
              hint={t('stories.comment_public_hint')}
              disabled={!commentsEnabled}
              onPress={() => setReplyMode('comment')}
            />
            <ModeTab
              active={replyMode === 'private'}
              label={t('stories.reply_private')}
              hint={t('stories.reply_private_hint')}
              onPress={() => setReplyMode('private')}
            />
          </View>
        )}

        {replyMode === 'comment' && commentsEnabled && story.allowAnonymousReplies !== false ? (
          <Pressable
            onPress={() => setReplyAnonymous((v) => !v)}
            style={styles.anonToggle}
            hitSlop={6}
          >
            <Ionicons
              name={replyAnonymous ? 'checkbox' : 'square-outline'}
              size={16}
              color="rgba(255,255,255,0.85)"
            />
            <Text style={styles.anonToggleText}>{t('stories.reply_as_anonymous')}</Text>
          </Pressable>
        ) : null}

        {!commentsEnabled && replyMode === 'comment' ? (
          <Text style={styles.commentsOff}>{t('stories.comments_off')}</Text>
        ) : (
          <View style={styles.replyRow}>
            {Platform.OS === 'ios' ? (
              <BlurView intensity={28} tint="dark" style={styles.replyInput}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => setPaused(true)}
                  onBlur={() => !commentsOpen && setPaused(false)}
                  placeholder={
                    replyMode === 'private'
                      ? t('stories.reply_placeholder')
                      : t('stories.comment_placeholder')
                  }
                  placeholderTextColor="rgba(255,255,255,0.62)"
                  style={styles.input}
                  returnKeyType="send"
                  onSubmitEditing={sendReply}
                />
              </BlurView>
            ) : (
              <View style={[styles.replyInput, styles.replyInputAndroid]}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => setPaused(true)}
                  onBlur={() => !commentsOpen && setPaused(false)}
                  placeholder={
                    replyMode === 'private'
                      ? t('stories.reply_placeholder')
                      : t('stories.comment_placeholder')
                  }
                  placeholderTextColor="rgba(255,255,255,0.62)"
                  style={styles.input}
                  returnKeyType="send"
                  onSubmitEditing={sendReply}
                />
              </View>
            )}
            <Pressable
              onPress={sendReply}
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: reply.trim() ? story.accent : 'rgba(255,255,255,0.18)' },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
              accessibilityLabel={t('stories.send_comment')}
            >
              <Ionicons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>

      <CommentsSheet
        visible={commentsOpen}
        story={story}
        comments={comments}
        bottomInset={insets.bottom}
        onClose={() => {
          setCommentsOpen(false);
          // The reply target only exists while its banner is on screen. The
          // composer behind the sheet has no banner, so a target left set
          // would post to the wrong place with nothing to warn you.
          setReplyTo(null);
        }}
        replyTo={replyTo}
        onCancelReplyTo={() => setReplyTo(null)}
        onReplyTo={(id, author) => setReplyTo({ id, author })}
        // The story's author moderates their own thread; everyone else can
        // only remove what they wrote.
        canModerate={!!story.isOwn}
        onDeleteComment={removeComment}
        onReply={(text, anonymous) => {
          if (!text.trim()) return;
          postComment(text, anonymous, replyTo?.id);
          setReplyTo(null);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />
    </View>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function VisibilityPill({ visibility }: { visibility?: Story['visibility'] }) {
  const v = visibility ?? 'contacts';
  const label =
    v === 'public'
      ? t('stories.visibility_public')
      : v === 'close'
        ? t('stories.visibility_close')
        : t('stories.visibility_contacts');
  const icon: keyof typeof Ionicons.glyphMap =
    v === 'public' ? 'globe-outline' : v === 'close' ? 'star' : 'people-outline';
  return (
    <View style={styles.visPill}>
      <Ionicons name={icon} size={10} color="rgba(255,255,255,0.85)" />
      <Text style={styles.visPillText}>{label}</Text>
    </View>
  );
}

function ProgressFill({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, progress.value * 100))}%`,
  }));
  return <Animated.View style={[styles.progressFill, style]} />;
}

function Metric({
  icon,
  label,
  chevron = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Signals the metric opens something, rather than just reporting. */
  chevron?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={15} color="rgba(255,255,255,0.82)" />
      <Text style={styles.metricText}>{label}</Text>
      {chevron ? (
        <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.6)" />
      ) : null}
    </View>
  );
}

function ModeTab({
  active,
  label,
  hint,
  onPress,
  disabled,
}: {
  active: boolean;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.modeTab,
        active && styles.modeTabActive,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={[styles.modeTabLabel, active && styles.modeTabLabelActive]}>{label}</Text>
      <Text style={styles.modeTabHint} numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

const SHEET_EMOJIS = ['❤️', '🔥', '😂', '👏', '😮', '🙌', '💯', '✨'];

function CommentsSheet({
  visible,
  story,
  comments,
  bottomInset,
  onClose,
  onReply,
  replyTo,
  onReplyTo,
  onCancelReplyTo,
  canModerate,
  onDeleteComment,
}: {
  visible: boolean;
  story: Story;
  comments: StoryComment[];
  bottomInset: number;
  onClose: () => void;
  onReply: (text: string, anonymous: boolean) => void;
  /** Set while composing a reply to a specific comment. */
  replyTo: { id: number; author: string } | null;
  onReplyTo: (id: number, author: string) => void;
  onCancelReplyTo: () => void;
  /** You are the story's author, so you may remove anyone's comment. */
  canModerate: boolean;
  onDeleteComment: (commentId: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const [anon, setAnon] = useState(false);
  const canAnon = story.allowAnonymousReplies !== false;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.commentsSheet, { paddingBottom: Math.max(bottomInset, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetGrip} />
          <View style={styles.sheetHeader}>
            <View>
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitle}>{t('stories.comments')}</Text>
              </View>
              <Text style={styles.sheetCount}>
                {t('stories.comments_count', { count: comments.length })}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.sheetClose} hitSlop={10}>
              <Ionicons name="close" size={18} color="#FFF" />
            </Pressable>
          </View>

          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.commentList}
            contentContainerStyle={
              comments.length === 0 ? styles.commentEmptyWrap : styles.commentListContent
            }
            ListEmptyComponent={
              <View style={styles.commentEmptyCard}>
                <Ionicons name="chatbubbles-outline" size={36} color="rgba(255,255,255,0.35)" />
                <Text style={styles.commentEmpty}>{t('stories.no_comments')}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <CommentRow
                comment={item}
                onReplyTo={onReplyTo}
                canModerate={canModerate}
                onDelete={onDeleteComment}
              />
            )}
          />

          {story.allowComments !== false ? (
            <View style={styles.sheetComposer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sheetEmojiRow}
              >
                {SHEET_EMOJIS.map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => setDraft((d) => d + e)}
                    style={styles.sheetEmojiBtn}
                  >
                    <Text style={styles.sheetEmoji}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {canAnon ? (
                <Pressable onPress={() => setAnon((v) => !v)} style={styles.anonToggle}>
                  <Ionicons
                    name={anon ? 'checkbox' : 'square-outline'}
                    size={16}
                    color="rgba(255,255,255,0.85)"
                  />
                  <Text style={styles.anonToggleText}>{t('stories.reply_as_anonymous')}</Text>
                </Pressable>
              ) : null}
              {/* Who the reply is aimed at, with a way out. Without it the
                  composer looks identical whether you are starting a thread
                  or answering one, and the message lands in the wrong place
                  with no warning. */}
              {replyTo ? (
                <View style={styles.replyBanner}>
                  <Ionicons name="return-down-forward" size={14} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.replyBannerText} numberOfLines={1}>
                    {t('stories.replying_to', { name: replyTo.author })}
                  </Text>
                  <Pressable onPress={onCancelReplyTo} hitSlop={8}>
                    <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.sheetInputRow}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={
                    replyTo
                      ? t('stories.replying_to', { name: replyTo.author })
                      : t('stories.comment_placeholder')
                  }
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.sheetInput}
                  returnKeyType="send"
                  onSubmitEditing={() => {
                    onReply(draft, anon);
                    setDraft('');
                  }}
                />
                <Pressable
                  onPress={() => {
                    onReply(draft, anon);
                    setDraft('');
                  }}
                  style={[
                    styles.sheetSend,
                    {
                      backgroundColor: draft.trim() ? story.accent : 'rgba(255,255,255,0.15)',
                    },
                  ]}
                >
                  <Ionicons name="send" size={16} color="#FFF" />
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.commentsOff}>{t('stories.comments_off')}</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CommentRow({
  comment,
  onReplyTo,
  canModerate,
  onDelete,
}: {
  comment: StoryComment;
  onReplyTo: (id: number, author: string) => void;
  canModerate: boolean;
  onDelete: (commentId: number) => void;
}) {
  // Optimistic rows carry a `local-…` id the server has never seen; a reply
  // to one would be orphaned, so it cannot be a reply target until it lands.
  const numericId = /^\d+$/.test(comment.id) ? Number(comment.id) : null;

  /**
   * Long press to delete — the same gesture as a message, and out of the way
   * of a thread people are reading rather than managing.
   *
   * Deleting your own is one confirmation; deleting someone else's from your
   * own story is worded as moderation, because the person who wrote it will
   * simply find it gone.
   */
  const askDelete = (id: number, mine?: boolean) => {
    if (!mine && !canModerate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    appAlert(
      mine ? t('stories.delete_comment_title') : t('stories.remove_comment_title'),
      mine ? t('stories.delete_comment_body') : t('stories.remove_comment_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => onDelete(id) },
      ],
    );
  };

  return (
    <View style={styles.commentRow}>
      <Image source={{ uri: comment.avatarUri }} style={styles.commentAvatar} contentFit="cover" />
      <View style={styles.commentBody}>
        <Pressable
          onLongPress={() => (numericId != null ? askDelete(numericId, comment.isMine) : undefined)}
          disabled={numericId == null || (!comment.isMine && !canModerate)}
          style={styles.commentBubble}
        >
          <View style={styles.commentMeta}>
            <Text style={styles.commentAuthor}>
              {comment.isAnonymous ? t('stories.anonymous_author') : comment.author}
            </Text>
            <Text style={styles.commentTime}>{comment.postedAt}</Text>
          </View>
          <Text style={styles.commentText}>{comment.text}</Text>
        </Pressable>
        {numericId != null ? (
          <Pressable
            onPress={() =>
              onReplyTo(
                numericId,
                comment.isAnonymous ? t('stories.anonymous_author') : comment.author,
              )
            }
            hitSlop={6}
            style={styles.replyBtn}
            accessibilityRole="button"
          >
            <Text style={styles.replyBtnText}>{t('stories.reply_to_comment')}</Text>
          </Pressable>
        ) : null}
        {comment.replies?.map((r) => (
          <View key={r.id} style={styles.nestedReply}>
            <Image source={{ uri: r.avatarUri }} style={styles.nestedAvatar} contentFit="cover" />
            <Pressable
              onLongPress={() =>
                /^\d+$/.test(r.id) ? askDelete(Number(r.id), r.isMine) : undefined
              }
              disabled={!/^\d+$/.test(r.id) || (!r.isMine && !canModerate)}
              style={styles.commentBubble}
            >
              <Text style={styles.commentAuthor}>
                {r.isAnonymous ? t('stories.anonymous_author') : r.author}
                <Text style={styles.commentTime}> · {r.postedAt}</Text>
              </Text>
              <Text style={styles.commentText}>{r.text}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0C10' },
  fallback: { flex: 1, backgroundColor: '#0B0C10' },
  closeFallback: {
    width: 48,
    height: 48,
    margin: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flex: 1, paddingHorizontal: Spacing.md },
  vignetteTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '28%',
    backgroundColor: 'rgba(11,12,16,0.48)',
  },
  vignetteBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: 'rgba(11,12,16,0.58)',
  },
  textBackdrop: { ...StyleSheet.absoluteFillObject },
  textOrbA: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255,255,255,0.16)',
    top: '18%',
    left: '-12%',
  },
  textOrbB: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.12)',
    bottom: '22%',
    right: '-8%',
  },
  textGrain: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.04)' },
  progressRow: { flexDirection: 'row', gap: 4, paddingTop: Spacing.sm },
  progressTrack: {
    flex: 1,
    height: 2.5,
    borderRadius: Radii.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  progressFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: Radii.pill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    borderWidth: 2,
    padding: 1.5,
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%', borderRadius: Radii.pill },
  identity: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...Typography.bodyStrong, color: '#FFFFFF', flexShrink: 1 },
  visPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  visPillText: { ...Typography.micro, color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '600' },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#EF4444',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  livePillText: {
    ...Typography.micro,
    color: '#FFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  meta: { ...Typography.micro, color: 'rgba(255,255,255,0.78)', marginTop: 1 },
  pausePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pauseText: { ...Typography.micro, color: '#FFF', fontWeight: '600' },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  tapLayer: {
    ...StyleSheet.absoluteFillObject,
    top: 100,
    bottom: 260,
    flexDirection: 'row',
  },
  tapZone: { flex: 1 },
  storyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: 220,
  },
  audioCard: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  audioOrb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(79, 70, 229,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLabel: { ...Typography.bodyStrong, color: '#FFF' },
  audioDuration: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  pollPreview: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  pollEyebrow: {
    ...Typography.micro,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  pollQuestion: { ...Typography.h3, color: '#111827' },
  pollOpt: {
    minHeight: 46,
    borderRadius: Radii.lg,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollOptText: { ...Typography.bodyStrong, color: '#111827' },
  caption: {
    ...Typography.h2,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  textCaption: { fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4 },
  burst: { position: 'absolute', alignSelf: 'center', top: '42%' },
  burstEmoji: { fontSize: 72 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 280,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  toastText: { ...Typography.caption, color: '#FFF', fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  metrics: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricText: { ...Typography.micro, color: 'rgba(255,255,255,0.82)' },
  reactTray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Full width instead of hugging its contents: the emoji row scrolls now,
    // and a row sized to its content has nothing to scroll inside.
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  commentsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  commentsBtnText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  liveTicker: {
    gap: 4,
    maxHeight: 88,
    overflow: 'hidden',
  },
  liveTickerRow: {
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  liveTickerAuthor: { ...Typography.micro, color: '#FFF', fontWeight: '800' },
  liveTickerText: { ...Typography.micro, color: 'rgba(255,255,255,0.88)', flexShrink: 1 },
  modeSwitch: { flexDirection: 'row', gap: Spacing.sm },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  modeTabActive: {
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  modeTabLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.65)', fontWeight: '700' },
  modeTabLabelActive: { color: '#FFF' },
  modeTabHint: { ...Typography.micro, color: 'rgba(255,255,255,0.45)', marginTop: 2, fontSize: 10 },
  anonToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  anonToggleText: { ...Typography.micro, color: 'rgba(255,255,255,0.85)' },
  commentsOff: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  replyInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
  },
  replyInputAndroid: { backgroundColor: 'rgba(0,0,0,0.38)' },
  input: {
    ...Typography.body,
    color: '#FFFFFF',
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  commentsSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#12141A',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { ...Typography.h3, color: '#FFF', fontSize: 18 },
  sheetCount: { ...Typography.caption, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentList: { maxHeight: 340 },
  commentListContent: { paddingBottom: Spacing.sm, gap: 2 },
  commentEmptyWrap: { flexGrow: 1, justifyContent: 'center', paddingVertical: Spacing.xxl },
  commentEmptyCard: { alignItems: 'center', gap: Spacing.sm },
  commentEmpty: { ...Typography.body, color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
  commentRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1F2937' },
  commentBody: { flex: 1, gap: 6 },
  commentBubble: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    borderTopLeftRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { ...Typography.caption, color: '#FFF', fontWeight: '700' },
  commentTime: { ...Typography.micro, color: 'rgba(255,255,255,0.45)' },
  commentText: { ...Typography.body, color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  nestedReply: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  nestedAvatar: { width: 24, height: 24, borderRadius: 12 },
  replyBtn: { paddingVertical: 4, paddingLeft: 4 },
  replyBtnText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  replyBannerText: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  sheetComposer: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  sheetEmojiRow: { gap: 8, paddingVertical: 2 },
  sheetEmojiBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sheetEmoji: { fontSize: 20 },
  sheetInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sheetInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#FFF',
    ...Typography.body,
  },
  sheetSend: {
    width: 46,
    height: 46,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSendText: { ...Typography.caption, color: '#FFF', fontWeight: '700' },
});

/** Short relative time for a comment row. */
function relativeCommentTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('channel.just_now');
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
