import { expect, test } from 'bun:test';

import {
  atTime,
  buildInvocation,
  commandTargets,
  datePresets,
  describe,
  isAmbiguous,
  matchCommands,
  missingOptions,
  parseInvocation,
  typedCommand,
  type ChatCommand,
} from '@/data/bot-commands';

const reminder = { id: 'b1', username: 'reminder_bot', display_name: 'Reminder' };
const other = { id: 'b2', username: 'other_bot', display_name: 'Other' };

const remind: ChatCommand = {
  name: 'remind',
  description: 'Set a reminder',
  description_pt: 'Criar um lembrete',
  bot: reminder,
  options: [
    { name: 'when', description: 'When', type: 'datetime', required: true },
    { name: 'what', description: 'What', type: 'string', required: true },
    { name: 'who', description: 'Who', type: 'user' },
  ],
};
const help: ChatCommand = { name: 'help', description: 'Help', bot: reminder, options: [] };
const otherHelp: ChatCommand = { ...help, bot: other };
const report: ChatCommand = { name: 'report', description: 'Report', bot: other, options: [] };

test('the command being typed', () => {
  expect(typedCommand('/')).toBe('');
  expect(typedCommand('/Rem')).toBe('rem');
  expect(typedCommand('/remind ')).toBeNull();
  expect(typedCommand('hello /remind')).toBeNull();
});

test('matching puts prefixes first', () => {
  expect(matchCommands([report, remind, help], 're').map((c) => c.name)).toEqual(['report', 'remind']);
  expect(matchCommands([report, remind, help], 'el').map((c) => c.name)).toEqual(['help']);
  expect(matchCommands([report, remind], '').length).toBe(2);
});

test('an invocation round-trips, quoting what needs it', () => {
  const values = { when: '2026-11-26T09:00:00.000Z', what: 'drink "lots of" water', who: 'ana' };
  const text = buildInvocation(remind, values, false);
  expect(text).toBe('/remind when:2026-11-26T09:00:00.000Z what:"drink \\"lots of\\" water" who:@ana');
  expect(parseInvocation(text)).toEqual({
    name: 'remind',
    options: { when: '2026-11-26T09:00:00.000Z', what: 'drink "lots of" water', who: '@ana' },
  });
  expect(buildInvocation(help, {}, true)).toBe('/help@reminder_bot');
  expect(parseInvocation('/help@reminder_bot')).toEqual({ name: 'help', bot: 'reminder_bot', options: {} });
  expect(parseInvocation('not a command')).toBeNull();
});

test('required options and ambiguity', () => {
  expect(missingOptions(remind, { when: 'x' })).toEqual(['what']);
  expect(missingOptions(remind, { when: 'x', what: '  ' })).toEqual(['what']);
  expect(missingOptions(help, {})).toEqual([]);
  expect(isAmbiguous([help, otherHelp, remind], help)).toBe(true);
  expect(isAmbiguous([help, otherHelp, remind], remind)).toBe(false);
});

test('a command goes to the bots that registered it', () => {
  const all = [remind, help, otherHelp, report];
  expect(commandTargets('/remind what:x', all)).toEqual(['b1']);
  expect(commandTargets('/help', all)).toEqual(['b1', 'b2']);
  expect(commandTargets('/help@other_bot', all)).toEqual(['b2']);
  expect(commandTargets('/unknown', all)).toBeNull();
  expect(commandTargets('hello', all)).toBeNull();
});

test('descriptions follow the language', () => {
  expect(describe(remind, 'pt')).toBe('Criar um lembrete');
  expect(describe(remind, 'en')).toBe('Set a reminder');
  expect(describe(help, 'pt')).toBe('Help');
});

test('date presets and typed times', () => {
  const now = new Date(2026, 10, 25, 18, 30);
  const keys = datePresets(now).map((p) => p.key);
  expect(keys).toEqual(['in_10_min', 'in_1_hour', 'tonight', 'tomorrow_morning']);
  expect(datePresets(new Date(2026, 10, 25, 21, 0)).map((p) => p.key)).not.toContain('tonight');
  expect(atTime(now, '07:05')?.getHours()).toBe(7);
  expect(atTime(now, '25:00')).toBeNull();
});
