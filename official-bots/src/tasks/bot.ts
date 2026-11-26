import type { Bot, ChatMember, CommandDefinition, Component, Context, Reply } from '@zwosocial/bot';

import { describeRule, formatAt, isTimeZone, nextOccurrence, parseWhen, type Lang } from '../lib/time';
import type { Task, TaskStore } from './store';

const TEXT = {
  en: {
    task: 'Task',
    due: 'Due',
    who: 'Assigned to',
    nobody: 'nobody yet',
    done: 'Done',
    doneBy: (who: string) => `Done by ${who}`,
    mine: 'I’ll take it',
    added: (n: number) => `Task #${n} added`,
    open: 'Open tasks',
    none: 'No open tasks here. 🎉',
    pick: 'Mark as done',
    needTitle: 'Give the task a title, like text:"Send the invoice".',
    badDue: 'I could not read that due date. Try "friday 18:00" or "in 3 days".',
    noTask: (n: number) => `There is no open task #${n} here.`,
    assigned: (n: number, who: string) => `Task #${n} is now ${who}’s.`,
    completed: (n: number, title: string) => `✅ #${n} ${title}`,
    dueNow: (n: number, title: string, who: string) => `⏰ Task #${n} is due: ${title}${who ? ` — ${who}` : ''}`,
    standupTitle: 'Standup',
    standupBody: (until: string) => `Tap Answer before ${until}.`,
    answer: 'Answer',
    yesterday: 'What did you do since the last one?',
    today: 'What will you do today?',
    blockers: 'Anything blocking you?',
    thanks: 'Thanks — it’s in the summary.',
    closed: 'This standup is closed.',
    summary: 'Standup summary',
    noAnswers: 'Nobody answered this time.',
    missing: (names: string) => `No answer from ${names}.`,
    blocked: 'Blocked',
    standupOn: (rule: string, tz: string) => `Standup ${rule} (${tz}). Answers are taken for the window, then summarised here.`,
    standupOff: 'Standup off.',
    badRule: 'Say when, like "every weekday 9:30" or "todos os dias úteis às 9h30".',
    badTz: 'That is not a time zone I know, e.g. Africa/Luanda.',
    digestTitle: 'This week',
    digestDone: 'Done',
    digestOpen: 'Still open',
    digestOverdue: 'Overdue',
    digestOn: 'Weekly digest on: Mondays at 9:00.',
    digestOff: 'Weekly digest off.',
  },
  pt: {
    task: 'Tarefa',
    due: 'Prazo',
    who: 'Responsável',
    nobody: 'ninguém ainda',
    done: 'Feita',
    doneBy: (who: string) => `Feita por ${who}`,
    mine: 'Fico eu',
    added: (n: number) => `Tarefa #${n} criada`,
    open: 'Tarefas abertas',
    none: 'Não há tarefas abertas aqui. 🎉',
    pick: 'Marcar como feita',
    needTitle: 'Dá um título à tarefa, como text:"Enviar a fatura".',
    badDue: 'Não percebi esse prazo. Experimenta "sexta às 18:00" ou "daqui a 3 dias".',
    noTask: (n: number) => `Não há nenhuma tarefa #${n} aberta aqui.`,
    assigned: (n: number, who: string) => `A tarefa #${n} passou a ser de ${who}.`,
    completed: (n: number, title: string) => `✅ #${n} ${title}`,
    dueNow: (n: number, title: string, who: string) => `⏰ A tarefa #${n} chegou ao prazo: ${title}${who ? ` — ${who}` : ''}`,
    standupTitle: 'Standup',
    standupBody: (until: string) => `Toca em Responder até ${until}.`,
    answer: 'Responder',
    yesterday: 'O que fizeste desde o último?',
    today: 'O que vais fazer hoje?',
    blockers: 'Há algo a bloquear-te?',
    thanks: 'Obrigado — já está no resumo.',
    closed: 'Este standup já fechou.',
    summary: 'Resumo do standup',
    noAnswers: 'Desta vez ninguém respondeu.',
    missing: (names: string) => `Sem resposta de ${names}.`,
    blocked: 'Bloqueado',
    standupOn: (rule: string, tz: string) => `Standup ${rule} (${tz}). As respostas são recolhidas durante a janela e depois resumidas aqui.`,
    standupOff: 'Standup desligado.',
    badRule: 'Diz quando, como "todos os dias úteis às 9h30" ou "every weekday 9:30".',
    badTz: 'Não conheço esse fuso horário, ex.: Africa/Luanda.',
    digestTitle: 'Esta semana',
    digestDone: 'Feitas',
    digestOpen: 'Ainda abertas',
    digestOverdue: 'Em atraso',
    digestOn: 'Resumo semanal ligado: às segundas, 9:00.',
    digestOff: 'Resumo semanal desligado.',
  },
} as const;

export const COMMANDS: CommandDefinition[] = [
  {
    name: 'task',
    description: 'Tasks: add, list, done, assign',
    description_pt: 'Tarefas: criar, ver, concluir, atribuir',
    options: [
      {
        name: 'action',
        description: 'What to do',
        description_pt: 'O que fazer',
        type: 'choice',
        required: true,
        choices: [
          { name: 'add', value: 'add' },
          { name: 'list', value: 'list' },
          { name: 'done', value: 'done' },
          { name: 'assign', value: 'assign' },
        ],
      },
      { name: 'text', description: 'Title (add)', description_pt: 'Título (criar)', type: 'string' },
      { name: 'due', description: 'Due: "friday 18:00"', description_pt: 'Prazo: "sexta às 18:00"', type: 'string', autocomplete: true },
      { name: 'who', description: 'Assign to', description_pt: 'Atribuir a', type: 'user' },
      { name: 'number', description: 'Task number (done, assign)', description_pt: 'Número da tarefa (concluir, atribuir)', type: 'number' },
    ],
  },
  {
    name: 'standup',
    description: 'Daily standup: "every weekday 9:30", or off',
    description_pt: 'Standup diário: "dias úteis às 9h30", ou off',
    options: [
      { name: 'when', description: 'When, or "off" / "now"', description_pt: 'Quando, ou "off" / "now"', type: 'string', required: true, autocomplete: true },
      { name: 'zone', description: 'Time zone, e.g. Africa/Luanda', description_pt: 'Fuso horário, ex.: Africa/Luanda', type: 'string', autocomplete: true },
      { name: 'window', description: 'Minutes to answer (default 120)', description_pt: 'Minutos para responder (120 por omissão)', type: 'number' },
    ],
  },
  {
    name: 'digest',
    description: 'Weekly task digest on Mondays',
    description_pt: 'Resumo semanal de tarefas às segundas',
    options: [{ name: 'on', description: 'on or off', description_pt: 'on ou off', type: 'choice', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }],
  },
];

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export type TasksOptions = { defaultTz: string; defaultLang: Lang; now?: () => number };

/** Wires the Tasks and Standup bot onto `bot`; returns the scheduler tick. */
export function tasks(bot: Bot, store: TaskStore, opts: TasksOptions) {
  const now = opts.now ?? (() => Date.now());
  const members = new Map<string, { at: number; list: ChatMember[] }>();

  async function memberList(chatId: string): Promise<ChatMember[]> {
    const hit = members.get(chatId);
    if (hit && now() - hit.at < 60_000) return hit.list;
    const list = await bot.api.members(chatId).catch(() => hit?.list ?? ([] as ChatMember[]));
    members.set(chatId, { at: now(), list });
    return list;
  }

  const chatLang = (chatId: string): Lang => store.chat(chatId)?.lang ?? opts.defaultLang;
  const chatTz = (chatId: string): string => store.chat(chatId)?.tz ?? store.standup(chatId)?.tz ?? opts.defaultTz;
  const nameOf = async (chatId: string, userId: string) => {
    const m = (await memberList(chatId)).find((x) => x.user_id === userId);
    return m ? `@${m.username}` : '';
  };

  function card(t: Task, lang: Lang, tz: string): Reply {
    const x = TEXT[lang];
    const fields = [
      { name: x.who, value: t.assigneeName ? `@${t.assigneeName}` : x.nobody, inline: true },
      ...(t.dueAt ? [{ name: x.due, value: formatAt(new Date(t.dueAt), tz, lang), inline: true }] : []),
    ];
    if (t.doneAt) {
      return { text: x.completed(t.n, t.title), card: { title: `#${t.n} ${t.title}`, fields, footer: x.doneBy(t.doneBy ? `@${t.doneBy}` : ''), color: 'success' } };
    }
    const overdue = t.dueAt !== null && t.dueAt < now();
    return {
      text: `${x.task} #${t.n}: ${t.title}`,
      card: { title: `#${t.n} ${t.title}`, fields, color: overdue ? 'danger' : 'primary' },
      components: [
        [
          { type: 'button', id: `done:${t.id}`, label: x.done, style: 'primary' },
          { type: 'button', id: `mine:${t.id}`, label: x.mine, style: 'secondary' },
        ],
      ],
    };
  }

  async function refreshCard(t: Task, isGroup: boolean, to: string) {
    if (!t.messageId) return;
    await bot.edit(t.chatId, t.messageId, card(t, chatLang(t.chatId), chatTz(t.chatId)), { isGroup, to }).catch(() => {});
  }

  bot.command('task', async (ctx) => {
    store.touchChat(ctx.chatId, ctx.isGroup);
    const o = ctx.command?.options ?? {};
    let lang = chatLang(ctx.chatId);
    const tz = chatTz(ctx.chatId);
    const action = o.action ?? 'list';

    if (action === 'add') {
      const title = (o.text ?? '').trim();
      if (!title) return ctx.replyPrivately(TEXT[lang].needTitle);
      let dueAt: number | null = null;
      if (o.due) {
        const w = parseWhen(o.due, { tz, now: new Date(now()) });
        if (!w || w.rule) return ctx.replyPrivately(TEXT[lang].badDue);
        dueAt = w.at.getTime();
        lang = w.lang;
        store.touchChat(ctx.chatId, ctx.isGroup, { lang });
      }
      let assigneeId: string | null = null;
      let assigneeName: string | null = null;
      if (o.who) {
        const m = (await memberList(ctx.chatId)).find((x) => x.username.toLowerCase() === o.who!.replace(/^@/, '').toLowerCase());
        if (m) [assigneeId, assigneeName] = [m.user_id, m.username];
      }
      const t = store.addTask({ chatId: ctx.chatId, title: title.slice(0, 300), assigneeId, assigneeName, dueAt, createdBy: ctx.senderId, createdAt: now() });
      const sent = await ctx.reply(card(t, lang, tz));
      store.setMessage(t.id, sent.id);
      return;
    }

    if (action === 'list') {
      const open = store.open(ctx.chatId);
      const x = TEXT[lang];
      if (!open.length) return ctx.reply(x.none);
      const line = (t: Task) =>
        `#${t.n} ${t.title}${t.assigneeName ? ` — @${t.assigneeName}` : ''}${t.dueAt ? ` · ${formatAt(new Date(t.dueAt), tz, lang)}` : ''}${t.dueAt && t.dueAt < now() ? ' ⚠️' : ''}`;
      return ctx.reply({
        text: `${x.open}:\n${open.map(line).join('\n')}`,
        card: { title: x.open, description: open.slice(0, 20).map(line).join('\n'), color: 'info' },
        components: [
          [
            {
              type: 'select',
              id: 'done-many',
              placeholder: x.pick,
              max: Math.min(open.length, 25),
              options: open.slice(0, 25).map((t) => ({ label: `#${t.n} ${t.title}`.slice(0, 80), value: String(t.id) })),
            },
          ],
        ],
      });
    }

    const n = Math.round(Number(o.number));
    const t = Number.isFinite(n) ? store.byNumber(ctx.chatId, n) : null;
    if (!t || t.doneAt) return ctx.replyPrivately(TEXT[lang].noTask(n));
    if (action === 'done') {
      const me = (await nameOf(ctx.chatId, ctx.senderId)).replace(/^@/, '');
      store.complete(t.id, me, now());
      const done = store.task(t.id)!;
      await refreshCard(done, ctx.isGroup, ctx.senderId);
      return ctx.reply(TEXT[lang].completed(done.n, done.title));
    }
    if (action === 'assign') {
      const m = (await memberList(ctx.chatId)).find((x) => x.username.toLowerCase() === (o.who ?? '').replace(/^@/, '').toLowerCase());
      if (!m) return ctx.replyPrivately(TEXT[lang].noTask(n));
      store.assign(t.id, m.user_id, m.username);
      await refreshCard(store.task(t.id)!, ctx.isGroup, ctx.senderId);
      return ctx.reply(TEXT[lang].assigned(t.n, `@${m.username}`));
    }
  });

  bot.onAutocomplete('task', 'due', ({ value, ctx }) => {
    const tz = chatTz(ctx.chatId);
    const w = parseWhen(value, { tz, now: new Date(now()) });
    return w && !w.rule ? [{ name: formatAt(w.at, tz, w.lang), value }] : [];
  });

  // ── Standup ──

  bot.command('standup', async (ctx) => {
    const o = ctx.command?.options ?? {};
    const when = (o.when ?? '').trim();
    const zone = (o.zone ?? '').trim() || chatTz(ctx.chatId);
    let lang = chatLang(ctx.chatId);
    store.touchChat(ctx.chatId, ctx.isGroup);
    if (/^(?:off|desligar|nao|não)$/i.test(when)) {
      store.dropStandup(ctx.chatId);
      return ctx.reply(TEXT[lang].standupOff);
    }
    if (!isTimeZone(zone)) return ctx.replyPrivately(TEXT[lang].badTz);
    if (/^(?:now|agora)$/i.test(when)) {
      const s = store.standup(ctx.chatId);
      const windowMin = o.window ? Math.max(10, Math.min(12 * 60, Math.round(Number(o.window)) || 120)) : (s?.windowMin ?? 120);
      await startStandup(ctx.chatId, windowMin, s?.lang ?? lang, s?.tz ?? zone);
      return;
    }
    const w = parseWhen(when, { tz: zone, now: new Date(now()) });
    if (!w?.rule) return ctx.replyPrivately(TEXT[lang].badRule);
    lang = w.lang;
    const windowMin = Math.max(10, Math.min(12 * 60, Math.round(Number(o.window)) || 120));
    store.saveStandup({ chatId: ctx.chatId, rule: w.rule, tz: zone, lang, windowMin, nextAt: w.at.getTime() });
    store.touchChat(ctx.chatId, ctx.isGroup, { lang, tz: zone });
    return ctx.reply(TEXT[lang].standupOn(describeRule(w.rule, lang), zone));
  });

  bot.onAutocomplete('standup', 'when', ({ value, ctx }) => {
    const tz = chatTz(ctx.chatId);
    const w = parseWhen(value, { tz, now: new Date(now()) });
    return w?.rule ? [{ name: `${describeRule(w.rule, w.lang)} · ${formatAt(w.at, tz, w.lang)}`.slice(0, 100), value }] : [];
  });
  bot.onAutocomplete('standup', 'zone', ({ value }) =>
    ZONES.filter((z) => z.toLowerCase().includes(value.toLowerCase().replace(/\s+/g, '_')))
      .slice(0, 25)
      .map((z) => ({ name: z, value: z })),
  );

  async function startStandup(chatId: string, windowMin: number, lang: Lang, tz: string) {
    const x = TEXT[lang];
    const endsAt = now() + windowMin * 60_000;
    const run = store.startRun(chatId, now(), endsAt);
    const isGroup = store.chat(chatId)?.isGroup ?? true;
    const form: Component = {
      type: 'form',
      id: `standup:${run.id}`,
      title: x.standupTitle,
      submit_label: x.answer,
      fields: [
        { id: 'yesterday', label: x.yesterday, type: 'text' },
        { id: 'today', label: x.today, type: 'text', required: true },
        { id: 'blockers', label: x.blockers, type: 'text' },
      ],
    };
    const sent = await bot
      .send(
        chatId,
        {
          text: `🧍 ${x.standupTitle}`,
          card: { title: `🧍 ${x.standupTitle}`, description: x.standupBody(formatAt(new Date(endsAt), tz, lang)), color: 'primary' },
          components: [[form]],
          expires_at: new Date(endsAt).toISOString(),
        },
        { isGroup },
      )
      .catch((err) => {
        console.error('[tasks] standup', chatId, err);
        return null;
      });
    if (sent) store.setRunMessage(run.id, sent.id);
  }

  async function closeStandup(runId: number) {
    const run = store.run(runId);
    if (!run || run.closed) return;
    const s = store.standup(run.chatId);
    const lang = s?.lang ?? chatLang(run.chatId);
    const x = TEXT[lang];
    const answers = store.answers(runId);
    const people = (await memberList(run.chatId)).filter((m) => !m.is_bot);
    const silent = people.filter((m) => !answers.some((a) => a.userId === m.user_id)).map((m) => `@${m.username}`);
    const blocked = answers.filter((a) => a.blockers.trim() && !/^(?:no|none|nada|nao|não|-)$/i.test(a.blockers.trim()));
    const reply: Reply = answers.length
      ? {
          text: `${x.summary}\n${answers.map((a) => `@${a.username}: ${a.today}`).join('\n')}`,
          card: {
            title: `📋 ${x.summary}`,
            fields: answers.slice(0, 9).map((a) => ({ name: `@${a.username}`, value: `${a.yesterday ? `↩ ${a.yesterday}\n` : ''}→ ${a.today}`.slice(0, 500) })),
            ...(blocked.length || silent.length
              ? { description: [blocked.length ? `🚧 ${x.blocked}: ${blocked.map((a) => `@${a.username} — ${a.blockers}`).join('; ')}` : '', silent.length ? x.missing(silent.join(', ')) : ''].filter(Boolean).join('\n').slice(0, 1000) }
              : {}),
            color: blocked.length ? 'warning' : 'success',
          },
        }
      : x.noAnswers;
    await bot.send(run.chatId, reply, { isGroup: store.chat(run.chatId)?.isGroup ?? true }).catch((err) => console.error('[tasks] summary', err));
    store.closeRun(runId);
  }

  // ── Digest ──

  bot.command('digest', (ctx) => {
    const on = (ctx.command?.options.on ?? 'on') === 'on';
    const tz = chatTz(ctx.chatId);
    const next = nextOccurrence({ kind: 'weekly', days: [1], hour: 9, minute: 0 }, new Date(now()), tz).getTime();
    store.touchChat(ctx.chatId, ctx.isGroup, { digest: on, digestNextAt: on ? next : null });
    return ctx.reply(on ? TEXT[chatLang(ctx.chatId)].digestOn : TEXT[chatLang(ctx.chatId)].digestOff);
  });

  async function digest(chatId: string) {
    const lang = chatLang(chatId);
    const tz = chatTz(chatId);
    const x = TEXT[lang];
    const done = store.doneSince(chatId, now() - 7 * 86_400_000);
    const open = store.open(chatId);
    const overdue = open.filter((t) => t.dueAt !== null && t.dueAt < now());
    const list = (ts: Task[]) => ts.slice(0, 10).map((t) => `#${t.n} ${t.title}`).join('\n') || '—';
    await bot
      .send(
        chatId,
        {
          text: `${x.digestTitle}: ${done.length} ${x.digestDone.toLowerCase()}, ${open.length} ${x.digestOpen.toLowerCase()}`,
          card: {
            title: `🗓️ ${x.digestTitle}`,
            fields: [
              { name: `${x.digestDone} (${done.length})`, value: list(done) },
              { name: `${x.digestOpen} (${open.length})`, value: list(open) },
              ...(overdue.length ? [{ name: `${x.digestOverdue} (${overdue.length})`, value: list(overdue) }] : []),
            ],
            color: overdue.length ? 'warning' : 'info',
          },
        },
        { isGroup: store.chat(chatId)?.isGroup ?? true },
      )
      .catch((err) => console.error('[tasks] digest', err));
    const next = nextOccurrence({ kind: 'weekly', days: [1], hour: 9, minute: 0 }, new Date(now()), tz).getTime();
    store.touchChat(chatId, store.chat(chatId)?.isGroup ?? true, { digestNextAt: next });
  }

  // ── Clicks ──

  bot.onInteraction('*', async (ctx) => {
    const id = ctx.componentId ?? '';
    const lang = chatLang(ctx.chatId);
    const x = TEXT[lang];
    if (id.startsWith('standup:')) {
      const run = store.run(Number(id.slice('standup:'.length)));
      if (!run || run.closed || run.chatId !== ctx.chatId || run.endsAt < now()) return ctx.replyPrivately(x.closed);
      const v = (ctx.values ?? {}) as Record<string, string>;
      if (!v.today?.trim()) return;
      store.answer(run.id, {
        userId: ctx.senderId,
        username: (await nameOf(ctx.chatId, ctx.senderId)).replace(/^@/, '') || ctx.senderId.slice(0, 8),
        yesterday: (v.yesterday ?? '').slice(0, 500),
        today: v.today.slice(0, 500),
        blockers: (v.blockers ?? '').slice(0, 500),
      });
      return ctx.replyPrivately(x.thanks);
    }
    const ids =
      id === 'done-many' && Array.isArray(ctx.values) ? ctx.values.map(Number) : id.startsWith('done:') || id.startsWith('mine:') ? [Number(id.split(':')[1])] : [];
    const me = (await nameOf(ctx.chatId, ctx.senderId)).replace(/^@/, '');
    for (const taskId of ids) {
      const t = store.task(taskId);
      if (!t || t.chatId !== ctx.chatId || t.doneAt) continue;
      if (id.startsWith('mine:')) store.assign(t.id, ctx.senderId, me);
      else store.complete(t.id, me, now());
      await refreshCard(store.task(t.id)!, ctx.isGroup, ctx.senderId);
    }
  });

  bot.on('bot.removed', (e) => {
    if (e.chat_id) store.removeChat(e.chat_id);
  });
  bot.on('user.data_deletion', (e) => {
    const { user_id } = e.data as { user_id?: string };
    if (user_id) store.forget(user_id);
  });

  /** Standups to start and close, due tasks, digests. Runs one at a time. */
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const s of store.standupsDue(now())) {
        // A run missed by more than its window is skipped, never backfilled.
        if (now() - s.nextAt < s.windowMin * 60_000) await startStandup(s.chatId, s.windowMin, s.lang, s.tz);
        store.saveStandup({ ...s, nextAt: nextOccurrence(s.rule, new Date(now()), s.tz).getTime() });
      }
      for (const run of store.runsToClose(now())) await closeStandup(run.id);
      for (const t of store.dueToNotify(now())) {
        store.markNotified(t.id);
        const lang = chatLang(t.chatId);
        await bot
          .send(t.chatId, TEXT[lang].dueNow(t.n, t.title, t.assigneeName ? `@${t.assigneeName}` : ''), {
            isGroup: store.chat(t.chatId)?.isGroup ?? true,
            to: t.assigneeId ?? t.createdBy,
          })
          .catch(() => {});
      }
      for (const chatId of store.digestsDue(now())) await digest(chatId);
    } finally {
      running = false;
    }
  }

  return { tick };
}
