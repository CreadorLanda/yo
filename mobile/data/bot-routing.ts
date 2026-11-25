import type { BotScope, BotUpdateKind } from '@/data/api/bots';

/**
 * Which bots get a copy of a message (#322, ADR 0002).
 *
 * In privacy mode a bot cannot open the group's messages: it holds no sender
 * key. What is addressed to it — a slash command, a mention, a reply to one
 * of its messages — is sent to it separately, encrypted for it alone. This
 * decides who that is. It is pure so the rule can be tested on its own.
 */

export type RoutableBot = {
  id: string;
  username: string;
  scopes: BotScope[];
};

export type BotRoute = { botId: string; username: string; kind: BotUpdateKind };

const COMMAND = /^\/([a-z0-9_]{1,32})(?:@([a-z0-9_]{4,32}))?(?:\s|$)/i;

function mentions(text: string, username: string): boolean {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_@])@${escaped}(?![a-z0-9_])`, 'i').test(text);
}

/**
 * A bot with full read already reads the group message, so it is never sent
 * a second copy; a bot without messages.read.commands asked for nothing.
 */
function wantsAddressed(bot: RoutableBot): boolean {
  return !bot.scopes.includes('messages.read.all') && bot.scopes.includes('messages.read.commands');
}

export function routeToBots(input: {
  text: string;
  bots: RoutableBot[];
  /** Sender of the message being replied to, when this is a reply. */
  replyToSenderId?: string | null;
  /** Bots that registered this command (#324); null when none did. */
  commandTargets?: string[] | null;
}): BotRoute[] {
  const text = input.text.trim();
  const candidates = input.bots.filter(wantsAddressed);
  if (candidates.length === 0 || !text) return [];

  const command = COMMAND.exec(text);
  if (command) {
    const target = command[2]?.toLowerCase();
    // `/cmd@somebot` is for that bot only. A bare `/cmd` goes to the bots
    // that registered it (#324), or, when none did, to every bot listening.
    const registered = input.commandTargets;
    const hit = target
      ? candidates.filter((b) => b.username.toLowerCase() === target)
      : registered
        ? candidates.filter((b) => registered.includes(b.id))
        : candidates;
    return hit.map((b) => ({ botId: b.id, username: b.username, kind: 'command' }));
  }

  const out: BotRoute[] = [];
  for (const bot of candidates) {
    if (mentions(text, bot.username)) {
      out.push({ botId: bot.id, username: bot.username, kind: 'mention' });
    } else if (input.replyToSenderId && input.replyToSenderId === bot.id) {
      out.push({ botId: bot.id, username: bot.username, kind: 'reply' });
    }
  }
  return out;
}

/** Bots that must not be handed this group's sender key. */
export function botsWithoutFullRead(bots: RoutableBot[]): Set<string> {
  return new Set(bots.filter((b) => !b.scopes.includes('messages.read.all')).map((b) => b.id));
}
