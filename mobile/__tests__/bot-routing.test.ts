import { expect, test } from 'bun:test';

import { botsWithoutFullRead, routeToBots, type RoutableBot } from '@/data/bot-routing';

const remind: RoutableBot = {
  id: 'remind-id',
  username: 'remindbot',
  scopes: ['messages.read.commands', 'messages.send', 'members.read'],
};
const tasks: RoutableBot = {
  id: 'tasks-id',
  username: 'tasks_bot',
  scopes: ['messages.read.commands', 'messages.send'],
};
const moderator: RoutableBot = {
  id: 'mod-id',
  username: 'modbot',
  scopes: ['messages.read.all', 'messages.read.commands', 'messages.send'],
};
const sendOnly: RoutableBot = { id: 'feed-id', username: 'feedbot', scopes: ['messages.send'] };
const bots = [remind, tasks, moderator, sendOnly];

test('an ordinary message reaches no bot', () => {
  expect(routeToBots({ text: 'see you at 9 tomorrow', bots })).toEqual([]);
  expect(routeToBots({ text: 'email me at ana@remindbot.example', bots })).toEqual([]);
});

test('a targeted command reaches only that bot', () => {
  expect(routeToBots({ text: '/remind@remindbot me at 9', bots })).toEqual([
    { botId: 'remind-id', username: 'remindbot', kind: 'command' },
  ]);
  expect(routeToBots({ text: '/remind@nosuchbot me', bots })).toEqual([]);
});

test('a bare command reaches every bot listening for commands, never full-read or send-only bots', () => {
  const ids = routeToBots({ text: '/help', bots }).map((r) => r.botId);
  expect(ids).toEqual(['remind-id', 'tasks-id']);
});

test('a mention reaches the mentioned bot, case-insensitively and only on a word boundary', () => {
  expect(routeToBots({ text: 'hey @RemindBot remind Ana', bots })).toEqual([
    { botId: 'remind-id', username: 'remindbot', kind: 'mention' },
  ]);
  expect(routeToBots({ text: 'hey @remindbotx', bots })).toEqual([]);
  expect(routeToBots({ text: '@modbot are you there', bots })).toEqual([]);
});

test('a reply to a bot reaches that bot', () => {
  expect(routeToBots({ text: 'yes, at 10', bots, replyToSenderId: 'tasks-id' })).toEqual([
    { botId: 'tasks-id', username: 'tasks_bot', kind: 'reply' },
  ]);
  expect(routeToBots({ text: 'yes', bots, replyToSenderId: 'some-person' })).toEqual([]);
});

test('only full-read bots may hold the group key', () => {
  const excluded = botsWithoutFullRead(bots);
  expect(excluded.has('remind-id')).toBe(true);
  expect(excluded.has('feed-id')).toBe(true);
  expect(excluded.has('mod-id')).toBe(false);
});

test('a bare command goes only to the bots that registered it (#324)', () => {
  const [remind, poll] = [bots[0], bots[1]];
  const routed = routeToBots({ text: '/remind what:x', bots, commandTargets: [remind.id] });
  expect(routed.map((r) => r.botId)).toEqual([remind.id]);
  // Nothing registered it: every listening bot, as before.
  expect(routeToBots({ text: '/start', bots, commandTargets: null }).length).toBeGreaterThan(0);
  // `@bot` still wins over the registry.
  expect(routeToBots({ text: `/remind@${poll.username}`, bots, commandTargets: [remind.id] }).map((r) => r.botId)).toEqual(
    poll.scopes.includes('messages.read.all') ? [] : [poll.id],
  );
});
