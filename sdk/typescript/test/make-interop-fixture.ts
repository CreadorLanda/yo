/**
 * Writes sdk/go/testdata/interop.json: a person (TypeScript) seals a direct
 * message and a group message for a bot, and the Go SDK must open both with
 * the bot's keys. Run when the protocol changes:
 *   bun test/make-interop-fixture.ts
 */
import { writeFileSync } from 'node:fs';

import { E2EE, type KeyServer, type PreKeyBundle, type UploadKeysRequest } from '../src/crypto';
import { MemoryStore } from '../src/store';

const bundles = new Map<string, UploadKeysRequest>();
const senderKeys: { user_id: string; epoch: number; ciphertext: string; for: string }[] = [];
const server = (id: string, username: string): KeyServer => ({
  uploadKeys: async (b) => {
    bundles.set(username, b);
    return { one_time_remaining: b.one_time_pre_keys.length };
  },
  bundle: async (u): Promise<PreKeyBundle> => {
    const b = bundles.get(u)!;
    return { identity_key: b.identity_key, signed_pre_key: b.signed_pre_key, one_time_pre_key: b.one_time_pre_keys.shift() ?? null };
  },
  fetchSenderKeys: async () => ({ epoch: 1, keys: senderKeys.filter((k) => k.for === id) }),
  publishSenderKeys: async (_chat, epoch, entries) => {
    for (const e of entries) senderKeys.push({ user_id: id, epoch, ciphertext: e.ciphertext, for: e.user_id });
  },
});

const botStore = new MemoryStore();
const bot = new E2EE(botStore, 'bot-id', server('bot-id', 'helper_bot'));
const ana = new E2EE(new MemoryStore(), 'ana-id', server('ana-id', 'ana'));
await bot.publishKeys();
await ana.publishKeys();

const direct = await ana.encrypt('bot-id', 'olá bot — /remind what:"água"', 'helper_bot');
const group = await ana.encryptForGroup('g1', 'mensagem para o grupo', 1, [
  { user_id: 'ana-id', username: 'ana' },
  { user_id: 'bot-id', username: 'helper_bot' },
]);

writeFileSync(
  new URL('../../go/testdata/interop.json', import.meta.url),
  JSON.stringify({ botKeys: await botStore.get('keys'), direct, group, senderKeys: senderKeys.filter((k) => k.for === 'bot-id') }, null, 2),
);
console.log('wrote interop.json');
