import type { Bot, ChatMember, CommandDefinition, Context, Reply } from '@zwosocial/bot';

import { describeRule, formatAt, isTimeZone, parseClock, parseWhen, type Lang, type When } from '../lib/time';
import { step } from './schedule';
import type { Job, ReminderStore, Target } from './store';

/** At most this many pending jobs per person, across chats. */
export const MAX_JOBS_PER_PERSON = 50;

const TEXT = {
  en: {
    set: 'Reminder set',
    scheduled: 'Message scheduled',
    when: 'When',
    what: 'What',
    for: 'For',
    repeats: 'Repeats',
    cancel: 'Cancel',
    cancelled: 'Cancelled',
    reminder: 'reminder',
    late: (at: string) => `(late — it was due ${at})`,
    everyone: 'everyone here',
    cantRead: 'I could not read that time. Try "tomorrow at 9", "in 20 minutes", "friday 18:00" or "every monday 10:00".',
    passed: 'That time has already passed.',
    empty: 'Tell me what to remind you of.',
    tooMany: `You already have ${MAX_JOBS_PER_PERSON} reminders. Cancel some with /reminders first.`,
    tzHint: (tz: string) => `Times are in ${tz}. Set yours with /timezone.`,
    none: 'Nothing scheduled here.',
    list: 'Scheduled here',
    pick: 'Pick to cancel',
    notYours: 'Only whoever set it, the person it is for, or a group admin can cancel it.',
    gone: 'That one already went or was cancelled.',
    tzSet: (tz: string) => `Your time zone is now ${tz}.`,
    tzBad: 'That is not a time zone I know. Try one like Africa/Luanda or Europe/Lisbon.',
    quietSet: (a: string, b: string) => `Quiet hours: ${a}–${b}. Reminders for you wait until they end.`,
    quietOff: 'Quiet hours off.',
    quietBad: 'Give two times, like from:22:00 to:08:00, or from:off.',
    cancelledN: (n: number) => `Cancelled ${n}.`,
  },
  pt: {
    set: 'Lembrete marcado',
    scheduled: 'Mensagem agendada',
    when: 'Quando',
    what: 'O quê',
    for: 'Para',
    repeats: 'Repete',
    cancel: 'Cancelar',
    cancelled: 'Cancelado',
    reminder: 'lembrete',
    late: (at: string) => `(atrasado — era para ${at})`,
    everyone: 'toda a gente aqui',
    cantRead: 'Não percebi essa hora. Experimenta "amanhã às 9", "daqui a 20 minutos", "sexta às 18:00" ou "todas as segundas às 10:00".',
    passed: 'Essa hora já passou.',
    empty: 'Diz-me do que te devo lembrar.',
    tooMany: `Já tens ${MAX_JOBS_PER_PERSON} lembretes. Cancela alguns com /reminders primeiro.`,
    tzHint: (tz: string) => `As horas estão em ${tz}. Define o teu fuso com /timezone.`,
    none: 'Não há nada agendado aqui.',
    list: 'Agendado aqui',
    pick: 'Escolhe para cancelar',
    notYours: 'Só quem o marcou, a pessoa a quem se destina ou um admin do grupo o pode cancelar.',
    gone: 'Esse já foi enviado ou cancelado.',
    tzSet: (tz: string) => `O teu fuso horário passou a ser ${tz}.`,
    tzBad: 'Não conheço esse fuso horário. Experimenta um como Africa/Luanda ou Europe/Lisbon.',
    quietSet: (a: string, b: string) => `Horas de silêncio: ${a}–${b}. Os lembretes para ti esperam até acabarem.`,
    quietOff: 'Horas de silêncio desligadas.',
    quietBad: 'Indica duas horas, como from:22:00 to:08:00, ou from:off.',
    cancelledN: (n: number) => `${n} cancelado(s).`,
  },
} as const;

export const COMMANDS: CommandDefinition[] = [
  {
    name: 'remind',
    description: 'Remind you or someone: "tomorrow at 9", "every monday 10:00"',
    description_pt: 'Lembrar-te a ti ou a alguém: "amanhã às 9", "todas as segundas às 10:00"',
    options: [
      { name: 'when', description: 'When, in your words', description_pt: 'Quando, por palavras tuas', type: 'string', required: true, autocomplete: true },
      { name: 'what', description: 'What to remind of', description_pt: 'Do que lembrar', type: 'string', required: true },
      { name: 'who', description: 'Someone else (you by default)', description_pt: 'Outra pessoa (tu por omissão)', type: 'user' },
    ],
  },
  {
    name: 'schedule',
    description: 'Post a message here later, once or on repeat',
    description_pt: 'Publicar uma mensagem aqui mais tarde, uma vez ou a repetir',
    options: [
      { name: 'when', description: 'When, in your words', description_pt: 'Quando, por palavras tuas', type: 'string', required: true, autocomplete: true },
      { name: 'message', description: 'The message', description_pt: 'A mensagem', type: 'string', required: true },
    ],
  },
  { name: 'reminders', description: 'See and cancel what is scheduled here', description_pt: 'Ver e cancelar o que está agendado aqui', options: [] },
  {
    name: 'timezone',
    description: 'Set your time zone',
    description_pt: 'Definir o teu fuso horário',
    options: [{ name: 'zone', description: 'e.g. Africa/Luanda', description_pt: 'ex.: Africa/Luanda', type: 'string', required: true, autocomplete: true }],
  },
  {
    name: 'quiet',
    description: 'Quiet hours: reminders for you wait until they end',
    description_pt: 'Horas de silêncio: os lembretes para ti esperam até acabarem',
    options: [
      { name: 'from', description: '22:00, or "off"', description_pt: '22:00, ou "off"', type: 'string', required: true },
      { name: 'to', description: '08:00', description_pt: '08:00', type: 'string' },
    ],
  },
];

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export type RemindersOptions = { defaultTz: string; defaultLang: Lang; now?: () => number };

/** Wires the Reminders bot onto `bot`; returns the scheduler tick. */
export function reminders(bot: Bot, store: ReminderStore, opts: RemindersOptions) {
  const now = opts.now ?? (() => Date.now());
  const members = new Map<string, { at: number; list: ChatMember[] }>();

  async function memberList(chatId: string): Promise<ChatMember[]> {
    const hit = members.get(chatId);
    if (hit && now() - hit.at < 5 * 60_000) return hit.list;
    const list = await bot.api.members(chatId).catch(() => [] as ChatMember[]);
    members.set(chatId, { at: now(), list });
    return list;
  }

  const tzOf = (userId: string) => store.settings(userId).tz ?? opts.defaultTz;
  const langOf = (userId: string, parsed?: Lang) => parsed ?? store.settings(userId).lang ?? opts.defaultLang;

  function remember(userId: string, lang: Lang) {
    const s = store.settings(userId);
    if (s.lang !== lang) store.saveSettings({ ...s, lang });
  }

  /** "/remind me amanhã às 9 regar as plantas": who, then the longest time phrase, then what. */
  function freeForm(text: string, tz: string): { who?: string; when?: When; what: string } {
    const words = text.replace(/^\/\S+\s*/, '').split(/\s+/).filter(Boolean);
    let who: string | undefined;
    if (words[0] && /^(?:me|eu|mim|here|aqui|@\S+)$/i.test(words[0])) who = words.shift();
    for (let n = words.length; n > 0; n--) {
      const when = parseWhen(words.slice(0, n).join(' '), { tz, now: new Date(now()) });
      if (when) return { who, when, what: words.slice(n).join(' ').replace(/^(?:to|de|para|que)\s+/i, '') };
    }
    for (let n = 1; n < words.length; n++) {
      const when = parseWhen(words.slice(n).join(' '), { tz, now: new Date(now()) });
      if (when) return { who, when, what: words.slice(0, n).join(' ').replace(/^(?:to|de|para|que)\s+/i, '') };
    }
    return { who, what: words.join(' ') };
  }

  async function resolveTarget(ctx: Context, who: string | undefined): Promise<Target | null> {
    if (who && /^(?:here|aqui)$/i.test(who)) return { kind: 'here' };
    const list = await memberList(ctx.chatId);
    if (!who || /^(?:me|eu|mim)$/i.test(who)) {
      const me = list.find((m) => m.user_id === ctx.senderId);
      return { kind: 'me', userId: ctx.senderId, username: me?.username ?? '' };
    }
    const name = who.replace(/^@/, '').toLowerCase();
    const m = list.find((x) => x.username.toLowerCase() === name || x.user_id === who);
    return m ? { kind: 'user', userId: m.user_id, username: m.username } : null;
  }

  function card(job: Job, title: string): Reply {
    const t = TEXT[job.lang];
    const fields = [
      { name: t.when, value: formatAt(new Date(job.nextAt), job.tz, job.lang), inline: true },
      ...(job.rule ? [{ name: t.repeats, value: describeRule(job.rule, job.lang), inline: true }] : []),
      ...(job.kind === 'reminder'
        ? [{ name: t.for, value: job.target.kind === 'here' ? t.everyone : `@${job.target.username}`, inline: true }]
        : []),
      { name: t.what, value: job.text.slice(0, 200) },
    ];
    return {
      text: `${title}: ${job.text}`,
      card: { title, fields, color: 'info' },
      components: [[{ type: 'button', id: `cancel:${job.id}`, label: t.cancel, style: 'secondary' }]],
    };
  }

  async function create(ctx: Context, kind: Job['kind'], who: string | undefined, whenText: string | undefined, what: string, pre?: When) {
    const tz = tzOf(ctx.senderId);
    const when = pre ?? (whenText ? parseWhen(whenText, { tz, now: new Date(now()) }) : null);
    const lang = langOf(ctx.senderId, when?.lang);
    const t = TEXT[lang];
    if (!when) return ctx.replyPrivately(t.cantRead);
    remember(ctx.senderId, when.lang);
    if (!what.trim()) return ctx.replyPrivately(t.empty);
    if (when.at.getTime() <= now()) return ctx.replyPrivately(t.passed);
    if (store.countByCreator(ctx.senderId) >= MAX_JOBS_PER_PERSON) return ctx.replyPrivately(t.tooMany);
    const target = kind === 'message' ? ({ kind: 'here' } as const) : await resolveTarget(ctx, who);
    if (!target) return ctx.replyPrivately(t.notYours);
    const job: Job = {
      id: crypto.randomUUID(),
      chatId: ctx.chatId,
      isGroup: ctx.isGroup,
      creatorId: ctx.senderId,
      kind,
      target,
      text: what.trim().slice(0, 1000),
      rule: when.rule ?? null,
      tz,
      lang,
      nextAt: when.at.getTime(),
      postponed: false,
      createdAt: now(),
    };
    store.add(job);
    await ctx.reply(card(job, kind === 'message' ? t.scheduled : t.set));
    if (!store.settings(ctx.senderId).tz && !store.hintedTz(ctx.senderId)) {
      store.markHintedTz(ctx.senderId);
      await ctx.replyPrivately(t.tzHint(tz));
    }
  }

  bot.command('remind', (ctx) => {
    const o = ctx.command?.options ?? {};
    if (o.when || o.what) return create(ctx, 'reminder', o.who, o.when, o.what ?? '');
    const f = freeForm(ctx.text, tzOf(ctx.senderId));
    return create(ctx, 'reminder', f.who, undefined, f.what, f.when ?? undefined);
  });

  bot.command('schedule', (ctx) => {
    const o = ctx.command?.options ?? {};
    if (o.when || o.message) return create(ctx, 'message', 'here', o.when, o.message ?? '');
    const f = freeForm(ctx.text, tzOf(ctx.senderId));
    return create(ctx, 'message', 'here', undefined, f.what, f.when ?? undefined);
  });

  async function isAdmin(chatId: string, userId: string) {
    return (await memberList(chatId)).some((m) => m.user_id === userId && m.role === 'admin');
  }

  async function mayCancel(job: Job, userId: string) {
    if (job.creatorId === userId) return true;
    if (job.target.kind !== 'here' && job.target.userId === userId) return true;
    return job.isGroup && isAdmin(job.chatId, userId);
  }

  bot.command('reminders', async (ctx) => {
    const lang = langOf(ctx.senderId);
    const t = TEXT[lang];
    const admin = ctx.isGroup && (await isAdmin(ctx.chatId, ctx.senderId));
    const mine = store
      .inChat(ctx.chatId)
      .filter((j) => admin || !ctx.isGroup || j.creatorId === ctx.senderId || (j.target.kind !== 'here' && j.target.userId === ctx.senderId))
      .slice(0, 25);
    if (!mine.length) return ctx.replyPrivately(t.none);
    const line = (j: Job) => `${formatAt(new Date(j.nextAt), j.tz, lang)}${j.rule ? ` (${describeRule(j.rule, lang)})` : ''} — ${j.text}`;
    return ctx.replyPrivately({
      text: `${t.list}:\n${mine.map((j) => `• ${line(j)}`).join('\n')}`,
      components: [
        [
          {
            type: 'select',
            id: 'cancel-many',
            placeholder: t.pick,
            max: mine.length,
            options: mine.map((j) => ({ label: line(j).slice(0, 80), value: j.id })),
          },
        ],
      ],
    });
  });

  bot.onInteraction('*', async (ctx) => {
    const lang = langOf(ctx.senderId);
    const t = TEXT[lang];
    const ids =
      ctx.componentId === 'cancel-many' && Array.isArray(ctx.values)
        ? ctx.values
        : ctx.componentId?.startsWith('cancel:')
          ? [ctx.componentId.slice('cancel:'.length)]
          : [];
    if (!ids.length) return;
    let n = 0;
    for (const id of ids) {
      const job = store.get(id);
      if (!job || job.chatId !== ctx.chatId) continue;
      if (!(await mayCancel(job, ctx.senderId))) return ctx.replyPrivately(t.notYours);
      store.remove(id);
      n++;
    }
    if (ctx.componentId?.startsWith('cancel:')) {
      if (!n) return ctx.replyPrivately(t.gone);
      if (ctx.messageId) await ctx.edit(ctx.messageId, { text: `~~${t.reminder}~~ — ${t.cancelled}` }).catch(() => {});
      return;
    }
    return ctx.replyPrivately(t.cancelledN(n));
  });

  bot.command('timezone', (ctx) => {
    const zone = (ctx.command?.options.zone ?? ctx.text.replace(/^\/\S+\s*/, '')).trim();
    const s = store.settings(ctx.senderId);
    const t = TEXT[langOf(ctx.senderId)];
    if (!isTimeZone(zone)) return ctx.replyPrivately(t.tzBad);
    store.saveSettings({ ...s, tz: zone });
    return ctx.replyPrivately(t.tzSet(zone));
  });

  bot.command('quiet', (ctx) => {
    const o = ctx.command?.options ?? {};
    const [a, b] = o.from ? [o.from, o.to] : ctx.text.replace(/^\/\S+\s*/, '').split(/[\s–-]+/);
    const s = store.settings(ctx.senderId);
    const t = TEXT[langOf(ctx.senderId)];
    if (/^(?:off|nao|não|desligar)$/i.test(a ?? '')) {
      store.saveSettings({ ...s, quiet: null });
      return ctx.replyPrivately(t.quietOff);
    }
    const from = parseClock(a ?? '');
    const to = parseClock(b ?? '');
    if (from == null || to == null || from === to) return ctx.replyPrivately(t.quietBad);
    store.saveSettings({ ...s, quiet: { from, to } });
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return ctx.replyPrivately(t.quietSet(hm(from), hm(to)));
  });

  bot.onAutocomplete('remind', 'when', ({ value, ctx }) => previewWhen(value, ctx));
  bot.onAutocomplete('schedule', 'when', ({ value, ctx }) => previewWhen(value, ctx));
  bot.onAutocomplete('timezone', 'zone', ({ value }) => {
    const v = value.toLowerCase().replace(/\s+/g, '_');
    return ZONES.filter((z) => z.toLowerCase().includes(v))
      .slice(0, 25)
      .map((z) => ({ name: z, value: z }));
  });

  function previewWhen(value: string, ctx: Context) {
    const tz = tzOf(ctx.senderId);
    const w = parseWhen(value, { tz, now: new Date(now()) });
    if (!w) return [];
    const label = `${formatAt(w.at, tz, w.lang)}${w.rule ? ` · ${describeRule(w.rule, w.lang)}` : ''}`;
    return [{ name: label.slice(0, 100), value }];
  }

  bot.on('bot.removed', (e) => {
    if (e.chat_id) store.removeChat(e.chat_id);
  });
  bot.on('user.data_deletion', (e) => {
    const { user_id } = e.data as { user_id?: string };
    if (user_id) store.forget(user_id);
  });

  /** Deliver what is due. Safe to call often; runs one at a time. */
  let running = false;
  async function tick(): Promise<number> {
    if (running) return 0;
    running = true;
    let sent = 0;
    try {
      for (const job of store.due(now())) {
        const recipient = job.target.kind === 'here' ? null : store.settings(job.target.userId);
        const s = step(job, now(), recipient?.quiet ?? null, recipient?.tz ?? job.tz);
        if (s.act === 'postpone') {
          store.reschedule(job.id, s.until, true);
          continue;
        }
        if (s.act === 'skip') {
          store.reschedule(job.id, s.nextAt, false);
          continue;
        }
        try {
          await bot.send(job.chatId, render(job, s.late), {
            isGroup: job.isGroup,
            to: job.target.kind === 'here' ? job.creatorId : job.target.userId,
          });
          sent++;
        } catch (err) {
          // The chat is gone or the bot was removed: drop it rather than retry forever.
          const status = (err as { status?: number }).status;
          if (status === 403 || status === 404) store.remove(job.id);
          else console.error(`[reminders] ${job.id}:`, err);
          continue;
        }
        if ('remove' in s.then) store.remove(job.id);
        else store.reschedule(job.id, s.then.nextAt, false);
      }
    } finally {
      running = false;
    }
    return sent;
  }

  function render(job: Job, late: boolean): Reply {
    const t = TEXT[job.lang];
    const lateNote = late ? ` ${t.late(formatAt(new Date(job.nextAt), job.tz, job.lang))}` : '';
    if (job.kind === 'message') return job.text + lateNote;
    const who = job.target.kind === 'here' ? '' : `@${job.target.username} `;
    return `⏰ ${who}${job.text}${lateNote}`;
  }

  return { tick };
}
