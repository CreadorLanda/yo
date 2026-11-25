import { expect, test } from 'bun:test';

import {
  gatewayUrl,
  isValidBotName,
  isValidBotUsername,
  looksLikeWebhookUrl,
  normalizeBotUsername,
  suggestBotUsername,
} from '@/data/bot-policy';

test('bot usernames follow the server rule', () => {
  expect(isValidBotUsername('reminder_bot')).toBe(true);
  expect(isValidBotUsername('xbot')).toBe(true);
  expect(isValidBotUsername('bot')).toBe(false);
  expect(isValidBotUsername('reminder')).toBe(false);
  expect(isValidBotUsername('_hidden_bot')).toBe(false);
  expect(isValidBotUsername('Upper_bot')).toBe(false);
  expect(isValidBotUsername(`${'a'.repeat(30)}bot`)).toBe(false);
});

test('a username is suggested from the name and always valid', () => {
  expect(suggestBotUsername('Lembretes da Ana')).toBe('lembretes_da_ana_bot');
  expect(suggestBotUsername('Weather Bot')).toBe('weather_bot');
  expect(suggestBotUsername('  !!! ')).toBe('my_bot');
  expect(suggestBotUsername('Ação Rápida')).toBe('acao_rapida_bot');
  for (const name of ['x', 'Lembretes da Ana', 'a'.repeat(80), '日本語', 'bot', 'mybot']) {
    expect(isValidBotUsername(suggestBotUsername(name))).toBe(true);
  }
});

test('typed usernames are cleaned, not rejected', () => {
  expect(normalizeBotUsername('@My-Bot')).toBe('mybot');
  expect(normalizeBotUsername('a'.repeat(40)).length).toBe(32);
});

test('names and webhook URLs', () => {
  expect(isValidBotName('A')).toBe(false);
  expect(isValidBotName('Ab')).toBe(true);
  expect(looksLikeWebhookUrl('https://bot.example.com/hook')).toBe(true);
  expect(looksLikeWebhookUrl('http://bot.example.com/hook')).toBe(false);
  expect(looksLikeWebhookUrl('https://user:pw@bot.example.com')).toBe(false);
  expect(looksLikeWebhookUrl('bot.example.com')).toBe(false);
});

test('the gateway address follows the API scheme', () => {
  expect(gatewayUrl('https://api.zwo.example')).toBe('wss://api.zwo.example/api/bot/v1/gateway');
  expect(gatewayUrl('http://192.168.1.2:8080/')).toBe('ws://192.168.1.2:8080/api/bot/v1/gateway');
});
