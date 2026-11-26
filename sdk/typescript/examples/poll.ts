/**
 * Poll bot: `/poll question:… options:"Pizza, Sushi, Tacos"` posts buttons;
 * each click counts (one vote per person, changeable) and updates the poll.
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com bun examples/poll.ts
 */
import { Bot, type Component, type Reply } from '../src/index';

type Poll = { question: string; options: string[]; votes: Record<string, number>; closed?: boolean; by: string };

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL! });
const key = (chatId: string, messageId: number) => `poll:${chatId}:${messageId}`;

function render(p: Poll): Reply {
  const counts = p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const bar = (n: number) => '█'.repeat(total ? Math.round((n / total) * 10) : 0).padEnd(10, '░');
  const buttons: Component[] = p.options.map((o, i) => ({ type: 'button', id: `vote:${i}`, label: o, style: 'secondary', disabled: p.closed }));
  return {
    text: `📊 ${p.question}`,
    card: {
      title: p.question,
      fields: p.options.map((o, i) => ({ name: o, value: `${bar(counts[i])} ${counts[i]}` })),
      footer: `${total} vote${total === 1 ? '' : 's'}${p.closed ? ' · closed' : ''}`,
      color: p.closed ? 'warning' : 'primary',
    },
    components: [buttons.slice(0, 5), ...(p.closed ? [] : [[{ type: 'button', id: 'close', label: 'Close poll', style: 'danger' } as Component]])],
  };
}

await bot.setCommands([
  {
    name: 'poll',
    description: 'Ask the chat a question',
    description_pt: 'Fazer uma pergunta à conversa',
    options: [
      { name: 'question', description: 'The question', description_pt: 'A pergunta', type: 'string', required: true },
      { name: 'options', description: 'Answers, comma-separated (2–5)', description_pt: 'Respostas, separadas por vírgulas (2–5)', type: 'string', required: true },
    ],
  },
]);

bot.command('poll', async (ctx) => {
  const question = ctx.command?.options.question?.trim() ?? '';
  const options = (ctx.command?.options.options ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (!question || options.length < 2) return ctx.replyPrivately('Try `/poll question:"Lunch?" options:"Pizza, Sushi"`.');
  const p: Poll = { question, options, votes: {}, by: ctx.senderId };
  const sent = await ctx.reply(render(p));
  await bot.store.set(key(ctx.chatId, sent.id), p);
});

bot.onInteraction('*', async (ctx) => {
  if (!ctx.messageId) return;
  const p = (await bot.store.get(key(ctx.chatId, ctx.messageId))) as Poll | undefined;
  if (!p || p.closed) return;
  if (ctx.componentId === 'close') {
    if (ctx.senderId !== p.by) return ctx.replyPrivately('Only whoever asked can close it.');
    p.closed = true;
  } else if (ctx.componentId?.startsWith('vote:')) {
    p.votes[ctx.senderId] = Number(ctx.componentId.slice(5));
  } else return;
  await bot.store.set(key(ctx.chatId, ctx.messageId), p);
  await ctx.edit(ctx.messageId, render(p));
});

await bot.start();
