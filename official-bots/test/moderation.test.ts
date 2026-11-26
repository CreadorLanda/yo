import { describe, expect, test } from 'bun:test';

import type { Bot } from '@zwosocial/bot';

import { moderation } from '../src/moderation/bot';
import { check, DEFAULTS, escalate, missingGrants, parseDuration, remember, type Recent, type Settings } from '../src/moderation/policy';
import { ModerationStore } from '../src/moderation/store';

const base: Settings = { ...DEFAULTS, chatId: 'g', title: 'G' };
const fresh = (): Recent => ({ at: [], hashes: [] });

describe('filters', () => {
  test('links, when on', () => {
    expect(check('see https://spam.example/x', { ...base, links: true }, fresh(), 0)?.rule).toBe('link');
    expect(check('www.example.com', { ...base, links: true }, fresh(), 0)?.rule).toBe('link');
    expect(check('see https://spam.example/x', base, fresh(), 0)).toBeNull();
  });
  test('banned words, whole words, accents and case folded', () => {
    const s = { ...base, words: ['palavrão'] };
    expect(check('isto é um PALAVRAO!', s, fresh(), 0)).toEqual({ rule: 'word', word: 'palavrão' });
    expect(check('palavrões', s, fresh(), 0)).toBeNull();
  });
  test('flood: more than N in S seconds', () => {
    const r = fresh();
    for (let i = 0; i < 6; i++) remember(r, `m${i}`, i * 1000);
    expect(check('again', base, r, 6000)?.rule).toBe('flood');
    expect(check('again', base, r, 20_000)).toBeNull();
  });
  test('spam: the same text a third time within a minute', () => {
    const r = fresh();
    remember(r, 'Buy now!!', 0);
    remember(r, 'buy   now!!', 20_000);
    expect(check('BUY NOW!!', { ...base, floodN: 0 }, r, 40_000)?.rule).toBe('spam');
  });
  test('slow mode', () => {
    const r = fresh();
    remember(r, 'a', 0);
    expect(check('b', { ...base, slowmode: 30 }, r, 10_000)?.rule).toBe('slowmode');
    expect(check('b', { ...base, slowmode: 30 }, r, 31_000)).toBeNull();
  });
});

test('escalation ladder', () => {
  expect([1, 2, 3, 4, 9].map((n) => escalate(n))).toEqual([
    { act: 'warn' },
    { act: 'mute', seconds: 600 },
    { act: 'mute', seconds: 3600 },
    { act: 'kick' },
    { act: 'kick' },
  ]);
});

test('durations', () => {
  expect(parseDuration('10m')).toBe(600);
  expect(parseDuration('2 horas')).toBe(7200);
  expect(parseDuration('1d')).toBe(86_400);
  expect(parseDuration('30s')).toBeNull(); // under a minute
  expect(parseDuration('40d')).toBeNull(); // over 30 days: that is a ban
});

test('says what the group must grant', () => {
  expect(missingGrants({ ...base, links: true }, ['messages.read.commands'])).toEqual({ readAll: true, manage: true });
  expect(missingGrants({ ...base, links: true }, ['messages.read.all', 'members.manage'])).toEqual({ readAll: false, manage: false });
  expect(missingGrants({ ...base, spam: false, floodN: 0, requireAccept: true }, [])).toEqual({ readAll: false, manage: true });
});

// ── The bot, against a fake SDK ──

function harness() {
  const handlers = { commands: new Map<string, Function>(), interactions: new Map<string, Function>(), events: new Map<string, Function>(), message: null as Function | null };
  const calls: string[] = [];
  const sent: unknown[] = [];
  const privately: unknown[] = [];
  let list = [
    { user_id: 'boss', username: 'boss', display_name: 'Boss', is_bot: false, role: 'admin' },
    { user_id: 'ana', username: 'ana', display_name: 'Ana', is_bot: false, role: 'member' },
  ];
  const api = {
    members: async () => list,
    chat: async () => ({ id: 'g', type: 'group', title: 'Grupo', scopes: ['messages.read.commands', 'messages.read.all', 'members.manage'] }),
    mute: async (_c: string, u: string, s: number) => void calls.push(`mute ${u} ${s}`),
    unmute: async (_c: string, u: string) => void calls.push(`unmute ${u}`),
    kick: async (_c: string, u: string) => void calls.push(`kick ${u}`),
    ban: async (_c: string, u: string) => void calls.push(`ban ${u}`),
    unban: async (_c: string, u: string) => void calls.push(`unban ${u}`),
    deleteAsModerator: async (_c: string, m: number) => void calls.push(`delete ${m}`),
  };
  const fake = {
    command: (n: string, h: Function) => handlers.commands.set(n, h),
    onInteraction: (id: string, h: Function) => handlers.interactions.set(id, h),
    onMessage: (h: Function) => (handlers.message = h),
    on: (t: string, h: Function) => handlers.events.set(t, h),
    send: async (_chat: string, reply: unknown) => (sent.push(reply), { id: sent.length }),
    api,
  } as unknown as Bot;
  const store = new ModerationStore(':memory:');
  let t = 1_000_000;
  moderation(fake, store, { now: () => t });
  const ctx = (senderId: string, options?: Record<string, string>, extra: object = {}) => ({
    chatId: 'g',
    senderId,
    isGroup: true,
    text: '',
    command: options ? { name: 'x', options } : undefined,
    reply: async (b: unknown) => (sent.push(b), { id: 1 }),
    replyPrivately: async (b: unknown) => void privately.push(b),
    edit: async () => {},
    ...extra,
  });
  return {
    handlers,
    calls,
    sent,
    privately,
    store,
    ctx,
    tick: (ms: number) => (t += ms),
    setMembers: (l: typeof list) => (list = l),
  };
}

describe('moderation bot', () => {
  test('only admins and moderators can act, and never on admins', async () => {
    const h = harness();
    await h.handlers.commands.get('mute')!(h.ctx('ana', { who: '@boss', for: '10m' }));
    expect(h.calls).toEqual([]);
    await h.handlers.commands.get('mute')!(h.ctx('boss', { who: '@ana', for: '10m', reason: 'flood' }));
    expect(h.calls).toEqual(['mute ana 600']);
    await h.handlers.commands.get('kick')!(h.ctx('boss', { who: '@boss' }));
    expect(h.calls).toEqual(['mute ana 600']);
  });

  test('warnings escalate: warn, mute 10 min, mute 1 h, remove', async () => {
    const h = harness();
    for (let i = 0; i < 4; i++) await h.handlers.commands.get('warn')!(h.ctx('boss', { who: '@ana', reason: 'rude' }));
    expect(h.calls).toEqual(['mute ana 600', 'mute ana 3600', 'kick ana']);
  });

  test('a link in a filtered group is deleted and its sender warned', async () => {
    const h = harness();
    h.store.save({ ...h.store.settings('g'), links: true });
    await h.handlers.message!(h.ctx('ana', undefined, { text: 'compra em https://spam.example', messageId: 42 }));
    expect(h.calls).toEqual(['delete 42']);
    expect(h.privately).toHaveLength(1);
    // Admins' messages are never filtered.
    await h.handlers.message!(h.ctx('boss', undefined, { text: 'https://ok.example', messageId: 43 }));
    expect(h.calls).toEqual(['delete 42']);
  });

  test('a new member is welcomed, muted until they accept, and only they can accept', async () => {
    const h = harness();
    h.store.save({ ...h.store.settings('g'), requireAccept: true, rules: 'Be kind.' });
    await h.handlers.events.get('bot.installed')!({ chat_id: 'g', data: {} });
    h.setMembers([
      { user_id: 'boss', username: 'boss', display_name: 'Boss', is_bot: false, role: 'admin' },
      { user_id: 'ana', username: 'ana', display_name: 'Ana', is_bot: false, role: 'member' },
      { user_id: 'rui', username: 'rui', display_name: 'Rui', is_bot: false, role: 'member' },
    ]);
    await h.handlers.events.get('members.changed')!({ chat_id: 'g', data: {} });
    const welcome = h.sent.at(-1) as { text: string; components: { id: string }[][] };
    expect(welcome.text).toContain('@rui');
    expect(welcome.components[0][0].id).toBe('accept:rui');
    expect(h.calls).toEqual(['mute rui 604800']);
    await h.handlers.interactions.get('*')!(h.ctx('ana', undefined, { componentId: 'accept:rui' }));
    expect(h.calls).toHaveLength(1);
    await h.handlers.interactions.get('*')!(h.ctx('rui', undefined, { componentId: 'accept:rui', messageId: 5 }));
    expect(h.calls).toEqual(['mute rui 604800', 'unmute rui']);
  });

  test('the first look at a group welcomes nobody', async () => {
    const h = harness();
    await h.handlers.events.get('members.changed')!({ chat_id: 'g', data: {} });
    expect(h.sent).toHaveLength(0);
  });

  test('a deletion request forgets warnings', async () => {
    const h = harness();
    await h.handlers.commands.get('warn')!(h.ctx('boss', { who: '@ana' }));
    await h.handlers.events.get('user.data_deletion')!({ data: { user_id: 'ana' } });
    await h.handlers.commands.get('warn')!(h.ctx('boss', { who: '@ana' }));
    expect(h.calls).toEqual([]); // back to a first warning, not a mute
  });

  test('a mod log is linked with a one-time code', async () => {
    const h = harness();
    await h.handlers.commands.get('modlog')!(h.ctx('boss'));
    const code = /code:([A-Z0-9-]+)/.exec(String(h.privately[0]))![1];
    await h.handlers.commands.get('modlog')!({ ...h.ctx('boss', { code }), chatId: 'admins' });
    expect(h.store.settings('g').logChat).toBe('admins');
  });
});
