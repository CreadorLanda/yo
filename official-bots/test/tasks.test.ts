import { describe, expect, test } from 'bun:test';

import type { Bot } from '@zwosocial/bot';

import { tasks } from '../src/tasks/bot';
import { TaskStore } from '../src/tasks/store';

const T0 = Date.parse('2026-11-26T09:00:00Z'); // Thursday, 10:00 in Luanda

function harness() {
  const handlers = { commands: new Map<string, Function>(), interactions: new Map<string, Function>(), events: new Map<string, Function>() };
  const sent: { chat: string; reply: any }[] = [];
  const edits: { id: number; reply: any }[] = [];
  const privately: unknown[] = [];
  const list = [
    { user_id: 'ana', username: 'ana', display_name: 'Ana', is_bot: false, role: 'admin' },
    { user_id: 'rui', username: 'rui', display_name: 'Rui', is_bot: false, role: 'member' },
    { user_id: 'bot', username: 'tasks_bot', display_name: 'Tasks', is_bot: true, role: 'member' },
  ];
  const fake = {
    command: (n: string, h: Function) => handlers.commands.set(n, h),
    onInteraction: (id: string, h: Function) => handlers.interactions.set(id, h),
    onAutocomplete: () => {},
    on: (t: string, h: Function) => handlers.events.set(t, h),
    send: async (chat: string, reply: unknown) => (sent.push({ chat, reply }), { id: 100 + sent.length }),
    edit: async (_c: string, id: number, reply: unknown) => void edits.push({ id, reply }),
    api: { members: async () => list },
  } as unknown as Bot;
  const store = new TaskStore(':memory:');
  const clock = { t: T0 };
  const { tick } = tasks(fake, store, { defaultTz: 'Africa/Luanda', defaultLang: 'en', now: () => clock.t });
  const ctx = (senderId: string, options?: Record<string, string>, extra: object = {}) => ({
    chatId: 'g',
    senderId,
    isGroup: true,
    text: '',
    command: options ? { name: 'x', options } : undefined,
    reply: async (b: unknown) => (sent.push({ chat: 'g', reply: b }), { id: 100 + sent.length }),
    replyPrivately: async (b: unknown) => void privately.push(b),
    edit: async () => {},
    ...extra,
  });
  return { handlers, sent, edits, privately, store, tick, ctx, clock };
}

describe('tasks', () => {
  test('add with a due date and an assignee; the due time is announced once', async () => {
    const h = harness();
    await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text: 'Enviar a fatura', due: 'amanhã às 18h', who: '@rui' }));
    const t = h.store.byNumber('g', 1)!;
    expect(t.assigneeId).toBe('rui');
    expect(t.dueAt).toBe(Date.parse('2026-11-27T17:00:00Z'));
    expect(t.messageId).toBe(101);
    expect(h.sent[0].reply.components[0].map((c: any) => c.id)).toEqual([`done:${t.id}`, `mine:${t.id}`]);
    h.clock.t = t.dueAt! + 1000;
    await h.tick();
    await h.tick();
    expect(h.sent.filter((s) => String(s.reply).includes('#1'))).toHaveLength(1);
  });

  test('done by button edits the card; a done task cannot be done again', async () => {
    const h = harness();
    await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text: 'X' }));
    const t = h.store.byNumber('g', 1)!;
    await h.handlers.interactions.get('*')!(h.ctx('rui', undefined, { componentId: `done:${t.id}` }));
    expect(h.store.task(t.id)!.doneBy).toBe('rui');
    expect(h.edits[0]).toMatchObject({ id: 101, reply: { card: { color: 'success' } } });
    await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'done', number: '1' }));
    expect(h.privately).toHaveLength(1);
  });

  test('list offers a menu to finish several at once', async () => {
    const h = harness();
    for (const text of ['A', 'B', 'C']) await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text }));
    await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'list' }));
    const ids = h.store.open('g').map((t) => String(t.id));
    await h.handlers.interactions.get('*')!(h.ctx('ana', undefined, { componentId: 'done-many', values: ids.slice(0, 2) }));
    expect(h.store.open('g').map((t) => t.title)).toEqual(['C']);
  });
});

describe('standup', () => {
  test('posts a form at the time, collects answers, then a summary naming who did not answer', async () => {
    const h = harness();
    await h.handlers.commands.get('standup')!(h.ctx('ana', { when: 'every weekday 9:30', window: '60' }));
    h.clock.t = Date.parse('2026-11-27T08:30:10Z'); // Friday 9:30 in Luanda
    await h.tick();
    const post = h.sent.at(-1)!.reply;
    const form = post.components[0][0];
    expect(form.type).toBe('form');
    await h.handlers.interactions.get('*')!(h.ctx('ana', undefined, { componentId: form.id, values: { yesterday: 'PR', today: 'reviews', blockers: 'CI is slow' } }));
    h.clock.t += 61 * 60_000;
    await h.tick();
    const summary = h.sent.at(-1)!.reply;
    expect(summary.card.fields).toEqual([{ name: '@ana', value: '↩ PR\n→ reviews' }]);
    expect(summary.card.description).toContain('CI is slow');
    expect(summary.card.description).toContain('@rui');
    expect(summary.card.description).not.toContain('tasks_bot');
    // The answers are gone once summarised.
    expect(h.store.answers(1)).toEqual([]);
    // Answering after the window closes is refused.
    await h.handlers.interactions.get('*')!(h.ctx('rui', undefined, { componentId: form.id, values: { today: 'late' } }));
    expect(h.privately).toEqual(['Thanks — it’s in the summary.', 'This standup is closed.']);
  });

  test('a standup missed by more than its window is skipped, not run late', async () => {
    const h = harness();
    await h.handlers.commands.get('standup')!(h.ctx('ana', { when: 'every weekday 9:30', window: '60' }));
    h.clock.t = Date.parse('2026-11-27T12:00:00Z'); // the bot was down at 9:30
    await h.tick();
    expect(h.sent.filter((s) => s.reply?.components)).toHaveLength(0);
    expect(h.store.standup('g')!.nextAt).toBe(Date.parse('2026-11-30T08:30:00Z')); // Monday
  });

  test('off stops it', async () => {
    const h = harness();
    await h.handlers.commands.get('standup')!(h.ctx('ana', { when: 'todos os dias às 9h' }));
    await h.handlers.commands.get('standup')!(h.ctx('ana', { when: 'off' }));
    expect(h.store.standup('g')).toBeNull();
  });
});

test('the weekly digest lists done, open and overdue tasks on Mondays', async () => {
  const h = harness();
  await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text: 'Late', due: 'amanhã às 9' }));
  await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text: 'Finished' }));
  await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'done', number: '2' }));
  await h.handlers.commands.get('digest')!(h.ctx('ana', { on: 'on' }));
  h.clock.t = Date.parse('2026-11-30T08:00:30Z'); // Monday 9:00 in Luanda
  await h.tick();
  const d = h.sent.at(-1)!.reply;
  // The due date was written in Portuguese, so the chat's replies are too.
  expect(d.card.fields.map((f: any) => f.name)).toEqual(['Feitas (1)', 'Ainda abertas (1)', 'Em atraso (1)']);
});

test('a deletion request removes what the person wrote and their name from tasks', async () => {
  const h = harness();
  await h.handlers.commands.get('task')!(h.ctx('ana', { action: 'add', text: 'Mine' }));
  await h.handlers.commands.get('task')!(h.ctx('rui', { action: 'add', text: 'For Ana', who: '@ana' }));
  await h.handlers.events.get('user.data_deletion')!({ data: { user_id: 'ana' } });
  const left = h.store.open('g');
  expect(left.map((t) => [t.title, t.assigneeId])).toEqual([['For Ana', null]]);
});
