import { expect, test } from 'bun:test';

/**
 * The camera was a drawing.
 *
 * `cameraFeed` was a dark rectangle with a grain overlay and an icon in the
 * middle; pressing the shutter handed off to the system camera app. So nothing
 * you saw before pressing came from a lens, and flipping the lens did nothing
 * at all for video — launchCameraAsync was called without cameraType on that
 * path.
 */
const screen = await Bun.file('app/story/create.tsx').text();
const camera = await Bun.file('components/media/filtered-camera.tsx').text();

test('o visor mostra a camara, nao um retangulo', () => {
  // Asserted as a property rather than as a library: the camera moved from
  // expo-camera to VisionCamera to get the live filter, and the thing that
  // must stay true is that a lens feeds the preview.
  expect(screen).toContain('<FilteredCamera');
  expect(screen).toContain('front={frontCamera}');
});

test('a captura vem da camara, nao da app do sistema', () => {
  // The library picker stays — choosing an existing photo is a real thing.
  // What must not come back is capture-by-handoff.
  expect(screen).not.toContain('ImagePicker.launchCameraAsync(');
  expect(screen).toContain('cameraRef.current');
  expect(screen).toContain('cam.takePhoto()');
  expect(screen).toContain('cam.startRecording(');
});

test('virar a lente vale tambem para video', () => {
  // One prop drives both modes, so photo and video cannot disagree the way
  // two separate call sites did — which is exactly how flipping ended up
  // working for stills and doing nothing at all for video.
  expect(screen.match(/front=\{frontCamera\}/g) ?? []).toHaveLength(1);
  expect(camera).toContain("useCameraDevice(front ? 'front' : 'back')");
});

test('o flash deixou de ser um icone que so muda de forma', () => {
  expect(screen).toContain('torch={flash}');
  expect(camera).toMatch(/torchMode[=:]/);
});

test('as duracoes dos modos sao nomeadas uma vez', () => {
  // They appeared twice each — once to cap the recording, once to drive the
  // progress ring — and two literals that must agree is one that will not.
  expect(screen).toContain('const BOOMERANG_SECONDS');
  expect(screen).toContain('const HANDSFREE_SECONDS');
  expect(screen).not.toMatch(/videoMaxDuration:.*\?\s*3\s*:\s*15/);
});

test('nenhum plugin de camara fantasma na config', async () => {
  // VisionCamera 5 ships no app.plugin.js. Naming it under `plugins` makes
  // `expo config` exit non-zero, which fails the build with no useful error —
  // the permissions are declared by hand instead, checked further down.
  const app = JSON.parse(await Bun.file('app.json').text());
  const named = JSON.stringify(app.expo.plugins);
  expect(named).not.toContain('react-native-vision-camera');
  expect(named).not.toContain('expo-camera');
});

/**
 * The transition turned the whole screen, chrome and all.
 */
test('so a media roda; o cromado fica quieto', async () => {
  const viewer = await Bun.file('app/story/[id].tsx').text();
  const open = viewer.indexOf('<SlideSwap');
  const close = viewer.indexOf('</SlideSwap>');
  expect(open).toBeGreaterThan(-1);
  const inside = viewer.slice(open, close);
  expect(inside).not.toContain('styles.progressRow');
  expect(inside).not.toContain('styles.header');
});

test('da para passar de story com o dedo', async () => {
  const viewer = await Bun.file('app/story/[id].tsx').text();
  expect(viewer).toContain('Gesture.Pan()');
  // The hold-to-pause must survive: a swipe that ate it would cost a feature
  // to add one.
  expect(viewer).toContain('Gesture.LongPress()');
  expect(viewer).toContain('Gesture.Race(');
});

/**
 * The live filtered viewfinder.
 *
 * expo-camera owns its preview surface and hands frames to nothing, so the
 * filter could only ever be baked after the fact. VisionCamera exposes the
 * frame's native buffer, which Skia can import with no copy.
 */
test('os fotogramas passam pela mesma matriz que o assar', () => {
  expect(camera).toContain('MakeImageFromNativeBuffer');
  expect(camera).toContain('ColorMatrix');
  expect(camera).toContain("from '@/data/photo-filters'");
});

test('cada fotograma e devolvido ao lote', () => {
  // Frames come from a fixed pool and buffers are reference-counted. One not
  // returned is one fewer for the next capture, and the pipeline stalls after
  // a few seconds — a leak that looks like the camera freezing.
  expect(camera).toContain('frame.dispose()');
  expect(camera).toContain('buffer.release()');
  expect(camera).toContain('previous?.dispose()');
});

test('sem filtro, o caminho dos fotogramas nem e criado', () => {
  // Not attaching the frame output was not enough: `useFrameOutput` builds a
  // worklet runtime on mount whether or not the output is used, and it sat in
  // the component that always renders — so the camera died on open with no
  // filter picked. It now lives only in the component rendered for a filter.
  const plain = camera.slice(
    camera.indexOf('function PlainCamera'),
    camera.indexOf('function FilteredPreview'),
  );
  expect(plain).toContain('outputs={[photoOutput, videoOutput]}');
  expect(plain).not.toContain('useFrameOutput(');
  const main = camera.slice(
    camera.indexOf('export const FilteredCamera'),
    camera.indexOf('function PlainCamera'),
  );
  expect(main).not.toContain('useFrameOutput(');
  expect(main).toMatch(/matrix \? \(\s*<FilteredPreview/);
  expect(camera).toContain('outputs={[photoOutput, videoOutput, frameOutput]}');
});

test('uma falha da camara nao leva o ecra consigo', () => {
  expect(camera).toContain('getDerivedStateFromError');
  expect(camera).toContain('<CameraGuard');
});

test('o zoom e um fator da lente, nao 0-1', () => {
  // VisionCamera rejects zoom outside device.minZoom..maxZoom. The composer
  // still speaks 0–1, so the camera opened at 0 and every pinch was refused.
  expect(camera).toContain('zoom: lensZoom(device, zoom)');
  expect(camera).toContain('device.minZoom');
  expect(camera).toContain('device.maxZoom');
});

test('o limite de gravacao consegue parar a gravacao', () => {
  // The recorder was state, so the cap timer held a handle from before the
  // recording started and its stopRecording saw nothing to stop.
  expect(camera).toContain('recorderRef.current = rec');
  expect(camera).not.toContain('setRecorder(');
  expect(screen).toContain('clearStopTimer()');
});

test('a pre-visualizacao nativa fica por baixo, para falhar em segurança', () => {
  // If the frame pipeline yields nothing, the unfiltered native preview shows
  // through — the failure is "not tinted", not a black rectangle.
  const cameraTag = camera.indexOf('<Camera');
  const overlay = camera.indexOf('<FilteredOverlay');
  expect(cameraTag).toBeGreaterThan(-1);
  expect(overlay).toBeGreaterThan(cameraTag);
});

test('as permissoes estao declaradas a mao, porque o pacote nao traz plugin', async () => {
  const app = JSON.parse(await Bun.file('app.json').text());
  const plist = app.expo.ios.infoPlist;
  expect(plist.NSCameraUsageDescription).toBeTruthy();
  expect(plist.NSMicrophoneUsageDescription).toBeTruthy();
  // Without these a call or a live loses its audio the moment the app is
  // backgrounded on iOS.
  expect(plist.UIBackgroundModes).toContain('audio');
  expect(app.expo.android.permissions).toContain('android.permission.CAMERA');
});

/**
 * The camera crashed on open, and the first fix was aimed at the wrong library.
 *
 * VisionCamera 5 gets its worklet runtime from
 * `react-native-vision-camera-worklets`, which bridges to
 * `react-native-worklets`. Without that package installed,
 * `VisionCameraWorkletsProxy` throws "Cannot use Frame Processors" — and it
 * throws on every render, because `useFrameOutput` is a hook and runs whether
 * or not a filter is picked. That is why the screen died on open.
 *
 * `react-native-worklets-core` is a different library with a similar name, the
 * one VisionCamera used at v3/v4. Installing it and registering its babel
 * plugin fixed nothing.
 */
test('a biblioteca de worklets do vision-camera esta instalada', async () => {
  const pkg = JSON.parse(await Bun.file('package.json').text());
  expect(pkg.dependencies['react-native-vision-camera-worklets']).toBeTruthy();
  expect(pkg.dependencies['react-native-worklets']).toBeTruthy();
});

test('a biblioteca errada nao voltou', () => {
  const pkg = require('../package.json');
  expect(pkg.dependencies['react-native-worklets-core']).toBeUndefined();
});

test('o babel nao regista um transform de worklets duplicado', () => {
  // babel-preset-expo adds react-native-worklets/plugin itself when the module
  // is present. Registering another one puts two transforms over the same
  // directives.
  //
  // Evaluated rather than read as text, so the comment in that file explaining
  // the old mistake does not fail the test that guards against it.
  const config = require('../babel.config.js')({ cache: () => {} });
  expect(config.presets).toContain('babel-preset-expo');
  const plugins = JSON.stringify(config.plugins ?? []);
  expect(plugins).not.toContain('worklets');
});

test('o preset do babel e uma dependencia declarada', async () => {
  // It resolved from a transitive install before, which works until the
  // package that pulled it in changes its own dependencies.
  const pkg = JSON.parse(await Bun.file('package.json').text());
  expect(pkg.dependencies['babel-preset-expo']).toBeTruthy();
});

test('o audio so e pedido a camara quando ha permissao', () => {
  // Configuring a video output with audio the app has no permission for makes
  // the whole session fail to configure — no preview, and on some devices it
  // takes the app with it.
  expect(camera).toContain('enableAudio: micGranted');
});
