/**
 * The official Reminders and Scheduler bot (#332).
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com DATA_DIR=/var/lib/zwosocial/reminders \
 *     bun src/reminders/main.ts
 *
 * DATA_DIR holds the bot's keys (reminders-bot.json) and its jobs
 * (reminders.db): put it on a persistent volume.
 */
import { join } from 'node:path';

import { Bot, FileStore } from '@zwosocial/bot';

import type { Lang } from '../lib/time';
import { COMMANDS, reminders } from './bot';
import { ReminderStore } from './store';

const dataDir = process.env.DATA_DIR ?? './data';
const bot = new Bot({
  token: process.env.BOT_TOKEN!,
  apiUrl: process.env.API_URL ?? 'https://yo.alexandrelanda.com',
  store: new FileStore(join(dataDir, 'reminders-bot.json')),
});
const store = new ReminderStore(join(dataDir, 'reminders.db'));
const { tick } = reminders(bot, store, {
  defaultTz: process.env.DEFAULT_TZ ?? 'UTC',
  defaultLang: (process.env.DEFAULT_LANG as Lang) ?? 'en',
});

await bot.init();
await bot.setCommands(COMMANDS);
// Catch up on anything that came due while the bot was down, then every 15 s.
await tick();
const timer = setInterval(() => void tick().catch((err) => console.error('[reminders] tick', err)), 15_000);
process.on('SIGTERM', () => {
  clearInterval(timer);
  bot.stop();
});
await bot.start();
