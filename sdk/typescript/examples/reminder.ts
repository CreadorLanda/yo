/**
 * Reminder bot: `/remind when:… what:…` and it tells you at that time.
 * `when` is a date from the app's picker, or typed as `10m`, `2h`, `1d`.
 * Reminders are kept in the bot's store, so a restart does not lose them.
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com bun examples/reminder.ts
 */
import { Bot } from '../src/index';

type Reminder = { id: string; at: number; chatId: string; userId: string; isGroup: boolean; what: string };

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL! });
const KEY = 'reminders';
const load = async () => ((await bot.store.get(KEY)) as Reminder[] | undefined) ?? [];
const save = (all: Reminder[]) => bot.store.set(KEY, all);

/** `10m`, `2h`, `1d`, or anything Date understands. */
function parseWhen(input: string, now = Date.now()): number | null {
  const rel = /^(\d+)\s*(m|min|h|d)$/i.exec(input.trim());
  if (rel) return now + Number(rel[1]) * { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase() as 'm']!;
  const at = Date.parse(input);
  return Number.isNaN(at) ? null : at;
}

await bot.setCommands([
  {
    name: 'remind',
    description: 'Remind me of something later',
    description_pt: 'Lembrar-me de algo mais tarde',
    options: [
      { name: 'when', description: 'When (or 10m, 2h, 1d)', description_pt: 'Quando (ou 10m, 2h, 1d)', type: 'datetime', required: true },
      { name: 'what', description: 'What to remind you of', description_pt: 'Do que te lembrar', type: 'string', required: true },
    ],
  },
  { name: 'reminders', description: 'List my reminders', description_pt: 'Ver os meus lembretes', options: [] },
]);

bot.command('remind', async (ctx) => {
  const at = parseWhen(ctx.command?.options.when ?? '');
  const what = ctx.command?.options.what?.trim();
  if (!at || !what) return ctx.replyPrivately('Try `/remind when:10m what:"call mum"`.');
  if (at <= Date.now()) return ctx.replyPrivately('That time has already passed.');
  const all = await load();
  if (all.filter((r) => r.userId === ctx.senderId).length >= 50) return ctx.replyPrivately('You have 50 reminders already.');
  const r = { id: crypto.randomUUID(), at, chatId: ctx.chatId, userId: ctx.senderId, isGroup: ctx.isGroup, what };
  await save([...all, r]);
  return ctx.reply({
    text: `⏰ I'll remind you: ${what}`,
    card: { fields: [{ name: 'When', value: new Date(at).toUTCString() }], color: 'info' },
    components: [[{ type: 'button', id: `cancel:${r.id}`, label: 'Cancel', style: 'secondary' }]],
  });
});

bot.command('reminders', async (ctx) => {
  const mine = (await load()).filter((r) => r.userId === ctx.senderId).sort((a, b) => a.at - b.at);
  return ctx.replyPrivately(mine.length ? mine.map((r) => `• ${new Date(r.at).toUTCString()} — ${r.what}`).join('\n') : 'No reminders.');
});

bot.onInteraction('*', async (ctx) => {
  if (!ctx.componentId?.startsWith('cancel:')) return;
  const id = ctx.componentId.slice('cancel:'.length);
  const all = await load();
  const r = all.find((x) => x.id === id);
  if (!r || r.userId !== ctx.senderId) return ctx.replyPrivately('Only whoever set it can cancel it.');
  await save(all.filter((x) => x.id !== id));
  if (ctx.messageId) await ctx.edit(ctx.messageId, `~~${r.what}~~ — cancelled`);
});

// Deliver what is due, every 15 s.
setInterval(async () => {
  const all = await load();
  const due = all.filter((r) => r.at <= Date.now());
  if (!due.length) return;
  await save(all.filter((r) => r.at > Date.now()));
  for (const r of due) {
    await bot.send(r.chatId, `⏰ Reminder: ${r.what}`, { isGroup: r.isGroup, to: r.userId }).catch((err) => console.error(err));
  }
}, 15_000);

await bot.start();
