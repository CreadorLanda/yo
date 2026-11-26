import { expect, test } from 'bun:test';

import { DecryptError, E2EE, type KeyServer, type PreKeyBundle, type UploadKeysRequest } from '../src/crypto';
import { MemoryStore } from '../src/store';

/** A server in memory: bundles, one-time keys handed out once, sender keys. */
class FakeServer {
  bundles = new Map<string, UploadKeysRequest>();
  senderKeys = new Map<string, { user_id: string; epoch: number; ciphertext: string; for: string }[]>();
  epoch = 1;
  keyServer(username: string, userId: string): KeyServer {
    return {
      uploadKeys: async (b) => {
        const prev = this.bundles.get(username);
        this.bundles.set(username, prev ? { ...b, one_time_pre_keys: [...prev.one_time_pre_keys, ...b.one_time_pre_keys] } : b);
        return { one_time_remaining: this.bundles.get(username)!.one_time_pre_keys.length };
      },
      bundle: async (u): Promise<PreKeyBundle> => {
        const b = this.bundles.get(u);
        if (!b) throw new Error('404');
        const otk = b.one_time_pre_keys.shift();
        return { identity_key: b.identity_key, signed_pre_key: b.signed_pre_key, one_time_pre_key: otk ?? null };
      },
      fetchSenderKeys: async (chatId) => ({
        epoch: this.epoch,
        keys: (this.senderKeys.get(chatId) ?? []).filter((k) => k.for === userId),
      }),
      publishSenderKeys: async (chatId, epoch, entries) => {
        const list = this.senderKeys.get(chatId) ?? [];
        for (const e of entries) list.push({ user_id: userId, epoch, ciphertext: e.ciphertext, for: e.user_id });
        this.senderKeys.set(chatId, list);
      },
    };
  }
}

async function party(server: FakeServer, id: string, username: string) {
  const e = new E2EE(new MemoryStore(), id, server.keyServer(username, id));
  await e.publishKeys();
  return e;
}

test('a first message sets up the session; answers flow both ways', async () => {
  const server = new FakeServer();
  const ana = await party(server, 'ana-id', 'ana');
  const bot = await party(server, 'bot-id', 'helper_bot');

  const first = await ana.encrypt('bot-id', '/remind what:water', 'helper_bot');
  expect(first.startsWith('soc1.')).toBe(true);
  expect(await bot.decrypt('ana-id', first)).toBe('/remind what:water');

  // The bot answers without ever fetching Ana's bundle.
  const reply = await bot.encrypt('ana-id', 'Reminder set');
  expect(await ana.decrypt('bot-id', reply)).toBe('Reminder set');

  // Later messages, and the same message twice (history reloads), still open.
  const second = await ana.encrypt('bot-id', 'thanks');
  expect(await bot.decrypt('ana-id', second)).toBe('thanks');
  expect(await bot.decrypt('ana-id', first)).toBe('/remind what:water');
});

test('the handshake repeats until the peer answers, then stops', async () => {
  const server = new FakeServer();
  const ana = await party(server, 'ana-id', 'ana');
  const bot = await party(server, 'bot-id', 'helper_bot');
  const a = await ana.encrypt('bot-id', 'one', 'helper_bot');
  const b = await ana.encrypt('bot-id', 'two');
  const header = (env: string) => JSON.parse(Buffer.from(env.slice(5).split('.')[0], 'base64url').toString());
  expect(header(a).ek).toBeDefined();
  expect(header(b).ek).toBeDefined();
  // The bot never saw `one`: `two` alone still sets up the session.
  expect(await bot.decrypt('ana-id', b)).toBe('two');
  await ana.decrypt('bot-id', await bot.encrypt('ana-id', 'hi'));
  expect(header(await ana.encrypt('bot-id', 'three')).ek).toBeUndefined();
});

test('tampering and strangers fail loudly', async () => {
  const server = new FakeServer();
  const ana = await party(server, 'ana-id', 'ana');
  const bot = await party(server, 'bot-id', 'helper_bot');
  const env = await ana.encrypt('bot-id', 'secret', 'helper_bot');
  const tampered = env.slice(0, -4) + (env.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await expect(bot.decrypt('ana-id', tampered)).rejects.toBeInstanceOf(DecryptError);
  await expect(bot.decrypt('ana-id', 'hello')).rejects.toBeInstanceOf(DecryptError);
});

test('group messages: the bot seals its sender key and members read it', async () => {
  const server = new FakeServer();
  const ana = await party(server, 'ana-id', 'ana');
  const ben = await party(server, 'ben-id', 'ben');
  const bot = await party(server, 'bot-id', 'helper_bot');
  const members = [
    { user_id: 'ana-id', username: 'ana' },
    { user_id: 'ben-id', username: 'ben' },
    { user_id: 'bot-id', username: 'helper_bot' },
  ];
  const env = await bot.encryptForGroup('g1', 'Good morning, group', 1, members);
  expect(env.startsWith('soc1g.')).toBe(true);
  expect(await ana.decryptGroup('g1', env)).toBe('Good morning, group');
  expect(await ben.decryptGroup('g1', env)).toBe('Good morning, group');

  // And a member's group message reaches a bot that was given the key.
  const fromAna = await ana.encryptForGroup('g1', 'hi bot', 1, members);
  expect(await bot.decryptGroup('g1', fromAna)).toBe('hi bot');
});
