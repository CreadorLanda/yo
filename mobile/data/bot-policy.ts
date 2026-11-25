/**
 * The rules for making a bot in the app (#328), pure so they can be tested
 * without a device. They mirror the server's (`validBotUsername` in
 * server/internal/modules/bots/token.go), which stays the authority.
 */

import type { BotEventType } from '@/data/api/bots';

const USERNAME_SHAPE = /^[a-z0-9_]{3,32}$/;

/** A bot username: 3–32 of a-z, 0-9, _; ends in "bot"; never starts with _. */
export function isValidBotUsername(u: string): boolean {
  return USERNAME_SHAPE.test(u) && u.length > 3 && u.endsWith('bot') && !u.startsWith('_');
}

export function isValidBotName(name: string): boolean {
  const n = [...name.trim()].length;
  return n >= 2 && n <= 64;
}

export const MAX_BOT_DESCRIPTION = 512;

/**
 * A username suggested from the display name: "Lembretes da Ana" →
 * "lembretes_da_ana_bot". Accents are dropped, anything else becomes `_`,
 * and it is cut so the `_bot` ending always fits.
 */
export function suggestBotUsername(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_?bot$/, '');
  const stem = (base || 'my').slice(0, 32 - '_bot'.length).replace(/_+$/, '');
  return `${stem}_bot`;
}

/** What the person typed, made into a username they can still edit. */
export function normalizeBotUsername(input: string): string {
  return input.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

/** Event types an owner can pick for a webhook, in the order shown. */
export const WEBHOOK_EVENT_CHOICES: BotEventType[] = [
  'command.invoked',
  'interaction.created',
  'message.created',
  'message.updated',
  'message.deleted',
  'message.reaction',
  'members.changed',
  'bot.installed',
  'bot.removed',
];

/** A webhook URL the server will take: https to a host. Private hosts are the server's call. */
export function looksLikeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Seconds a copied secret stays on the clipboard. */
export const SECRET_CLIPBOARD_SECONDS = 60;

/** The gateway address for an API base URL: http → ws, https → wss. */
export function gatewayUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/bot/v1/gateway`;
}
