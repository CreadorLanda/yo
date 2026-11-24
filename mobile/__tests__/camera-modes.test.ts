import { expect, test } from 'bun:test';
import { Glob } from 'bun';

import {
  CAMERA_MODES,
  formatClock,
  libraryRequest,
  offersFilter,
  parseCameraMode,
  POST_MAX_ITEMS,
  postRoomLeft,
  shutterPlan,
  storyDurationSec,
} from '../data/camera-modes';

/**
 * One camera for everything (#281).
 *
 * There was a story composer with a camera in it and a separate screen to go
 * live from, and nowhere to make a post or a reel at all. The rules for what
 * the shutter does are a table now, so they can be checked without a lens.
 */

test('a barra de modos e a do Instagram, por esta ordem', () => {
  expect([...CAMERA_MODES]).toEqual(['post', 'story', 'reel', 'live']);
});

test('um modo desconhecido num link abre a story em vez de rebentar', () => {
  expect(parseCameraMode('reel')).toBe('reel');
  expect(parseCameraMode('nonsense')).toBe('story');
  expect(parseCameraMode(undefined)).toBe('story');
  expect(parseCameraMode(['post'])).toBe('story');
});

test('tocar tira foto e manter grava, no post e na story', () => {
  for (const plan of [shutterPlan('post'), shutterPlan('story', 'camera')]) {
    expect(plan.tap).toBe('photo');
    expect(plan.hold).toBe(true);
    expect(plan.maxSeconds).toBeGreaterThan(0);
  }
});

test('o reel e as ferramentas de video gravam ao toque, com o seu limite', () => {
  expect(shutterPlan('reel')).toMatchObject({ tap: 'record', hold: false, maxSeconds: 60 });
  expect(shutterPlan('story', 'boomerang')).toMatchObject({ tap: 'record', maxSeconds: 3 });
  expect(shutterPlan('story', 'handsfree')).toMatchObject({ tap: 'record', maxSeconds: 15 });
});

test('a voz nao abre a lente', () => {
  // Holding the camera open for a recording that only wants the microphone
  // spends battery and keeps the lens busy for nothing.
  expect(shutterPlan('story', 'voice')).toMatchObject({ tap: 'voice', usesLens: false });
});

test('as ferramentas da story nao vazam para os outros modos', () => {
  // The tool is story state. A reel opened while "voice" was selected must
  // still be a reel.
  expect(shutterPlan('reel', 'voice')).toEqual(shutterPlan('reel'));
  expect(shutterPlan('post', 'boomerang')).toEqual(shutterPlan('post'));
});

test('o filtro so e oferecido onde o toque tira uma foto', () => {
  // The live filter is preview-only; the recorder writes the stream without it.
  expect(offersFilter('post')).toBe(true);
  expect(offersFilter('story', 'camera')).toBe(true);
  expect(offersFilter('reel')).toBe(false);
  expect(offersFilter('story', 'boomerang')).toBe(false);
  expect(offersFilter('live')).toBe(false);
});

test('um post leva ate dez itens e a galeria so oferece o que ainda cabe', () => {
  expect(POST_MAX_ITEMS).toBe(10);
  expect(postRoomLeft(0)).toBe(10);
  expect(postRoomLeft(10)).toBe(0);
  expect(postRoomLeft(14)).toBe(0);
  expect(libraryRequest('post', 7).limit).toBe(3);
  expect(libraryRequest('post', 10).limit).toBe(0);
});

test('um reel so aceita um video da galeria', () => {
  expect(libraryRequest('reel')).toMatchObject({ mediaTypes: ['videos'], limit: 1 });
  expect(libraryRequest('story').limit).toBe(1);
});

test('a duracao da story e a do clip, dentro do que o servidor aceita', () => {
  expect(storyDurationSec('video', 7200)).toBe(8);
  expect(storyDurationSec('video', 95_000)).toBe(30);
  expect(storyDurationSec('video', 200)).toBe(1);
  // Unknown length (a library video that did not report one).
  expect(storyDurationSec('video')).toBe(10);
  expect(storyDurationSec('audio', 2000)).toBe(5);
  expect(storyDurationSec('image')).toBe(5);
  expect(storyDurationSec('text')).toBe(6);
  expect(storyDurationSec('poll')).toBe(8);
});

test('o relogio da gravacao', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(7.9)).toBe('0:07');
  expect(formatClock(61)).toBe('1:01');
  expect(formatClock(-3)).toBe('0:00');
});

/**
 * "One pipeline for capture, preview and editing; no separate camera screens."
 */
test('so um sitio monta a lente', async () => {
  const mounts: string[] = [];
  const glob = new Glob('{app,components}/**/*.tsx');
  for await (const file of glob.scan('.')) {
    if (file === 'components/media/filtered-camera.tsx') continue;
    const src = await Bun.file(file).text();
    if (src.includes('<FilteredCamera') || /<Camera\b/.test(src)) mounts.push(file);
  }
  expect(mounts).toEqual(['components/camera/camera-capture.tsx']);
});

test('ha um ecra de camara, e as entradas antigas apontam para ele', async () => {
  expect(await Bun.file('app/camera.tsx').exists()).toBe(true);
  expect(await Bun.file('app/story/create.tsx').exists()).toBe(false);
  const glob = new Glob('{app,components,data}/**/*.{ts,tsx}');
  for await (const file of glob.scan('.')) {
    const src = await Bun.file(file).text();
    expect(src.includes('/story/create'), file).toBe(false);
  }
  const layout = await Bun.file('app/_layout.tsx').text();
  expect(layout).toContain('name="camera"');
  expect(layout).not.toContain('name="story/create"');
});

test('a camara fica montada por baixo do compositor, com a lente solta', async () => {
  // Going back to shoot again must not rebuild the camera, and a composer on
  // screen must not hold the lens open.
  const screen = await Bun.file('app/camera.tsx').text();
  expect(screen).toContain('active={!composing}');
  const capture = await Bun.file('components/camera/camera-capture.tsx').text();
  expect(capture).toContain('isActive={active}');
});

test('o zoom nao redesenha o ecra inteiro', async () => {
  // Zoom was state on the whole composer: every step of a pinch re-rendered
  // the chrome with it. It lives in the viewfinder alone now.
  const capture = await Bun.file('components/camera/camera-capture.tsx').text();
  const main = capture.slice(capture.indexOf('export function CameraCapture'), capture.indexOf('const Viewfinder = memo('));
  expect(main).not.toContain('setZoom');
  const viewfinder = capture.slice(capture.indexOf('const Viewfinder = memo('));
  expect(viewfinder).toContain('runOnJS(setZoom)(next)');
  expect(viewfinder).toContain('if (Math.abs(next - zoomNow.value) < 0.01) return;');
});

test('um post publica os ids da media, pela ordem dos slides', async () => {
  const store = await Bun.file('data/post-store.ts').text();
  expect(store).toContain('mediaIds.push(up.id)');
  expect(store).toContain('media_ids: mediaIds');
  // A failed publish is kept for a retry, not dropped.
  expect(store).toContain('failedJobs.set(localId, input)');
  const reset = await Bun.file('data/reset.ts').text();
  expect(reset).toContain("['posts', resetPostStore]");
});
