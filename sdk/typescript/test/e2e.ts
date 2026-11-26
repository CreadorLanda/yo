/**
 * End to end against a real server (CI runs it for both SDKs):
 *
 *   E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts ts
 *   E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts go
 *
 * A person signs up (the server must run with APP_ENV=dev, which returns the
 * code), creates a bot, and the echo example for that SDK is started with
 * its token. The person then sends the bot an encrypted message and clicks
 * its button, exactly as the app does, and checks both answers decrypt.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { E2EE, type KeyServer, type PreKeyBundle, type UploadKeysRequest } from '../src/crypto';
import { MemoryStore } from '../src/store';

const api = (process.env.E2E_API_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const runner = process.argv[2] ?? 'ts';
const sdkRoot = resolve(import.meta.dir, '..', '..');

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${api}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// ── A person, as the app is ──
const phone = `+24492${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const { dev_code } = await call<{ dev_code?: string }>('POST', '/auth/start', { phone });
if (!dev_code) fail('the server must run with APP_ENV=dev');
const signedIn = await call<{ user: { id: string }; tokens: { access_token: string } }>('POST', '/auth/verify', {
  phone,
  code: dev_code,
  device: 'sdk-e2e',
  platform: 'web',
});
const jwt = signedIn.tokens.access_token;
const personKeys: KeyServer = {
  uploadKeys: (b: UploadKeysRequest) => call('PUT', '/users/me/keys', b, jwt),
  bundle: (u: string) => call<PreKeyBundle>('GET', `/users/by-username/${encodeURIComponent(u)}/keys`, undefined, jwt),
  fetchSenderKeys: (chatId: string) => call('GET', `/groups/${chatId}/sender-keys`, undefined, jwt),
  publishSenderKeys: async (chatId, epoch, entries) => {
    await call('POST', `/groups/${chatId}/sender-keys`, { epoch, entries }, jwt);
  },
};
const person = new E2EE(new MemoryStore(), signedIn.user.id, personKeys);
await person.publishKeys();

// ── Their bot, running the example ──
const username = `ci_${runner}_${Date.now().toString(36)}_bot`;
const created = await call<{ bot: { id: string; username: string }; token: { token: string } | string }>(
  'POST',
  '/bots',
  { username, display_name: `CI ${runner}` },
  jwt,
);
const botId = created.bot.id;
const token = typeof created.token === 'string' ? created.token : created.token.token;

const work = mkdtempSync(join(tmpdir(), 'zwosocial-e2e-'));
const env = { ...process.env, BOT_TOKEN: token, API_URL: api };
if (runner === 'go') {
  const built = Bun.spawnSync(['go', 'build', '-o', join(work, 'echo'), './examples/echo'], { cwd: join(sdkRoot, 'go'), stderr: 'pipe' });
  if (built.exitCode !== 0) fail(`go build: ${built.stderr.toString()}`);
}
// Each bot keeps its store in a fresh directory.
const child =
  runner === 'go'
    ? spawn(join(work, 'echo'), [], { cwd: work, env })
    : spawn('bun', [join(sdkRoot, 'typescript', 'examples', 'echo.ts')], { cwd: work, env });
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
const stop = () => child.kill('SIGINT');
process.on('exit', stop);

const deadline = (ms: number) => Date.now() + ms;
for (const until = deadline(90_000); !output.includes('gateway ready'); ) {
  if (Date.now() > until || child.exitCode !== null) fail(`the ${runner} bot never got ready:\n${output}`);
  await Bun.sleep(250);
}
console.log(`✓ ${runner} echo bot signed in as @${created.bot.username}`);

// ── The conversation ──
const { chat_id: chatId } = await call<{ chat_id: string }>('POST', `/bots/${botId}/dm`, {}, jwt);

type Msg = { id: number; sender_id?: string; content: string; reply_to_id?: number };
async function nextFromBot(after: number): Promise<{ msg: Msg; body: string }> {
  for (const until = deadline(20_000); Date.now() < until; await Bun.sleep(300)) {
    const list = await call<Msg[] | { messages: Msg[] }>('GET', `/chats/${chatId}/messages?limit=20`, undefined, jwt);
    const msgs = Array.isArray(list) ? list : list.messages;
    const found = msgs.filter((m) => m.sender_id === botId && m.id > after).sort((a, b) => a.id - b.id)[0];
    if (found) return { msg: found, body: await person.decrypt(botId, found.content) };
  }
  fail(`no answer from the bot:\n${output}`);
}

const sent = await call<{ id: number }>(
  'POST',
  `/chats/${chatId}/messages`,
  { content: await person.encrypt(botId, 'hello from CI', username), message_type: 'text' },
  jwt,
);
const echo = await nextFromBot(sent.id);
const zi = (JSON.parse(echo.body) as { zi1: { text: string; components: { id: string }[][] } }).zi1;
if (zi.text !== 'You said: hello from CI') fail(`echo said ${JSON.stringify(zi.text)}`);
if (zi.components[0]?.[0]?.id !== 'again') fail('the echo has no button');
if (echo.msg.reply_to_id !== sent.id) fail('the echo is not a reply to the message');
console.log('✓ the bot decrypted the message and answered with a button');

await call(
  'POST',
  `/chats/${chatId}/bots/${botId}/updates`,
  {
    kind: 'interaction',
    message_id: echo.msg.id,
    content: await person.encrypt(botId, JSON.stringify({ v: 1, kind: 'interaction', message_id: echo.msg.id, component_id: 'again' })),
  },
  jwt,
);
const again = await nextFromBot(echo.msg.id);
if (again.body !== 'Again! 🔁') fail(`the click got ${JSON.stringify(again.body)}`);
console.log('✓ the click reached the bot and it answered');

// ── A group, with the bot in privacy mode: a command reaches it alone, and
// its answer is sealed with its own sender key. ──
const group = await call<{ id: string }>('POST', '/groups', { title: `CI ${runner}`, member_ids: [] }, jwt);
await call('POST', `/chats/${group.id}/bots`, { bot_id: botId, scopes: ['messages.read.commands', 'messages.send', 'members.read'] }, jwt);
await call(
  'POST',
  `/chats/${group.id}/bots/${botId}/updates`,
  {
    kind: 'command',
    content: await person.encrypt(botId, JSON.stringify({ v: 1, kind: 'command', text: '/ping', command: { name: 'ping', options: {} } })),
  },
  jwt,
);
let pong = '';
for (const until = deadline(20_000); !pong && Date.now() < until; await Bun.sleep(300)) {
  const msgs = await call<Msg[]>('GET', `/chats/${group.id}/messages?limit=20`, undefined, jwt);
  const fromBot = msgs.find((m) => m.sender_id === botId && m.content.startsWith('soc1g.'));
  if (fromBot) pong = await person.decryptGroup(group.id, fromBot.content);
}
if (pong !== 'pong 🏓') fail(`the group command got ${JSON.stringify(pong)}:\n${output}`);
console.log('✓ a command in a group reached the bot and its group-encrypted answer opened');

stop();
process.exit(0);
