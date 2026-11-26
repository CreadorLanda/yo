/**
 * The official Moderation bot (#333).
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com DATA_DIR=/var/lib/zwosocial/moderation \
 *     bun src/moderation/main.ts
 */
import { join } from 'node:path';

import { Bot, FileStore } from '@zwosocial/bot';

import { COMMANDS, moderation } from './bot';
import { ModerationStore } from './store';

const dataDir = process.env.DATA_DIR ?? './data';
const bot = new Bot({
  token: process.env.BOT_TOKEN!,
  apiUrl: process.env.API_URL ?? 'https://yo.alexandrelanda.com',
  store: new FileStore(join(dataDir, 'moderation-bot.json')),
});
moderation(bot, new ModerationStore(join(dataDir, 'moderation.db')));

await bot.init();
await bot.setCommands(COMMANDS);
process.on('SIGTERM', () => bot.stop());
await bot.start();
