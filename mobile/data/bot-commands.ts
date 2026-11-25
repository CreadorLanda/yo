/**
 * Slash commands in the composer (#324), pure so the rules are testable.
 *
 * An invocation is ordinary text, so the group sees what was asked and a bot
 * without the registry still understands it:
 *
 *   /remind@reminder_bot when:2026-11-26T09:00:00.000Z what:"drink water"
 *
 * `@bot` is added only when two bots in the chat share the command name.
 */

export type CommandOptionType = 'string' | 'number' | 'user' | 'datetime' | 'choice';

export type CommandChoice = { name: string; value: string | number };

export type CommandOption = {
  name: string;
  description: string;
  description_pt?: string;
  type: CommandOptionType;
  required?: boolean;
  choices?: CommandChoice[];
  autocomplete?: boolean;
};

export type ChatCommand = {
  name: string;
  description: string;
  description_pt?: string;
  options: CommandOption[];
  bot: { id: string; username: string; display_name: string; avatar_url?: string };
};

/** What the person filled in, by option name. Users carry their username. */
export type CommandValues = Record<string, string | number | undefined>;

/** The command being typed: `/rem` → "rem"; null once there is a space or no slash. */
export function typedCommand(draft: string): string | null {
  const m = /^\/([a-z0-9_-]{0,32})$/i.exec(draft);
  return m ? m[1].toLowerCase() : null;
}

/** Commands matching what is typed, prefix matches first, then the rest that contain it. */
export function matchCommands(commands: ChatCommand[], typed: string): ChatCommand[] {
  const q = typed.toLowerCase();
  const starts = commands.filter((c) => c.name.startsWith(q));
  const contains = commands.filter((c) => !c.name.startsWith(q) && c.name.includes(q));
  return [...starts, ...contains];
}

/** Whether another bot in the chat registered the same name. */
export function isAmbiguous(commands: ChatCommand[], command: ChatCommand): boolean {
  return commands.some((c) => c.name === command.name && c.bot.id !== command.bot.id);
}

/** Required options still empty. */
export function missingOptions(command: ChatCommand, values: CommandValues): string[] {
  return command.options
    .filter((o) => o.required && (values[o.name] === undefined || String(values[o.name]).trim() === ''))
    .map((o) => o.name);
}

function quote(v: string): string {
  return /[\s"]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

/** The text to send. Options left empty are left out. */
export function buildInvocation(command: ChatCommand, values: CommandValues, withBot: boolean): string {
  const head = `/${command.name}${withBot ? `@${command.bot.username}` : ''}`;
  const parts = command.options
    .filter((o) => values[o.name] !== undefined && String(values[o.name]).trim() !== '')
    .map((o) => {
      const raw = String(values[o.name]).trim();
      return `${o.name}:${quote(o.type === 'user' ? `@${raw.replace(/^@/, '')}` : raw)}`;
    });
  return [head, ...parts].join(' ');
}

export type ParsedInvocation = { name: string; bot?: string; options: Record<string, string> };

/** Read an invocation back: name, optional @bot, and name:value pairs (quotes allowed). */
export function parseInvocation(text: string): ParsedInvocation | null {
  const head = /^\/([a-z0-9_-]{1,32})(?:@([a-z0-9_]{3,32}))?(?=\s|$)/i.exec(text.trim());
  if (!head) return null;
  const options: Record<string, string> = {};
  const rest = text.trim().slice(head[0].length);
  const re = /([a-z0-9_-]{1,32}):(?:"((?:[^"\\]|\\.)*)"|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    options[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  }
  return { name: head[1].toLowerCase(), ...(head[2] ? { bot: head[2].toLowerCase() } : {}), options };
}

/**
 * Who a `/command` goes to, given the registry: the named bot, or every bot
 * that registered the command. Null when nothing registered it, so the
 * caller falls back to every bot listening, as before #324.
 */
export function commandTargets(text: string, commands: ChatCommand[]): string[] | null {
  const inv = parseInvocation(text);
  if (!inv) return null;
  const withName = commands.filter((c) => c.name === inv.name);
  if (inv.bot) return withName.filter((c) => c.bot.username.toLowerCase() === inv.bot).map((c) => c.bot.id);
  return withName.length > 0 ? [...new Set(withName.map((c) => c.bot.id))] : null;
}

/** The description in the reader's language. */
export function describe(item: { description: string; description_pt?: string }, lang: string): string {
  return lang.startsWith('pt') && item.description_pt ? item.description_pt : item.description;
}

/** Quick picks for a date/time option, from `now`. */
export function datePresets(now: Date): { key: string; at: Date }[] {
  const inMin = (m: number) => new Date(now.getTime() + m * 60_000);
  const today = (h: number) => {
    const d = new Date(now.getTime());
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const tomorrow = (h: number) => {
    const d = today(h);
    d.setDate(d.getDate() + 1);
    return d;
  };
  const out = [
    { key: 'in_10_min', at: inMin(10) },
    { key: 'in_1_hour', at: inMin(60) },
  ];
  if (today(20) > now) out.push({ key: 'tonight', at: today(20) });
  out.push({ key: 'tomorrow_morning', at: tomorrow(9) });
  return out;
}

/** "HH:MM" on a given day, or null if the time does not parse. */
export function atTime(day: Date, hhmm: string): Date | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(day.getTime());
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}
