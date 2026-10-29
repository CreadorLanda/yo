import { expect, test } from 'bun:test';

import type { LiveComment } from '../data/api/lives';
import { EMPTY_ROOM, MAX_COMMENTS, reduceRoom, type RoomState } from '../data/live-room';

const open: RoomState = { ...EMPTY_ROOM, liveId: 'L' };
const comment = (id: number): LiveComment => ({
  id,
  live_id: 'L',
  user_id: 'u',
  name: 'U',
  body: `c${id}`,
  created_at: '2026-10-29T10:00:00Z',
});

test('events for another live change nothing', () => {
  const next = reduceRoom(open, 'me', 'live.comment', { live_id: 'other', comment: comment(1) });
  expect(next).toBe(open);
});

test('comments arrive once, deletions take them out, and the list is capped', () => {
  let s = reduceRoom(open, 'me', 'live.comment', { live_id: 'L', comment: comment(1) });
  s = reduceRoom(s, 'me', 'live.comment', { live_id: 'L', comment: comment(1) });
  expect(s.comments.length).toBe(1);
  s = reduceRoom(s, 'me', 'live.comment_deleted', { live_id: 'L', id: 1 });
  expect(s.comments.length).toBe(0);
  for (let i = 0; i < MAX_COMMENTS + 5; i++) {
    s = reduceRoom(s, 'me', 'live.comment', { live_id: 'L', comment: comment(i + 10) });
  }
  expect(s.comments.length).toBe(MAX_COMMENTS);
  expect(s.comments[0].id).toBe(15);
});

test('a stage change about me updates my own stage', () => {
  let s = reduceRoom(open, 'me', 'live.stage_invite', { live_id: 'L', by: 'Host' });
  expect(s.myStage).toBe('invited');
  expect(s.stageInviteBy).toBe('Host');
  s = reduceRoom(s, 'me', 'live.stage', { live_id: 'L', user_id: 'me', stage: 'on' });
  expect(s.myStage).toBe('on');
  expect(s.stageInviteBy).toBeUndefined();
  s = reduceRoom(s, 'me', 'live.stage', { live_id: 'L', user_id: 'other', name: 'O', stage: 'requested' });
  expect(s.myStage).toBe('on');
  expect(s.members.find((m) => m.user_id === 'other')?.stage).toBe('requested');
});

test('a ban of someone else removes them; a ban of me marks me banned', () => {
  let s = reduceRoom(open, 'me', 'live.stage', { live_id: 'L', user_id: 'x', name: 'X', stage: 'on' });
  s = reduceRoom(s, 'me', 'live.member', { live_id: 'L', user_id: 'x', banned: true });
  expect(s.members.length).toBe(0);
  expect(s.banned).toBe(false);
  s = reduceRoom(s, 'me', 'live.member', { live_id: 'L', user_id: 'me', banned: true });
  expect(s.banned).toBe(true);
});

test('comments can be switched off and the live can end', () => {
  let s = reduceRoom(open, 'me', 'live.settings', { live_id: 'L', comments_enabled: false });
  expect(s.commentsEnabled).toBe(false);
  s = reduceRoom(s, 'me', 'live.ended', { live_id: 'L' });
  expect(s.ended).toBe(true);
});
