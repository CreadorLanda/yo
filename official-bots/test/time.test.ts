import { describe, expect, test } from 'bun:test';

import { describeRule, inQuiet, nextOccurrence, parseWhen, quietEnd, zoned } from '../src/lib/time';

// Thursday 26 Nov 2026, 10:00 in Luanda (UTC+1, no daylight saving).
const now = new Date('2026-11-26T09:00:00Z');
const tz = 'Africa/Luanda';
const at = (s: string, z = tz, n = now) => parseWhen(s, { tz: z, now: n })?.at.toISOString();

describe('one-off times, Portuguese', () => {
  test.each([
    ['amanhã às 9', '2026-11-27T08:00:00.000Z'],
    ['amanhã às 9h', '2026-11-27T08:00:00.000Z'],
    ['amanha as 9h30', '2026-11-27T08:30:00.000Z'],
    ['hoje às 21:30', '2026-11-26T20:30:00.000Z'],
    ['hoje às 9 da noite', '2026-11-26T20:00:00.000Z'],
    ['daqui a 10 minutos', '2026-11-26T09:10:00.000Z'],
    ['em 2 horas', '2026-11-26T11:00:00.000Z'],
    ['dentro de 3 dias', '2026-11-29T09:00:00.000Z'],
    ['sexta às 18:00', '2026-11-27T17:00:00.000Z'],
    ['próxima quinta às 8h', '2026-12-03T07:00:00.000Z'],
    ['quinta-feira às 8h', '2026-12-03T07:00:00.000Z'], // today 8:00 has passed: next week
    ['dia 3 de dezembro às 14h', '2026-12-03T13:00:00.000Z'],
    ['3/12 às 14h', '2026-12-03T13:00:00.000Z'],
    ['dia 5', '2026-12-05T08:00:00.000Z'],
    ['depois de amanhã ao meio-dia', '2026-11-28T11:00:00.000Z'],
    ['às 9', '2026-11-27T08:00:00.000Z'], // 9:00 has passed today
    ['às 15h', '2026-11-26T14:00:00.000Z'],
  ])('%s', (s, want) => expect(at(s)).toBe(want));
});

describe('one-off times, English', () => {
  test.each([
    ['tomorrow at 9am', '2026-11-27T08:00:00.000Z'],
    ['tomorrow 9', '2026-11-27T08:00:00.000Z'],
    ['in 10 minutes', '2026-11-26T09:10:00.000Z'],
    ['in an hour', '2026-11-26T10:00:00.000Z'],
    ['10m', '2026-11-26T09:10:00.000Z'],
    ['2h', '2026-11-26T11:00:00.000Z'],
    ['next friday 18:00', '2026-11-27T17:00:00.000Z'],
    ['friday at 6pm', '2026-11-27T17:00:00.000Z'],
    ['december 3 at 2pm', '2026-12-03T13:00:00.000Z'],
    ['3 dec 14:00', '2026-12-03T13:00:00.000Z'],
    ['2026-12-24 20:00', '2026-12-24T19:00:00.000Z'],
    ['today at noon', '2026-11-26T11:00:00.000Z'],
  ])('%s', (s, want) => expect(at(s)).toBe(want));

  test('an RFC 3339 time from the picker is taken as is', () => {
    expect(at('2026-12-01T09:00:00Z')).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('recurring', () => {
  test.each([
    ['every monday 10:00', 'weekly', '2026-11-30T09:00:00.000Z'],
    ['todas as segundas às 10:00', 'weekly', '2026-11-30T09:00:00.000Z'],
    ['às segundas e quartas às 8h', 'weekly', '2026-11-30T07:00:00.000Z'],
    ['every day at 9', 'daily', '2026-11-27T08:00:00.000Z'],
    ['todos os dias às 21h', 'daily', '2026-11-26T20:00:00.000Z'],
    ['dias úteis às 8h30', 'weekdays', '2026-11-27T07:30:00.000Z'],
    ['every weekday at 8:30', 'weekdays', '2026-11-27T07:30:00.000Z'],
    ['todo dia 1 às 10h', 'monthly', '2026-12-01T09:00:00.000Z'],
    ['every month on the 15th', 'monthly', '2026-12-15T08:00:00.000Z'],
  ])('%s', (s, kind, first) => {
    const w = parseWhen(s, { tz, now })!;
    expect(w.rule?.kind).toBe(kind as 'daily');
    expect(w.at.toISOString()).toBe(first);
  });

  test('weekly days are all kept', () => {
    const w = parseWhen('às segundas e quartas às 8h', { tz, now })!;
    expect(w.rule).toEqual({ kind: 'weekly', days: [1, 3], hour: 8, minute: 0 });
  });

  test('the 31st falls on the last day of a short month', () => {
    const rule = { kind: 'monthly' as const, day: 31, hour: 9, minute: 0 };
    expect(nextOccurrence(rule, new Date('2026-11-01T00:00:00Z'), tz).toISOString()).toBe('2026-11-30T08:00:00.000Z');
  });

  test('describes itself in both languages', () => {
    expect(describeRule({ kind: 'weekly', days: [1], hour: 10, minute: 0 }, 'en')).toBe('every Monday at 10:00');
    expect(describeRule({ kind: 'weekdays', hour: 8, minute: 30 }, 'pt')).toBe('dias úteis às 08:30');
  });
});

describe('language', () => {
  test('replies follow the words used', () => {
    expect(parseWhen('amanhã às 9', { tz, now })?.lang).toBe('pt');
    expect(parseWhen('tomorrow at 9', { tz, now })?.lang).toBe('en');
  });
});

describe('time zones', () => {
  test('daylight saving: 9:00 in Lisbon is 9:00 local in summer and winter', () => {
    const summer = parseWhen('2026-07-01 09:00', { tz: 'Europe/Lisbon', now: new Date('2026-06-01T00:00:00Z') });
    expect(summer).not.toBeNull();
    expect(zoned('Europe/Lisbon', 2026, 7, 1, 9, 0).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zoned('Europe/Lisbon', 2026, 12, 1, 9, 0).toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  test('a daily rule keeps its local hour across a clock change', () => {
    const rule = { kind: 'daily' as const, hour: 9, minute: 0 };
    // The clocks go forward in Lisbon at 01:00 UTC on 29 March 2026.
    const before = nextOccurrence(rule, new Date('2026-03-27T12:00:00Z'), 'Europe/Lisbon');
    const after = nextOccurrence(rule, before, 'Europe/Lisbon');
    expect(before.toISOString()).toBe('2026-03-28T09:00:00.000Z'); // 9:00 WET
    expect(after.toISOString()).toBe('2026-03-29T08:00:00.000Z'); // 9:00 WEST
  });
});

describe('quiet hours', () => {
  const q = { from: 22 * 60, to: 8 * 60 };
  test('wraps past midnight', () => {
    expect(inQuiet(new Date('2026-11-26T22:30:00Z'), tz, q)).toBe(true); // 23:30 local
    expect(inQuiet(new Date('2026-11-27T06:30:00Z'), tz, q)).toBe(true); // 07:30
    expect(inQuiet(new Date('2026-11-27T07:30:00Z'), tz, q)).toBe(false); // 08:30
  });
  test('ends at the next "to"', () => {
    expect(quietEnd(new Date('2026-11-26T22:30:00Z'), tz, q).toISOString()).toBe('2026-11-27T07:00:00.000Z');
  });
});

describe('refuses what it cannot read', () => {
  test.each(['', 'whenever', 'quando der', 'amanhã talvez', 'at 25:00', '31/02'])('%s', (s) => expect(at(s)).toBeUndefined());
});
