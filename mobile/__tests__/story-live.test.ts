import { expect, test } from 'bun:test';

const composer = await Bun.file('app/story/create.tsx').text();
const liveScreen = await Bun.file('app/live/[id].tsx').text();
const storiesRail = await Bun.file('app/(tabs)/stories.tsx').text();

test('o modo live do Stories usa a sala de broadcast existente', () => {
  expect(composer).not.toContain('live_coming_soon');
  expect(composer).toContain("router.push(`/live/new?");
  expect(composer).toContain("kind: 'chat' | 'channel'");
  expect(composer).toContain("canPublish(channel)");
});

test('a seleção do Stories cobre conversa, grupo e canal', () => {
  expect(composer).toContain("chat.type === 'direct'");
  expect(composer).toContain("t('stories.live_group')");
  expect(composer).toContain("kind: 'channel'");
  expect(composer).toContain('live_no_audience');
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
  expect(liveScreen).toContain('video={grant.host && hostMedia.camera}');
  expect(liveScreen).toContain("t('live.backgrounded')");
  expect(liveScreen).toContain("t('live.reconnecting')");
});
