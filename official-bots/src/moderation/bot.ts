import type { Bot, ChatMember, CommandDefinition, CommandOption, Component, Context, Reply } from '@zwosocial/bot';

import { check, escalate, formatDuration, missingGrants, parseDuration, remember, type Recent, type Rule, type Settings } from './policy';
import type { ModerationStore } from './store';

type Lang = 'en' | 'pt';

const TEXT = {
  en: {
    statusTitle: 'Moderation',
    on: 'on',
    off: 'off',
    welcome: 'Welcome',
    accept: 'Accept rules',
    links: 'Links',
    spam: 'Repeated messages',
    flood: 'Flood',
    slowmode: 'Slow mode',
    words: 'Banned words',
    log: 'Mod log',
    none: 'none',
    lang: 'Language',
    needReadAll: '⚠️ Content filters need "Let it read every message" (Group info → Bots). Until then they do nothing.',
    needManage: '⚠️ Deleting, muting and removing need "Let it moderate members" (Group info → Bots).',
    privacy: 'In privacy mode only welcomes and admin commands work: content filters never run there.',
    adminsOnly: 'Only group admins and moderators can do that.',
    whoMissing: 'Say who, like who:@name.',
    notFound: 'I do not see that person in this group.',
    cannotAdmin: 'Admins and moderators cannot be moderated.',
    needManageShort: 'I need "Let it moderate members" for that (Group info → Bots).',
    badDuration: 'Give a duration from 1 minute to 30 days, like 10m, 2h or 1d.',
    welcomeText: (who: string) => `Welcome, ${who}! 👋`,
    welcomeRules: 'Please read the rules:',
    acceptButton: 'I accept the rules',
    accepted: (who: string) => `${who} accepted the rules ✅`,
    acceptNotYou: 'This welcome is for someone else.',
    rulesNone: 'No rules set yet. Admins: /rules text:"…"',
    rulesSet: 'Rules saved.',
    warned: (who: string, n: number, reason: string) => `⚠️ ${who} warned (${n} in 24 h): ${reason}`,
    muted: (who: string, d: string) => `🔇 ${who} muted for ${d}.`,
    unmuted: (who: string) => `🔊 ${who} can write again.`,
    kicked: (who: string) => `👋 ${who} removed.`,
    banned: (who: string) => `⛔ ${who} banned.`,
    unbanned: (who: string) => `${who} can be added again.`,
    removedFor: (r: string) => `Your message was removed: ${r}.`,
    why: { link: 'links are not allowed here', word: 'it has a banned word', flood: 'too many messages too fast', spam: 'the same message repeated', slowmode: 'slow mode is on' } as Record<Rule, string>,
    wordsList: (w: string) => `Banned words: ${w}`,
    wordsSaved: 'Saved.',
    slowSet: (s: number) => (s ? `Slow mode: one message every ${s} s.` : 'Slow mode off.'),
    logCode: (c: string) => `To send this group's mod log somewhere, run /modlog code:${c} in that chat within 15 minutes (you must be an admin there too).`,
    logLinked: (t: string) => `This chat now gets the mod log of ${t}.`,
    logBad: 'That code is unknown or expired.',
    hello: 'Hi! I keep this group usable. Admins: /mod to set me up.',
    logLine: (g: string, s: string) => `🛡️ ${g}: ${s}`,
  },
  pt: {
    statusTitle: 'Moderação',
    on: 'ligado',
    off: 'desligado',
    welcome: 'Boas-vindas',
    accept: 'Aceitar regras',
    links: 'Links',
    spam: 'Mensagens repetidas',
    flood: 'Flood',
    slowmode: 'Modo lento',
    words: 'Palavras proibidas',
    log: 'Registo de moderação',
    none: 'nenhuma',
    lang: 'Idioma',
    needReadAll: '⚠️ Os filtros de conteúdo precisam de "Deixar ler todas as mensagens" (Informação do grupo → Bots). Até lá não fazem nada.',
    needManage: '⚠️ Apagar, silenciar e remover precisam de "Deixar moderar membros" (Informação do grupo → Bots).',
    privacy: 'Em modo privado só funcionam as boas-vindas e os comandos dos admins: os filtros de conteúdo nunca correm.',
    adminsOnly: 'Só os admins e moderadores do grupo podem fazer isso.',
    whoMissing: 'Diz quem, como who:@nome.',
    notFound: 'Não vejo essa pessoa neste grupo.',
    cannotAdmin: 'Admins e moderadores não podem ser moderados.',
    needManageShort: 'Para isso preciso de "Deixar moderar membros" (Informação do grupo → Bots).',
    badDuration: 'Indica uma duração de 1 minuto a 30 dias, como 10m, 2h ou 1d.',
    welcomeText: (who: string) => `Bem-vindo(a), ${who}! 👋`,
    welcomeRules: 'Lê as regras, por favor:',
    acceptButton: 'Aceito as regras',
    accepted: (who: string) => `${who} aceitou as regras ✅`,
    acceptNotYou: 'Estas boas-vindas são para outra pessoa.',
    rulesNone: 'Ainda não há regras. Admins: /rules text:"…"',
    rulesSet: 'Regras guardadas.',
    warned: (who: string, n: number, reason: string) => `⚠️ ${who} avisado(a) (${n} em 24 h): ${reason}`,
    muted: (who: string, d: string) => `🔇 ${who} silenciado(a) por ${d}.`,
    unmuted: (who: string) => `🔊 ${who} pode voltar a escrever.`,
    kicked: (who: string) => `👋 ${who} removido(a).`,
    banned: (who: string) => `⛔ ${who} banido(a).`,
    unbanned: (who: string) => `${who} pode voltar a ser adicionado(a).`,
    removedFor: (r: string) => `A tua mensagem foi removida: ${r}.`,
    why: { link: 'não são permitidos links aqui', word: 'tem uma palavra proibida', flood: 'demasiadas mensagens seguidas', spam: 'a mesma mensagem repetida', slowmode: 'o modo lento está ligado' } as Record<Rule, string>,
    wordsList: (w: string) => `Palavras proibidas: ${w}`,
    wordsSaved: 'Guardado.',
    slowSet: (s: number) => (s ? `Modo lento: uma mensagem a cada ${s} s.` : 'Modo lento desligado.'),
    logCode: (c: string) => `Para enviar o registo de moderação deste grupo para outra conversa, usa /modlog code:${c} nessa conversa nos próximos 15 minutos (tens de ser admin lá também).`,
    logLinked: (t: string) => `Esta conversa passa a receber o registo de moderação de ${t}.`,
    logBad: 'Esse código não existe ou expirou.',
    hello: 'Olá! Ajudo a manter este grupo em ordem. Admins: /mod para me configurar.',
    logLine: (g: string, s: string) => `🛡️ ${g}: ${s}`,
  },
} as const;

const who = (_for: string): CommandOption => ({ name: 'who', description: 'Who', description_pt: 'Quem', type: 'user', required: true });
const reason: CommandOption = { name: 'reason', description: 'Why (shown in the mod log)', description_pt: 'Porquê (aparece no registo)', type: 'string' };

export const COMMANDS: CommandDefinition[] = [
  { name: 'mod', description: 'Moderation settings (admins)', description_pt: 'Definições de moderação (admins)', options: [] },
  { name: 'rules', description: 'Show the rules, or set them (admins)', description_pt: 'Ver as regras, ou defini-las (admins)', options: [{ name: 'text', description: 'New rules', description_pt: 'Novas regras', type: 'string' }] },
  { name: 'warn', description: 'Warn a member (admins)', description_pt: 'Avisar um membro (admins)', options: [who('warn'), reason] },
  {
    name: 'mute',
    description: 'Mute a member (admins)',
    description_pt: 'Silenciar um membro (admins)',
    options: [who('mute'), { name: 'for', description: '10m, 2h, 1d', description_pt: '10m, 2h, 1d', type: 'string', required: true }, reason],
  },
  { name: 'unmute', description: 'Let a member write again (admins)', description_pt: 'Deixar um membro voltar a escrever (admins)', options: [who('unmute')] },
  { name: 'kick', description: 'Remove a member (admins)', description_pt: 'Remover um membro (admins)', options: [who('kick'), reason] },
  { name: 'ban', description: 'Remove a member and keep them out (admins)', description_pt: 'Remover um membro e não o deixar voltar (admins)', options: [who('ban'), reason] },
  { name: 'unban', description: 'Lift a ban (admins)', description_pt: 'Levantar um ban (admins)', options: [{ name: 'username', description: '@name', description_pt: '@nome', type: 'string', required: true }] },
  {
    name: 'words',
    description: 'Banned words (admins)',
    description_pt: 'Palavras proibidas (admins)',
    options: [
      { name: 'action', description: 'add, remove or list', description_pt: 'adicionar, remover ou ver', type: 'choice', required: true, choices: [{ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }] },
      { name: 'word', description: 'The word', description_pt: 'A palavra', type: 'string' },
    ],
  },
  { name: 'slowmode', description: 'Seconds between messages; 0 turns it off (admins)', description_pt: 'Segundos entre mensagens; 0 desliga (admins)', options: [{ name: 'seconds', description: '0–3600', description_pt: '0–3600', type: 'number', required: true }] },
  { name: 'modlog', description: 'Send this group’s mod log to another chat (admins)', description_pt: 'Enviar o registo de moderação para outra conversa (admins)', options: [{ name: 'code', description: 'The code from the group', description_pt: 'O código do grupo', type: 'string' }] },
];

export type ModerationOptions = { now?: () => number };

export function moderation(bot: Bot, store: ModerationStore, opts: ModerationOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const members = new Map<string, { at: number; list: ChatMember[] }>();
  const recent = new Map<string, Recent>();
  const scopesCache = new Map<string, { at: number; scopes: string[]; title: string }>();

  async function memberList(chatId: string, fresh = false): Promise<ChatMember[]> {
    const hit = members.get(chatId);
    if (!fresh && hit && now() - hit.at < 60_000) return hit.list;
    const list = await bot.api.members(chatId).catch(() => hit?.list ?? ([] as ChatMember[]));
    members.set(chatId, { at: now(), list });
    return list;
  }

  async function chatInfo(chatId: string) {
    const hit = scopesCache.get(chatId);
    if (hit && now() - hit.at < 60_000) return hit;
    const info = await bot.api.chat(chatId);
    const v = { at: now(), scopes: info.scopes ?? [], title: info.title ?? '' };
    scopesCache.set(chatId, v);
    return v;
  }

  const settingsFor = async (chatId: string): Promise<Settings> => {
    const s = store.settings(chatId);
    if (!s.title) {
      const info = await chatInfo(chatId).catch(() => null);
      if (info?.title) s.title = info.title;
    }
    return s;
  };

  const isStaff = (m: ChatMember | undefined) => !!m && (m.role === 'admin' || m.role === 'moderator');
  const mention = (m: { username: string }) => `@${m.username}`;

  async function staffOnly(ctx: Context, t: (typeof TEXT)[Lang]): Promise<boolean> {
    const me = (await memberList(ctx.chatId, true)).find((m) => m.user_id === ctx.senderId);
    if (ctx.isGroup && isStaff(me)) return true;
    await ctx.replyPrivately(t.adminsOnly);
    return false;
  }

  async function target(ctx: Context, t: (typeof TEXT)[Lang]): Promise<ChatMember | null> {
    const raw = (ctx.command?.options.who ?? '').replace(/^@/, '').toLowerCase();
    if (!raw) {
      await ctx.replyPrivately(t.whoMissing);
      return null;
    }
    const m = (await memberList(ctx.chatId, true)).find((x) => x.username.toLowerCase() === raw || x.user_id === raw);
    if (!m) await ctx.replyPrivately(t.notFound);
    else if (isStaff(m) || m.is_bot) {
      await ctx.replyPrivately(t.cannotAdmin);
      return null;
    }
    return m ?? null;
  }

  async function log(s: Settings, line: string) {
    if (!s.logChat) return;
    const t = TEXT[s.lang];
    await bot.send(s.logChat, t.logLine(s.title || s.chatId.slice(0, 8), line), { isGroup: s.logIsGroup }).catch(() => {});
  }

  /** Runs a moderation call; explains a refusal instead of failing silently. */
  async function act(ctx: Context | null, s: Settings, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      const t = TEXT[s.lang];
      const status = (err as { status?: number; code?: string }).status;
      const code = (err as { code?: string }).code;
      if (ctx) await ctx.replyPrivately(code === 'cannot_moderate_admin' ? t.cannotAdmin : status === 403 ? t.needManageShort : String(err)).catch(() => {});
      return false;
    }
  }

  // ── Status and settings ──

  function statusCard(s: Settings, scopes: string[]): Reply {
    const t = TEXT[s.lang];
    const onOff = (v: boolean) => (v ? t.on : t.off);
    const missing = missingGrants(s, scopes);
    const notes = [
      ...(missing.readAll ? [t.needReadAll] : []),
      ...(missing.manage ? [t.needManage] : []),
      ...(!scopes.includes('messages.read.all') ? [t.privacy] : []),
    ];
    const toggle = (id: string, label: string, v: boolean): Component => ({ type: 'button', id: `toggle:${id}`, label: `${label}: ${onOff(v)}`, style: v ? 'primary' : 'secondary' });
    return {
      text: `${t.statusTitle}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
      card: {
        title: t.statusTitle,
        fields: [
          { name: t.slowmode, value: s.slowmode ? `${s.slowmode} s` : t.off, inline: true },
          { name: t.flood, value: s.floodN ? `${s.floodN} / ${s.floodS} s` : t.off, inline: true },
          { name: t.words, value: s.words.length ? String(s.words.length) : t.none, inline: true },
          { name: t.log, value: s.logChat ? t.on : t.off, inline: true },
        ],
        color: notes.length > 1 ? 'warning' : 'info',
      },
      components: [
        [toggle('welcome', t.welcome, s.welcome), toggle('requireAccept', t.accept, s.requireAccept)],
        [toggle('links', t.links, s.links), toggle('spam', t.spam, s.spam), toggle('flood', t.flood, s.floodN > 0)],
        [{ type: 'button', id: 'toggle:lang', label: `${t.lang}: ${s.lang.toUpperCase()}`, style: 'secondary' }],
      ],
    };
  }

  bot.command('mod', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    if (!(await staffOnly(ctx, TEXT[s.lang]))) return;
    store.save(s);
    const { scopes } = await chatInfo(ctx.chatId);
    return ctx.replyPrivately(statusCard(s, scopes));
  });

  bot.command('rules', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    const text = ctx.command?.options.text?.trim();
    if (!text) return ctx.reply(s.rules ? { text: s.rules, card: { title: `📜 ${s.title}`, description: s.rules } } : t.rulesNone);
    if (!(await staffOnly(ctx, t))) return;
    store.save({ ...s, rules: text.slice(0, 2000) });
    return ctx.replyPrivately(t.rulesSet);
  });

  bot.command('words', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const action = ctx.command?.options.action ?? 'list';
    const word = (ctx.command?.options.word ?? '').trim().toLowerCase();
    if (action === 'add' && word && !s.words.includes(word)) s.words = [...s.words, word].slice(0, 200);
    if (action === 'remove') s.words = s.words.filter((w) => w !== word);
    store.save(s);
    return ctx.replyPrivately(action === 'list' ? t.wordsList(s.words.join(', ') || t.none) : t.wordsSaved);
  });

  bot.command('slowmode', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const seconds = Math.max(0, Math.min(3600, Math.round(Number(ctx.command?.options.seconds ?? 0)) || 0));
    store.save({ ...s, slowmode: seconds });
    return ctx.reply(t.slowSet(seconds));
  });

  bot.command('modlog', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    const code = ctx.command?.options.code?.trim();
    if (!code) {
      if (!(await staffOnly(ctx, t))) return;
      store.save(s);
      return ctx.replyPrivately(t.logCode(store.newLinkCode(ctx.chatId, now())));
    }
    const groupId = store.useLinkCode(code, now());
    if (!groupId) return ctx.replyPrivately(t.logBad);
    // The person must run the group's moderation and be an admin here.
    const there = (await memberList(groupId, true)).find((m) => m.user_id === ctx.senderId);
    const here = ctx.isGroup ? (await memberList(ctx.chatId, true)).find((m) => m.user_id === ctx.senderId) : { role: 'admin' };
    if (!isStaff(there) || (ctx.isGroup && !isStaff(here as ChatMember))) return ctx.replyPrivately(t.adminsOnly);
    const g = await settingsFor(groupId);
    store.save({ ...g, logChat: ctx.chatId, logIsGroup: ctx.isGroup });
    return ctx.reply(t.logLinked(g.title || groupId.slice(0, 8)));
  });

  // ── Admin actions ──

  async function warnMember(ctx: Context | null, s: Settings, m: ChatMember, why: string, by: string) {
    const t = TEXT[s.lang];
    const n = store.warn(s.chatId, m.user_id, why, now());
    const step = escalate(n);
    await log(s, `${t.warned(mention(m), n, why)} — ${by}`);
    if (step.act === 'warn') {
      if (ctx) await ctx.reply(t.warned(mention(m), n, why));
      return;
    }
    if (step.act === 'mute') {
      if (await act(ctx, s, () => bot.api.mute(s.chatId, m.user_id, step.seconds, why))) await log(s, t.muted(mention(m), formatDuration(step.seconds, s.lang)));
      return;
    }
    if (await act(ctx, s, () => bot.api.kick(s.chatId, m.user_id, why))) await log(s, t.kicked(mention(m)));
  }

  bot.command('warn', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const m = await target(ctx, t);
    if (m) await warnMember(ctx, s, m, ctx.command?.options.reason ?? '—', byName(ctx));
  });

  const byName = (ctx: Context) => {
    const m = members.get(ctx.chatId)?.list.find((x) => x.user_id === ctx.senderId);
    return m ? `@${m.username}` : ctx.senderId.slice(0, 8);
  };

  bot.command('mute', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const m = await target(ctx, t);
    if (!m) return;
    const seconds = parseDuration(ctx.command?.options.for ?? '');
    if (!seconds) return ctx.replyPrivately(t.badDuration);
    const why = ctx.command?.options.reason ?? '';
    if (await act(ctx, s, () => bot.api.mute(ctx.chatId, m.user_id, seconds, why))) {
      await log(s, `${t.muted(mention(m), formatDuration(seconds, s.lang))} ${why} — ${byName(ctx)}`);
    }
  });

  bot.command('unmute', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const m = await target(ctx, t);
    if (m && (await act(ctx, s, () => bot.api.unmute(ctx.chatId, m.user_id)))) await log(s, `${t.unmuted(mention(m))} — ${byName(ctx)}`);
  });

  bot.command('kick', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const m = await target(ctx, t);
    const why = ctx.command?.options.reason ?? '';
    if (m && (await act(ctx, s, () => bot.api.kick(ctx.chatId, m.user_id, why)))) await log(s, `${t.kicked(mention(m))} ${why} — ${byName(ctx)}`);
  });

  bot.command('ban', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const m = await target(ctx, t);
    const why = ctx.command?.options.reason ?? '';
    if (m && (await act(ctx, s, () => bot.api.ban(ctx.chatId, m.user_id, why)))) {
      store.recordBan(ctx.chatId, m.user_id, m.username);
      await log(s, `${t.banned(mention(m))} ${why} — ${byName(ctx)}`);
    }
  });

  bot.command('unban', async (ctx) => {
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (!(await staffOnly(ctx, t))) return;
    const name = (ctx.command?.options.username ?? '').replace(/^@/, '');
    const id = store.bannedByName(ctx.chatId, name);
    if (!id) return ctx.replyPrivately(t.notFound);
    if (await act(ctx, s, () => bot.api.unban(ctx.chatId, id))) {
      store.dropBan(ctx.chatId, id);
      await ctx.reply(t.unbanned(`@${name}`));
      await log(s, `${t.unbanned(`@${name}`)} — ${byName(ctx)}`);
    }
  });

  // ── Buttons ──

  bot.onInteraction('*', async (ctx) => {
    const id = ctx.componentId ?? '';
    const s = await settingsFor(ctx.chatId);
    const t = TEXT[s.lang];
    if (id.startsWith('accept:')) {
      const userId = id.slice('accept:'.length);
      if (userId !== ctx.senderId) return ctx.replyPrivately(t.acceptNotYou);
      const pending = store.takePending(ctx.chatId, userId);
      const me = (await memberList(ctx.chatId)).find((m) => m.user_id === userId);
      if (pending && s.requireAccept) await act(null, s, () => bot.api.unmute(ctx.chatId, userId));
      if (ctx.messageId) await ctx.edit(ctx.messageId, t.accepted(me ? mention(me) : '')).catch(() => {});
      return;
    }
    if (id.startsWith('toggle:')) {
      if (!(await staffOnly(ctx, t))) return;
      const key = id.slice('toggle:'.length);
      if (key === 'welcome') s.welcome = !s.welcome;
      if (key === 'requireAccept') s.requireAccept = !s.requireAccept;
      if (key === 'links') s.links = !s.links;
      if (key === 'spam') s.spam = !s.spam;
      if (key === 'flood') s.floodN = s.floodN ? 0 : 6;
      if (key === 'lang') s.lang = s.lang === 'en' ? 'pt' : 'en';
      store.save(s);
      const { scopes } = await chatInfo(ctx.chatId);
      return ctx.replyPrivately(statusCard(s, scopes));
    }
  });

  // ── Joins ──

  async function onMembersChanged(chatId: string) {
    const list = await memberList(chatId, true);
    const known = store.knownMembers(chatId);
    store.setMembers(chatId, list.map((m) => m.user_id));
    if (!known) return; // first look at this group: nothing to welcome
    const s = await settingsFor(chatId);
    const t = TEXT[s.lang];
    for (const m of list.filter((x) => !known.has(x.user_id) && !x.is_bot)) {
      if (!s.welcome && !s.requireAccept) continue;
      const reply: Reply = {
        text: t.welcomeText(mention(m)),
        ...(s.rules ? { card: { title: t.welcomeRules, description: s.rules } } : {}),
        ...(s.requireAccept || s.rules
          ? { components: [[{ type: 'button', id: `accept:${m.user_id}`, label: t.acceptButton, style: 'primary' } as Component]] }
          : {}),
      };
      const sent = await bot.send(chatId, reply, { isGroup: true }).catch(() => null);
      if (s.requireAccept) {
        store.addPending(chatId, m.user_id, sent?.id ?? null);
        await act(null, s, () => bot.api.mute(chatId, m.user_id, 7 * 86_400, 'rules not accepted yet'));
      }
    }
  }

  bot.on('members.changed', (e) => (e.chat_id ? onMembersChanged(e.chat_id) : undefined));
  bot.on('bot.installed', async (e) => {
    if (!e.chat_id) return;
    const s = await settingsFor(e.chat_id);
    store.save(s);
    store.setMembers(e.chat_id, (await memberList(e.chat_id, true)).map((m) => m.user_id));
    await bot.send(e.chat_id, TEXT[s.lang].hello, { isGroup: true }).catch(() => {});
  });
  bot.on('bot.removed', (e) => {
    if (e.chat_id) store.removeChat(e.chat_id);
  });
  bot.on('user.data_deletion', (e) => {
    const { user_id } = e.data as { user_id?: string };
    if (user_id) {
      store.forget(user_id);
      for (const key of [...recent.keys()]) if (key.endsWith(`:${user_id}`)) recent.delete(key);
    }
  });

  // ── Content filters (full read only) ──

  bot.onMessage(async (ctx) => {
    if (!ctx.isGroup || ctx.command) return;
    const list = await memberList(ctx.chatId);
    const sender = list.find((m) => m.user_id === ctx.senderId);
    if (!sender || isStaff(sender) || sender.is_bot) return;
    const s = await settingsFor(ctx.chatId);
    const key = `${ctx.chatId}:${ctx.senderId}`;
    const r = recent.get(key) ?? { at: [], hashes: [] };
    const v = check(ctx.text, s, r, now());
    remember(r, ctx.text, now());
    recent.set(key, r);
    if (!v) return;
    const t = TEXT[s.lang];
    const why = t.why[v.rule];
    if (ctx.messageId) await act(null, s, () => bot.api.deleteAsModerator(ctx.chatId, ctx.messageId!));
    await ctx.replyPrivately(t.removedFor(why)).catch(() => {});
    // Slow mode alone is not misbehaviour worth a warning.
    if (v.rule !== 'slowmode') await warnMember(null, s, sender, why, 'auto');
  });
}
