import { comparePostsNewestFirst } from '../data/channel-post-order';
import type { ChannelPost } from '../data/mock';

const post = (id: string, createdAt: string): ChannelPost => ({
  id,
  text: '',
  timestamp: 'now',
  createdAt,
  views: 0,
  type: 'game',
});

test('channel game events have a deterministic order when timestamps tie', () => {
  const sameTime = '2026-10-29T10:00:00.000Z';
  const sorted = [post('b', sameTime), post('a', sameTime)].sort(comparePostsNewestFirst);
  expect(sorted.map((p) => p.id)).toEqual(['b', 'a']);
});

test('newer server timestamps sort before older events', () => {
  const sorted = [
    post('older', '2026-10-29T09:00:00.000Z'),
    post('newer', '2026-10-29T10:00:00.000Z'),
  ].sort(comparePostsNewestFirst);
  expect(sorted.map((p) => p.id)).toEqual(['newer', 'older']);
});
