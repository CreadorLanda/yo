/**
 * The official Tasks and Standup bot (#334).
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com DATA_DIR=/var/lib/zwosocial/tasks \
 *     bun src/tasks/main.ts
 */
import { join } from 'node:path';

import { Bot, FileStore } from '@zwosocial/bot';

import type { Lang } from '../lib/time';
import { COMMANDS, tasks } from './bot';
import { TaskStore } from './store';

const dataDir = process.env.DATA_DIR ?? './data';
const bot = new Bot({
  token: process.env.BOT_TOKEN!,
  apiUrl: process.env.API_URL ?? 'https://yo.alexandrelanda.com',
  store: new FileStore(join(dataDir, 'tasks-bot.json')),
});
const { tick } = tasks(bot, new TaskStore(join(dataDir, 'tasks.db')), {
  defaultTz: process.env.DEFAULT_TZ ?? 'UTC',
  defaultLang: (process.env.DEFAULT_LANG as Lang) ?? 'en',
});

await bot.init();
await bot.setCommands(COMMANDS);
await tick();
const timer = setInterval(() => void tick().catch((err) => console.error('[tasks] tick', err)), 30_000);
process.on('SIGTERM', () => {
  clearInterval(timer);
  bot.stop();
});
await bot.start();
