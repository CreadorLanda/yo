/**
 * What the Moderation bot decides, without any I/O, so it can be tested on
 * its own. Content filters only ever run on messages the bot was allowed to
 * read (full read): in privacy mode it never sees them.
 */

export type Settings = {
  chatId: string;
  title: string;
  lang: 'en' | 'pt';
  welcome: boolean;
  rules: string;
  /** New members are muted until they accept the rules. */
  requireAccept: boolean;
  links: boolean;
  spam: boolean;
  /** At most `floodN` messages in `floodS` seconds; 0 turns it off. */
  floodN: number;
  floodS: number;
  /** Seconds between one person's messages; 0 turns it off. */
  slowmode: number;
  words: string[];
  logChat: string | null;
  logIsGroup: boolean;
};

export const DEFAULTS: Omit<Settings, 'chatId' | 'title'> = {
  lang: 'en',
  welcome: true,
  rules: '',
  requireAccept: false,
  links: false,
  spam: true,
  floodN: 6,
  floodS: 10,
  slowmode: 0,
  words: [],
  logChat: null,
  logIsGroup: true,
};

export type Rule = 'link' | 'word' | 'flood' | 'spam' | 'slowmode';
export type Violation = { rule: Rule; word?: string };

/** One person's recent messages in one chat, kept in memory only. */
export type Recent = { at: number[]; hashes: { at: number; h: string }[] };

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|ly|me|app|xyz|info|co|gg|link|click)\b(?:\/\S*)?/i;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function hashText(text: string): string {
  return fold(text).replace(/\s+/g, ' ').trim();
}

/**
 * The first rule a message breaks, given what the same person sent lately.
 * Order matters: a flood is about the person, a banned word about the text.
 */
export function check(text: string, s: Settings, recent: Recent, now: number): Violation | null {
  if (s.slowmode > 0) {
    const last = recent.at.at(-1);
    if (last !== undefined && now - last < s.slowmode * 1000) return { rule: 'slowmode' };
  }
  if (s.floodN > 0 && s.floodS > 0) {
    const within = recent.at.filter((t) => now - t < s.floodS * 1000).length;
    if (within + 1 > s.floodN) return { rule: 'flood' };
  }
  if (s.words.length) {
    const folded = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
    const word = s.words.find((w) => folded.includes(` ${fold(w)} `));
    if (word) return { rule: 'word', word };
  }
  if (s.links && LINK.test(text)) return { rule: 'link' };
  if (s.spam) {
    const h = hashText(text);
    const repeats = recent.hashes.filter((x) => x.h === h && now - x.at < 60_000).length;
    if (h.length >= 3 && repeats >= 2) return { rule: 'spam' };
  }
  return null;
}

/** Records a message in the person's recent history (last 60 s, 30 entries). */
export function remember(recent: Recent, text: string, now: number): void {
  recent.at = [...recent.at.filter((t) => now - t < 60_000), now].slice(-30);
  recent.hashes = [...recent.hashes.filter((x) => now - x.at < 60_000), { at: now, h: hashText(text) }].slice(-30);
}

export type Step = { act: 'warn' } | { act: 'mute'; seconds: number } | { act: 'kick' };

/**
 * The escalation ladder, by warnings in the last 24 hours (this one
 * included): a warning, then a 10-minute mute, an hour's mute, and removal.
 */
export function escalate(warningsIn24h: number): Step {
  if (warningsIn24h <= 1) return { act: 'warn' };
  if (warningsIn24h === 2) return { act: 'mute', seconds: 600 };
  if (warningsIn24h === 3) return { act: 'mute', seconds: 3600 };
  return { act: 'kick' };
}

/** "10m", "2h", "1d", "30 min", "1 hora", "2 dias". Null when unreadable. */
export function parseDuration(input: string): number | null {
  const m = /^(\d+)\s*(s|sec|secs|seg|m|min|mins|minutos?|minutes?|h|hr|hrs|horas?|hours?|d|dias?|days?)$/.exec(fold(input.trim()));
  if (!m) return null;
  const n = +m[1];
  const unit = m[2][0];
  const seconds = n * (unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400);
  return seconds >= 60 && seconds <= 30 * 86_400 ? seconds : null;
}

export function formatDuration(seconds: number, lang: 'en' | 'pt'): string {
  const [n, u] =
    seconds % 86_400 === 0 ? [seconds / 86_400, lang === 'pt' ? 'd' : 'd'] : seconds % 3600 === 0 ? [seconds / 3600, 'h'] : [Math.round(seconds / 60), 'min'];
  return `${n} ${u}`;
}

/** What a group must grant for the settings to work, as plain lines. */
export function missingGrants(s: Settings, scopes: readonly string[]): { readAll: boolean; manage: boolean } {
  const filters = s.links || s.spam || s.floodN > 0 || s.slowmode > 0 || s.words.length > 0;
  return {
    readAll: filters && !scopes.includes('messages.read.all'),
    manage: (filters || s.requireAccept) && !scopes.includes('members.manage'),
  };
}
