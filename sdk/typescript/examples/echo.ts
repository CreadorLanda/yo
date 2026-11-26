/**
 * Echo bot: repeats what people send it, and shows a button.
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com bun examples/echo.ts
 */
import { Bot } from '../src/index';

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL! });

await bot.setCommands([{ name: 'echo', description: 'Repeat what I say', description_pt: 'Repetir o que digo', options: [
  { name: 'text', description: 'What to repeat', description_pt: 'O que repetir', type: 'string', required: true },
] }, { name: 'ping', description: 'Check the bot is alive', description_pt: 'Ver se o bot está vivo', options: [] }]);

bot.command('ping', (ctx) => ctx.reply('pong 🏓'));
bot.command('echo', (ctx) => ctx.reply(ctx.command?.options.text ?? ''));

bot.onMessage((ctx) =>
  ctx.reply({
    text: `You said: ${ctx.text}`,
    components: [[{ type: 'button', id: 'again', label: 'Say it again', style: 'primary' }]],
  }),
);

bot.onInteraction('again', (ctx) => ctx.reply('Again! 🔁'));

await bot.start();
