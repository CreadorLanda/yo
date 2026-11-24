/**
 * What the camera can make, and what the shutter does in each case.
 *
 * Kept apart from the screen so the rules are one table rather than a set of
 * conditions spread through a component: which gesture takes a photo, which
 * starts a video, how long a video may run. The screen asks; it does not
 * decide.
 */

/** The bottom bar. Order is the order on screen. */
export type CameraMode = 'post' | 'story' | 'reel' | 'live';
export const CAMERA_MODES: readonly CameraMode[] = ['post', 'story', 'reel', 'live'];

/**
 * What a story is made with. Only the story mode has these: a post or a reel
 * is always a picture from the lens or the library.
 */
export type StoryTool = 'camera' | 'text' | 'boomerang' | 'handsfree' | 'voice';
export const STORY_TOOLS: readonly StoryTool[] = ['camera', 'text', 'boomerang', 'handsfree', 'voice'];

/** Mirrors `MaxMedia` in the server's posts module. */
export const POST_MAX_ITEMS = 10;
/** Mirrors `MaxCaptionRunes` in the server's posts module. */
export const POST_CAPTION_MAX = 2200;

export const BOOMERANG_SECONDS = 3;
export const HANDSFREE_SECONDS = 15;
/** A story held on the shutter. The server shows a story for at most 30s. */
export const STORY_HOLD_SECONDS = 15;
export const POST_VIDEO_SECONDS = 60;
export const REEL_SECONDS = 60;

export type CapturedKind = 'image' | 'video' | 'audio';

/** One thing that came out of the camera or the library. */
export type CapturedItem = {
  uri: string;
  kind: CapturedKind;
  /** Known for anything recorded here; the library reports it for videos. */
  durationMs?: number;
  width?: number;
  height?: number;
  /** What the library says the file is. Camera output is JPEG or MP4. */
  mimeType?: string;
  /** Boomerang plays differently in the editor's badge. */
  boomerang?: boolean;
};

export type ShutterPlan = {
  /** `photo` takes a still; `record` starts or stops a video; `voice` the same for sound. */
  tap: 'photo' | 'record' | 'voice' | 'compose';
  /** Holding records for as long as the finger is down. */
  hold: boolean;
  /** The longest a video or voice clip may run, in seconds. 0 when nothing records. */
  maxSeconds: number;
  /** Whether the lens is on screen at all. */
  usesLens: boolean;
};

export function shutterPlan(mode: CameraMode, tool: StoryTool = 'camera'): ShutterPlan {
  if (mode === 'post') {
    return { tap: 'photo', hold: true, maxSeconds: POST_VIDEO_SECONDS, usesLens: true };
  }
  if (mode === 'reel') {
    return { tap: 'record', hold: false, maxSeconds: REEL_SECONDS, usesLens: true };
  }
  if (mode === 'live') {
    // No shutter: the lens is a backdrop for choosing who watches.
    return { tap: 'compose', hold: false, maxSeconds: 0, usesLens: true };
  }
  switch (tool) {
    case 'text':
      return { tap: 'compose', hold: false, maxSeconds: 0, usesLens: false };
    case 'voice':
      return { tap: 'voice', hold: false, maxSeconds: 30, usesLens: false };
    case 'boomerang':
      return { tap: 'record', hold: false, maxSeconds: BOOMERANG_SECONDS, usesLens: true };
    case 'handsfree':
      return { tap: 'record', hold: false, maxSeconds: HANDSFREE_SECONDS, usesLens: true };
    default:
      return { tap: 'photo', hold: true, maxSeconds: STORY_HOLD_SECONDS, usesLens: true };
  }
}

/**
 * The live filter is a preview-only overlay: the recorder writes the native
 * stream without it. So it is offered only where a tap takes a still, and a
 * video held in those modes is recorded unfiltered (the caller clears it).
 */
export function offersFilter(mode: CameraMode, tool: StoryTool = 'camera'): boolean {
  return shutterPlan(mode, tool).tap === 'photo';
}

/** A route param is whatever someone typed into a link. */
export function parseCameraMode(raw: unknown): CameraMode {
  return CAMERA_MODES.includes(raw as CameraMode) ? (raw as CameraMode) : 'story';
}

/** How many more slides a post can take. */
export function postRoomLeft(count: number): number {
  return Math.max(0, POST_MAX_ITEMS - count);
}

/**
 * What a mode accepts from the library.
 *
 * A reel is one video, so offering photos there would only produce a pick the
 * next step has to refuse.
 */
export function libraryRequest(
  mode: CameraMode,
  trayCount = 0,
): { mediaTypes: ('images' | 'videos')[]; limit: number; videoMaxSeconds: number } {
  if (mode === 'reel') return { mediaTypes: ['videos'], limit: 1, videoMaxSeconds: REEL_SECONDS };
  if (mode === 'post') {
    return {
      mediaTypes: ['images', 'videos'],
      limit: postRoomLeft(trayCount),
      videoMaxSeconds: POST_VIDEO_SECONDS,
    };
  }
  return { mediaTypes: ['images', 'videos'], limit: 1, videoMaxSeconds: 60 };
}

/**
 * How long a story built from this item stays on screen, in seconds.
 *
 * The server clamps to 30, and a recorded clip should play for as long as it
 * actually is rather than a guess per mode.
 */
export function storyDurationSec(kind: 'image' | 'video' | 'audio' | 'text' | 'poll' | 'question', durationMs?: number): number {
  if (kind === 'video' || kind === 'audio') {
    const sec = Math.ceil((durationMs ?? 0) / 1000);
    const floor = kind === 'audio' ? 5 : 1;
    return Math.min(30, Math.max(floor, sec || (kind === 'audio' ? 5 : 10)));
  }
  if (kind === 'poll' || kind === 'question') return 8;
  if (kind === 'text') return 6;
  return 5;
}

/** `0:07` for the recording timer. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
