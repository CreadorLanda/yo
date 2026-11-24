import { expect, test } from 'bun:test';

const camera = await Bun.file('components/camera/camera-capture.tsx').text();
const liveScreen = await Bun.file('app/live/[id].tsx').text();
const setupScreen = await Bun.file('app/live/setup.tsx').text();
const setup = await Bun.file('components/live/live-setup-form.tsx').text();
const storiesRail = await Bun.file('app/(tabs)/stories.tsx').text();

test('o modo live da câmara é a preparação, sobre a lente e sem destino', () => {
  // Live is a mode of the camera, not a screen it hands off to: the same form
  // a chat or a channel uses, drawn over the viewfinder with no place set.
  expect(camera).not.toContain('live_coming_soon');
  expect(camera).toContain('<LiveSetupForm compact initialTitle={liveTitle} />');
  expect(camera).not.toContain('/live/setup');
  expect(setupScreen).toContain('<LiveSetupForm chat={params.chat} channel={params.channel}');
});

test('a preparação deixa escolher o público e só oferece o local quando existe', () => {
  expect(setup).toContain('const hasPlace = !!chatId || !!channel;');
  for (const key of ["'contacts'", "'selected'", "'public'"]) expect(setup).toContain(key);
  expect(setup).toContain("q.set('viewers', picked.map((p) => p.id).join(','))");
  expect(setup).toContain("router.replace(`/live/new?${q.toString()}`)");
});

test('o rail lê lives autorizadas e abre o id real', () => {
  expect(storiesRail).toContain('useRunningLives');
  expect(storiesRail).toContain('refreshRunningLives');
  expect(storiesRail).toContain('router.push(`/live/${live.id}`)');
});

test('terminar uma live só sai depois da confirmação HTTP', () => {
  expect(liveScreen).toContain('await endLive(liveId)');
  expect(liveScreen).toContain('await refreshRunningLives()');
  expect(liveScreen).toContain("t('live.end_failed')");
  expect(liveScreen).not.toContain('void endLive(liveId)');
});

test('a recusa de media e a reconexão ficam visíveis sem fingir que a emissão acabou', () => {
  expect(liveScreen).toContain('requestCamera');
  expect(liveScreen).toContain('requestMicrophone');
  expect(liveScreen).toContain('audio={grant.host && hostMedia.microphone}');
  // The camera starts off and is turned on with the button (#236).
  expect(liveScreen).toContain('video={false}');
  expect(liveScreen).toContain("t('live.backgrounded')");
  expect(liveScreen).toContain("t('live.reconnecting')");
});
