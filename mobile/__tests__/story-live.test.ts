import { expect, test } from 'bun:test';

const composer = await Bun.file('app/story/create.tsx').text();
const liveScreen = await Bun.file('app/live/[id].tsx').text();
const setup = await Bun.file('app/live/setup.tsx').text();
const storiesRail = await Bun.file('app/(tabs)/stories.tsx').text();

test('o modo live do Stories abre a preparação, sem destino', () => {
  expect(composer).not.toContain('live_coming_soon');
  expect(composer).toContain("router.push(caption.trim() ? `/live/setup?title=");
  expect(composer).not.toContain('function LiveSetup');
});

test('a preparação deixa escolher o público e só oferece o local quando existe', () => {
  expect(setup).toContain("const hasPlace = !!params.chat || !!params.channel;");
  for (const key of ["'contacts'", "'selected'", "'public'"]) expect(setup).toContain(key);
  expect(setup).toContain("q.set('viewers', picked.map((p) => p.id).join(','))");
  expect(setup).toContain("router.replace(`/live/new?${q.toString()}`)");
});

test('o rail lê lives autorizadas e abre o id real', () => {
  expect(storiesRail).toContain('useRunningLives');
  expect(storiesRail).toContain('refreshRunningLives');
  expect(storiesRail).toContain('router.push(`/live/${live.id}`)');
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
