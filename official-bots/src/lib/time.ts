/**
 * Time for the official bots: natural-language "when" in English and
 * Portuguese, recurring rules, time zones and quiet hours. No dependencies:
 * the libraries tried got Portuguese wrong ("amanhã às 9h" an hour off,
 * "daqui a 10 minutos" not at all), and a reminder an hour late is worse
 * than one that asks you to rephrase.
 */

export type Lang = 'en' | 'pt';

/** A repeating schedule, in the owner's time zone. */
export type Rule =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekdays'; hour: number; minute: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number } // 0 = Sunday
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export type When = { at: Date; rule?: Rule; lang: Lang };

// ── Time zones ──

type Local = { y: number; m: number; d: number; h: number; mi: number; wd: number };
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `date` in `tz`. */
export function localIn(tz: string, date: Date): Local {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: WD[p.weekday] };
}

function offsetMs(tz: string, date: Date): number {
  const l = localIn(tz, date);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant a wall-clock time in `tz` happens. Day overflow (32 Jan) rolls over. */
export function zoned(tz: string, y: number, m: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetMs(tz, new Date(guess));
  let t = guess - off;
  const off2 = offsetMs(tz, new Date(t));
  if (off2 !== off) t = guess - off2;
  return new Date(t);
}

/** The calendar date `n` days after a local date. */
function addDays(l: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(l.y, l.m - 1, l.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── Recurring rules ──

function matches(rule: Rule, date: { y: number; m: number; d: number; wd: number }): boolean {
  switch (rule.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return date.wd >= 1 && date.wd <= 5;
    case 'weekly':
      return rule.days.includes(date.wd);
    case 'monthly':
      // The 31st in a 30-day month is the last day of that month.
      return date.d === Math.min(rule.day, daysInMonth(date.y, date.m));
  }
}

/** The first time the rule fires strictly after `after`. */
export function nextOccurrence(rule: Rule, after: Date, tz: string): Date {
  const start = localIn(tz, after);
  for (let i = 0; i < 400; i++) {
    const day = addDays(start, i);
    if (!matches(rule, day)) continue;
    const at = zoned(tz, day.y, day.m, day.d, rule.hour, rule.minute);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('rule never fires');
}

// ── Quiet hours ──

/** Minutes after midnight, `from` to `to`; may wrap past midnight (22:00–08:00). */
export type Quiet = { from: number; to: number };

export function inQuiet(date: Date, tz: string, q: Quiet): boolean {
  const l = localIn(tz, date);
  const x = l.h * 60 + l.mi;
  return q.from <= q.to ? x >= q.from && x < q.to : x >= q.from || x < q.to;
}

/** When quiet hours that `date` falls in end. */
export function quietEnd(date: Date, tz: string, q: Quiet): Date {
  return nextOccurrence({ kind: 'daily', hour: Math.floor(q.to / 60), minute: q.to % 60 }, date, tz);
}

export function parseClock(s: string): number | null {
  const m = /^(\d{1,2})(?::|h)?(\d{2})?$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  const h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

// ── Parsing ──

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[,.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const WEEKDAYS: [RegExp, number, Lang][] = [
  [/\b(?:sunday|sun)\b/, 0, 'en'],
  [/\b(?:monday|mon)\b/, 1, 'en'],
  [/\b(?:tuesday|tue|tues)\b/, 2, 'en'],
  [/\b(?:wednesday|wed)\b/, 3, 'en'],
  [/\b(?:thursday|thu|thurs)\b/, 4, 'en'],
  [/\b(?:friday|fri)\b/, 5, 'en'],
  [/\b(?:saturday|sat)\b/, 6, 'en'],
  [/\bdomingos?\b/, 0, 'pt'],
  [/\bsegundas?(?:-feiras?)?\b/, 1, 'pt'],
  [/\btercas?(?:-feiras?)?\b/, 2, 'pt'],
  [/\bquartas?(?:-feiras?)?\b/, 3, 'pt'],
  [/\bquintas?(?:-feiras?)?\b/, 4, 'pt'],
  [/\bsextas?(?:-feiras?)?\b/, 5, 'pt'],
  [/\bsabados?\b/, 6, 'pt'],
];

const MONTHS: [RegExp, number][] = [
  [/\b(?:january|jan|janeiro)\b/, 1],
  [/\b(?:february|feb|fevereiro|fev)\b/, 2],
  [/\b(?:march|mar|marco)\b/, 3],
  [/\b(?:april|apr|abril|abr)\b/, 4],
  [/\b(?:may|maio|mai)\b/, 5],
  [/\b(?:june|jun|junho)\b/, 6],
  [/\b(?:july|jul|julho)\b/, 7],
  [/\b(?:august|aug|agosto|ago)\b/, 8],
  [/\b(?:september|sep|sept|setembro|set)\b/, 9],
  [/\b(?:october|oct|outubro|out)\b/, 10],
  [/\b(?:november|nov|novembro)\b/, 11],
  [/\b(?:december|dec|dezembro|dez)\b/, 12],
];

const PT_HINT = /\b(?:hoje|amanha|depois|as|a|ao|daqui|dentro|em|de|da|do|dia|todos?|todas?|cada|proxim[oa]|nest[ea]|minutos?|horas?|dias?|semanas?|uteis|meio|meia|manha|tarde|noite|domingos?|segundas?|tercas?|quartas?|quintas?|sextas?|sabados?)\b/;

/** Finds a time of day in `s`; returns it and `s` without it. */
function takeClock(s: string): { h: number; mi: number; rest: string } | null {
  const special: [RegExp, number][] = [
    [/\b(?:(?:ao|a|at) )?(?:meio-dia|meio dia|noon|midday)\b/, 12 * 60],
    [/\b(?:(?:a|at) )?(?:meia-noite|meia noite|midnight)\b/, 0],
  ];
  for (const [re, min] of special) {
    const m = re.exec(s);
    if (m) return { h: Math.floor(min / 60), mi: min % 60, rest: s.replace(m[0], ' ') };
  }
  const patterns = [
    /\b(?:at|as|a|pelas|by)\s+(\d{1,2})(?:(?::|h)(\d{2})|h)?(?:\s*(am|pm))?(?:\s+(?:da|de)\s+(manha|tarde|noite))?\b/,
    /\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?(?:\s+(?:da|de)\s+(manha|tarde|noite))?\b/,
    /\b(\d{1,2})h(\d{2})?(?:\s+(?:da|de)\s+(manha|tarde|noite))?\b/,
    /\b(\d{1,2})\s*(am|pm)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    let h = +m[1];
    let mi = 0;
    let ampm: string | undefined;
    let period: string | undefined;
    if (re === patterns[2]) {
      mi = m[2] ? +m[2] : 0;
      period = m[3];
    } else if (re === patterns[3]) {
      ampm = m[2];
    } else {
      mi = m[2] ? +m[2] : 0;
      ampm = m[3];
      period = m[4];
    }
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if ((period === 'tarde' || period === 'noite') && h < 12) h += 12;
    if (h > 23 || mi > 59) return null;
    return { h, mi, rest: s.replace(m[0], ' ') };
  }
  return null;
}

const UNIT_MS: [RegExp, number][] = [
  [/^(?:m|min|mins|minute|minutes|minuto|minutos)$/, 60_000],
  [/^(?:h|hr|hrs|hour|hours|hora|horas)$/, 3_600_000],
  [/^(?:d|day|days|dia|dias)$/, 86_400_000],
  [/^(?:w|week|weeks|semana|semanas)$/, 7 * 86_400_000],
];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, um: 1, uma: 1, two: 2, dois: 2, duas: 2, half: 0.5, meia: 0.5 };

function relative(s: string, now: Date): Date | null {
  const m =
    /^(?:in|daqui a|dentro de|em)\s+(\d+|a|an|one|um|uma|two|dois|duas|half an?|meia)\s*([a-z]+)$/.exec(s) ??
    /^(\d+)\s*([a-z]+)$/.exec(s);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : NUMBER_WORDS[m[1].split(' ')[0]];
  const unit = UNIT_MS.find(([re]) => re.test(m[2]))?.[1];
  if (!n || !unit) return null;
  return new Date(now.getTime() + n * unit);
}

type RuleShape = { kind: 'daily' } | { kind: 'weekdays' } | { kind: 'weekly'; days: number[] } | { kind: 'monthly'; day: number };

function recurrence(s: string): { rule: RuleShape; rest: string } | null {
  if (!/^(?:every|each|daily|weekdays|todos|todas|todo|toda|cada|diariamente|dias uteis|as|aos|on)\b/.test(s)) return null;
  if (/\b(?:weekday|weekdays|dias uteis|dia util)\b/.test(s)) {
    return { rule: { kind: 'weekdays' }, rest: s.replace(/^.*?(?:weekdays?|dias uteis|dia util)\b/, ' ') };
  }
  const monthly = /\b(?:todo dia|todos os meses no dia|todo mes no dia|cada mes no dia|every month on the|monthly on the|on the)\s+(\d{1,2})(?:st|nd|rd|th|o)?\b/.exec(s) ??
    /\bevery (\d{1,2})(?:st|nd|rd|th) of the month\b/.exec(s);
  if (monthly && +monthly[1] >= 1 && +monthly[1] <= 31) {
    return { rule: { kind: 'monthly', day: +monthly[1] }, rest: s.replace(monthly[0], ' ') };
  }
  const days = WEEKDAYS.filter(([re]) => re.test(s)).map(([, d]) => d);
  if (days.length && /^(?:every|each|todas|todos|toda|todo|cada|as|aos|on)\b/.test(s)) {
    let rest = s;
    for (const [re] of WEEKDAYS) rest = rest.replace(new RegExp(re.source, 'g'), ' ');
    return { rule: { kind: 'weekly', days: [...new Set(days)].sort() }, rest };
  }
  if (/^(?:every day|everyday|daily|each day|todos os dias|todo dia|todo o dia|diariamente|cada dia)\b/.test(s)) {
    return { rule: { kind: 'daily' }, rest: s.replace(/^(?:every day|everyday|daily|each day|todos os dias|todo dia|todo o dia|diariamente|cada dia)\b/, ' ') };
  }
  return null;
}

function isLeftover(rest: string): boolean {
  // What may remain once the date and time are taken out.
  return /^(?:\s|on|at|the|this|next|of|in|every|each|e|and|na|no|nas|nos|de|da|do|a|as|o|os|todas|todos|toda|todo|cada|para|pela|pelas|proxima|proximo|esta|este|nesta|neste|feira|-)*$/.test(rest);
}

/**
 * Reads "amanhã às 9", "in 10 minutes", "next friday 18:00",
 * "every monday 10:00", "todos os dias úteis às 8h30", an RFC 3339 time
 * from the app's picker… in the person's time zone. Null when unsure:
 * a bot that asks again beats one that guesses.
 */
export function parseWhen(input: string, opts: { tz: string; now: Date }): When | null {
  const raw = input.trim();
  // From the app's date picker: an instant with its offset.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : { at: new Date(t), lang: 'en' };
  }
  const s = norm(raw).replace(/\b(\d{4}-\d{2}-\d{2})t(\d{2}:\d{2})/, '$1 $2');
  if (!s) return null;
  const lang: Lang = PT_HINT.test(s) && !/\b(?:at|in|tomorrow|today|every|next)\b/.test(s) ? 'pt' : 'en';
  const { tz, now } = opts;

  const rel = relative(s, now);
  if (rel) return { at: rel, lang };

  const rec = recurrence(s);
  if (rec) {
    const clock = takeClock(rec.rest);
    if (!isLeftover(clock ? clock.rest : rec.rest)) return null;
    const rule = { ...rec.rule, hour: clock?.h ?? 9, minute: clock?.mi ?? 0 } as Rule;
    return { at: nextOccurrence(rule, now, tz), rule, lang };
  }

  const today = localIn(tz, now);
  let day: { y: number; m: number; d: number } | null = null;
  let rest = s;
  let weekdayOnly = false;
  const take = (re: RegExp) => {
    const m = re.exec(rest);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  if (take(/\b(?:day after tomorrow|depois de amanha)\b/)) day = addDays(today, 2);
  else if (take(/\b(?:tomorrow|amanha)\b/)) day = addDays(today, 1);
  else if (take(/\b(?:today|tonight|hoje)\b/)) day = today;

  if (!day) {
    const iso = take(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) day = { y: +iso[1], m: +iso[2], d: +iso[3] };
  }
  if (!day) {
    const dm = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // day/month, as written in Portuguese
    if (dm) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : today.y;
      day = { y, m: +dm[2], d: +dm[1] };
      if (!dm[3] && zoned(tz, y, day.m, day.d, 23, 59) < now) day = { ...day, y: y + 1 };
    }
  }
  if (!day) {
    const month = MONTHS.find(([re]) => re.test(rest));
    if (month) {
      const num = /\b(?:dia\s+)?(\d{1,2})(?:st|nd|rd|th|o)?\b(?!\s*(?::|h\b|h\d|am|pm))/.exec(rest.replace(month[0], ' '));
      if (num) {
        rest = rest.replace(month[0], ' ').replace(num[0], ' ');
        let y = today.y;
        if (zoned(tz, y, month[1], +num[1], 23, 59) < now) y++;
        day = { y, m: month[1], d: +num[1] };
      }
    }
  }
  if (!day) {
    const wd = WEEKDAYS.find(([re]) => re.test(rest));
    if (wd) {
      const next = /\b(?:next|proxima|proximo)\b/.test(rest);
      rest = rest.replace(wd[0], ' ');
      let ahead = (wd[1] - today.wd + 7) % 7;
      if (next && ahead === 0) ahead = 7;
      day = addDays(today, ahead);
      weekdayOnly = ahead === 0;
    }
  }
  if (!day) {
    const dia = take(/\bdia (\d{1,2})\b/);
    if (dia) {
      let { y, m } = today;
      if (zoned(tz, y, m, +dia[1], 23, 59) < now) ({ y, m } = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });
      day = { y, m, d: +dia[1] };
    }
  }

  let clock = takeClock(rest);
  if (clock) rest = clock.rest;
  else if (day) {
    // "tomorrow 9", "amanhã 18": a bare hour once the day is known.
    const bare = /\b(\d{1,2})\b/.exec(rest);
    if (bare && +bare[1] < 24) {
      clock = { h: +bare[1], mi: 0, rest: rest.replace(bare[0], ' ') };
      rest = clock.rest;
    }
  }
  if (!isLeftover(rest)) return null;
  if (!day && !clock) return null;

  if (!day) {
    // A time alone: the next time it comes round.
    let at = zoned(tz, today.y, today.m, today.d, clock!.h, clock!.mi);
    if (at <= now) {
      const t = addDays(today, 1);
      at = zoned(tz, t.y, t.m, t.d, clock!.h, clock!.mi);
    }
    return { at, lang };
  }
  if (day.m < 1 || day.m > 12 || day.d < 1 || day.d > daysInMonth(day.y, day.m)) return null;
  let at = zoned(tz, day.y, day.m, day.d, clock?.h ?? 9, clock?.mi ?? 0);
  if (weekdayOnly && at <= now) {
    const t = addDays(day, 7);
    at = zoned(tz, t.y, t.m, t.d, clock?.h ?? 9, clock?.mi ?? 0);
  }
  return { at, lang };
}

// ── Formatting ──

export function formatAt(date: Date, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'pt' ? 'pt-PT' : 'en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_NAMES = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  pt: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
};

export function describeRule(rule: Rule, lang: Lang): string {
  const at = `${pad(rule.hour)}:${pad(rule.minute)}`;
  const pt = lang === 'pt';
  switch (rule.kind) {
    case 'daily':
      return pt ? `todos os dias às ${at}` : `every day at ${at}`;
    case 'weekdays':
      return pt ? `dias úteis às ${at}` : `weekdays at ${at}`;
    case 'weekly': {
      const names = rule.days.map((d) => DAY_NAMES[lang][d]).join(pt ? ', ' : ', ');
      return pt ? `às ${names}, ${at}` : `every ${names} at ${at}`;
    }
    case 'monthly':
      return pt ? `todo dia ${rule.day} às ${at}` : `every month on the ${rule.day} at ${at}`;
  }
}
