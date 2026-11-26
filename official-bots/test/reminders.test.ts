import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Bot } from '@zwosocial/bot';

import { reminders } from '../src/reminders/bot';
import { step } from '../src/reminders/schedule';
import { ReminderStore, type Job } from '../src/reminders/store';

const T0 = Date.parse('2026-11-26T09:00:00Z'); // Thursday 10:00 in Luanda
const tz = 'Africa/Luanda';

function job(over: Partial<Job> = {}): Job {
  return {
    id: crypto.randomUUID(),
    chatId: 'g1',
    isGroup: true,
    creatorId: 'ana',
    kind: 'reminder',
    target: { kind: 'me', userId: 'ana', username: 'ana' },
    text: 'water the plants',
    rule: null,
    tz,
    lang: 'en',
    nextAt: T0,
    postponed: false,
    createdAt: T0 - 60_000,
    ...over,
  };
}

describe('missed-run policy', () => {
  test('a one-off on time is sent and removed', () => {
    expect(step(job(), T0 + 1000, null, tz)).toEqual({ act: 'send', late: false, then: { remove: true } });
  });
  test('a one-off missed during an outage is still sent once, marked late', () => {
    expect(step(job(), T0 + 3 * 3_600_000, null, tz)).toMatchObject({ act: 'send', late: true });
  });
  test('a recurring run missed by more than an hour is skipped, not backfilled', () => {
    const rule = { kind: 'daily' as const, hour: 10, minute: 0 };
    const s = step(job({ rule }), T0 + 2 * 3_600_000, null, tz);
    expect(s).toEqual({ act: 'skip', nextAt: Date.parse('2026-11-27T09:00:00Z') });
  });
  test('a recurring run on time is sent and moves to its next time', () => {
    const rule = { kind: 'daily' as const, hour: 10, minute: 0 };
    expect(step(job({ rule }), T0 + 5000, null, tz)).toEqual({ act: 'send', late: false, then: { nextAt: Date.parse('2026-11-27T09:00:00Z') } });
  });
  test('quiet hours hold a personal reminder until they end, once', () => {
    const night = Date.parse('2026-11-26T22:30:00Z'); // 23:30 local
    const q = { from: 22 * 60, to: 8 * 60 };
    expect(step(job({ nextAt: night }), night, q, tz)).toEqual({ act: 'postpone', until: Date.parse('2026-11-27T07:00:00Z') });
    expect(step(job({ nextAt: night, postponed: true }), Date.parse('2026-11-27T07:00:00Z'), q, tz)).toMatchObject({ act: 'send', late: false });
  });
  test('a message to the whole chat is not held by anyone’s quiet hours', () => {
    const night = Date.parse('2026-11-26T22:30:00Z');
    const s = step(job({ nextAt: night, target: { kind: 'here' } }), night, { from: 22 * 60, to: 8 * 60 }, tz);
    expect(s.act).toBe('send');
  });
});

test('jobs survive a restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'reminders-')), 'r.db');
  const a = new ReminderStore(path);
  const j = job({ rule: { kind: 'weekly', days: [1], hour: 10, minute: 0 } });
  a.add(j);
  a.db.close();
  const b = new ReminderStore(path);
  expect(b.get(j.id)).toEqual(j);
});

// ── The bot, against a fake SDK ──

type Sent = { chatId: string; reply: unknown; opts: unknown };
function harness(now = { t: T0 }) {
  const handlers = { commands: new Map<string, Function>(), interactions: new Map<string, Function>(), events: new Map<string, Function>() };
  const sent: Sent[] = [];
  const replies: { kind: 'reply' | 'private' | 'edit'; body: unknown }[] = [];
  const members = [
    { user_id: 'ana', username: 'ana', display_name: 'Ana', is_bot: false, role: 'member' },
    { user_id: 'rui', username: 'rui', display_name: 'Rui', is_bot: false, role: 'member' },
    { user_id: 'boss', username: 'boss', display_name: 'Boss', is_bot: false, role: 'admin' },
  ];
  const fake = {
    command: (n: string, h: Function) => handlers.commands.set(n, h),
    onInteraction: (id: string, h: Function) => handlers.interactions.set(id, h),
    onAutocomplete: () => {},
    on: (t: string, h: Function) => handlers.events.set(t, h),
    send: async (chatId: string, reply: unknown, opts: unknown) => {
      sent.push({ chatId, reply, opts });
      return { id: sent.length };
    },
    api: { members: async () => members },
  } as unknown as Bot;
  const store = new ReminderStore(':memory:');
  store.saveSettings({ userId: 'ana', tz, quiet: null, lang: null });
  const { tick } = reminders(fake, store, { defaultTz: 'UTC', defaultLang: 'en', now: () => now.t });
  const ctx = (senderId: string, text: string, options?: Record<string, string>, extra: object = {}) => ({
    chatId: 'g1',
    senderId,
    isGroup: true,
    text,
    messageId: 7,
    command: options ? { name: text.slice(1).split(' ')[0], options } : undefined,
    reply: async (b: unknown) => (replies.push({ kind: 'reply', body: b }), { id: 99 }),
    replyPrivately: async (b: unknown) => void replies.push({ kind: 'private', body: b }),
    edit: async (_id: number, b: unknown) => void replies.push({ kind: 'edit', body: b }),
    ...extra,
  });
  return { handlers, sent, replies, store, tick, ctx, now };
}

describe('reminders bot', () => {
  test('/remind with options sets a reminder and it fires with a mention', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'amanhã às 9', what: 'regar as plantas' }));
    const card = h.replies[0].body as { card: { title: string } };
    expect(card.card.title).toBe('Lembrete marcado');
    h.now.t = Date.parse('2026-11-27T08:00:30Z');
    expect(await h.tick()).toBe(1);
    expect(h.sent[0]).toMatchObject({ chatId: 'g1', reply: '⏰ @ana regar as plantas', opts: { isGroup: true, to: 'ana' } });
    expect(h.store.inChat('g1')).toHaveLength(0);
  });

  test('typed without the form: "/remind @rui in 10 minutes to call back"', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind @rui in 10 minutes to call back'));
    const [j] = h.store.inChat('g1');
    expect(j.target).toEqual({ kind: 'user', userId: 'rui', username: 'rui' });
    expect(j.text).toBe('call back');
    expect(j.nextAt).toBe(T0 + 10 * 60_000);
  });

  test('a recurring /schedule posts the message as written, every time', async () => {
    const h = harness();
    await h.handlers.commands.get('schedule')!(h.ctx('ana', '/schedule', { when: 'every monday 10:00', message: 'Standup!' }));
    h.now.t = Date.parse('2026-11-30T09:00:10Z');
    await h.tick();
    h.now.t = Date.parse('2026-12-07T09:00:10Z');
    await h.tick();
    expect(h.sent.map((s) => s.reply)).toEqual(['Standup!', 'Standup!']);
  });

  test('only the creator, the person it is for or an admin can cancel', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'tomorrow at 9', what: 'x' }));
    const [j] = h.store.inChat('g1');
    const click = (who: string) => h.handlers.interactions.get('*')!(h.ctx(who, '', undefined, { componentId: `cancel:${j.id}` }));
    await click('rui');
    expect(h.store.get(j.id)).not.toBeNull();
    await click('boss');
    expect(h.store.get(j.id)).toBeNull();
  });

  test('a deletion request removes everything set by or for the person', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'tomorrow at 9', what: 'a' }));
    await h.handlers.commands.get('remind')!(h.ctx('rui', '/remind', { when: 'tomorrow at 9', what: 'b', who: '@ana' }));
    await h.handlers.events.get('user.data_deletion')!({ data: { user_id: 'ana', reason: 'requested' } });
    expect(h.store.inChat('g1')).toHaveLength(0);
    expect(h.store.settings('ana').tz).toBeNull();
  });

  test('quiet hours postpone a reminder for that person', async () => {
    const h = harness();
    await h.handlers.commands.get('quiet')!(h.ctx('ana', '/quiet', { from: '22:00', to: '08:00' }));
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'hoje às 23h', what: 'x' }));
    h.now.t = Date.parse('2026-11-26T22:00:30Z');
    expect(await h.tick()).toBe(0);
    h.now.t = Date.parse('2026-11-27T07:00:30Z');
    expect(await h.tick()).toBe(1);
  });

  test('unreadable or past times are answered privately', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'whenever', what: 'x' }));
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: '2026-01-01T00:00:00Z', what: 'x' }));
    expect(h.replies.map((r) => r.kind)).toEqual(['private', 'private']);
    expect(h.store.inChat('g1')).toHaveLength(0);
  });

  test('the time zone hint is given once', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('rui', '/remind', { when: 'tomorrow at 9', what: 'a' }));
    await h.handlers.commands.get('remind')!(h.ctx('rui', '/remind', { when: 'tomorrow at 10', what: 'b' }));
    expect(h.replies.filter((r) => r.kind === 'private')).toHaveLength(1);
  });

  test('a chat the bot was removed from loses its jobs', async () => {
    const h = harness();
    await h.handlers.commands.get('remind')!(h.ctx('ana', '/remind', { when: 'tomorrow at 9', what: 'x' }));
    await h.handlers.events.get('bot.removed')!({ chat_id: 'g1', data: {} });
    expect(h.store.inChat('g1')).toHaveLength(0);
  });
});
