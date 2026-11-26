/**
 * Writes what a language model reads (#331), following llms.txt
 * (https://llmstxt.org):
 *   static/llms.txt       — what the platform is, and a link to every page in Markdown
 *   static/llms-full.txt  — every English page, in sidebar order, in one file
 *   static/md/…           — each page as plain Markdown, which llms.txt links to
 * Run after gen-api.ts, so the API reference is included. All three are
 * generated, never edited.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import sidebars from '../sidebars';

const root = join(import.meta.dir, '..');
const site = (process.env.DEVELOPERS_URL ?? 'https://creadorlanda.github.io') + (process.env.DEVELOPERS_BASE_URL ?? '/yo/');

type Item = string | { type: string; label: string; items: Item[] };
const sections: { label: string; ids: string[] }[] = [{ label: 'Start', ids: [] }];
for (const item of sidebars.docs as Item[]) {
  if (typeof item === 'string') sections[0].ids.push(item);
  else sections.push({ label: item.label, ids: item.items as string[] });
}

function page(id: string) {
  const raw = readFileSync(join(root, 'docs', `${id}.md`), 'utf8');
  const description = /^---\n[\s\S]*?^description: (.+)$[\s\S]*?\n---\n/m.exec(raw)?.[1];
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->\n?/g, '').trim();
  const title = /^# (.+)$/m.exec(body)?.[1] ?? id;
  if (!description) throw new Error(`${id}.md needs a description in its front matter`);
  const summary = description.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  return { id, title, summary, body };
}

const out = (file: string, text: string) => {
  mkdirSync(dirname(join(root, 'static', file)), { recursive: true });
  writeFileSync(join(root, 'static', file), text);
};

const index: string[] = [
  '# ZwoSocial Bot Platform',
  '',
  '> ZwoSocial is an end-to-end encrypted messenger. Bots are participants with their own device keys: the server only carries ciphertext and the bot decrypts on its own machine. The TypeScript SDK (`@zwosocial/bot`) and the Go SDK (`github.com/CreadorLanda/yo/sdk/go`) do the encryption, so a bot is a few handlers.',
  '',
  'Key facts for writing a bot:',
  '',
  '- Base URL `https://yo.alexandrelanda.com`; the Bot API is under `/api/bot/v1`, authenticated with `Authorization: Bot zsb_…`.',
  '- In groups a bot runs in privacy mode: it only receives commands, mentions, replies and clicks addressed to it. Full read (`messages.read.all`) is granted by an admin and announced to the group.',
  '- Never send plaintext: every message is a `soc1.` (pairwise) or `soc1g.` (group) envelope. Use the SDK.',
  '- Keep the token and the store file (`.zwosocial-bot.json`, holds the keys) secret; never log them or message contents.',
  '- Answer anything personal with a private reply (`replyPrivately`), and honour `user.data_deletion` within 30 days.',
  '- Limits: 600 requests a minute, 30 writes a minute per chat; the SDKs wait out `429`.',
  '',
  `The whole documentation in one file: [llms-full.txt](${site}llms-full.txt)`,
  '',
];
const full: string[] = [`# ZwoSocial Bot Platform — full documentation`, '', `Source: ${site}`, ''];
for (const s of sections) {
  index.push(`## ${s.label}`, '');
  for (const id of s.ids) {
    const p = page(id);
    out(`md/${id}.md`, p.body + '\n');
    index.push(`- [${p.title}](${site}md/${id}.md): ${p.summary}`);
    full.push(`<!-- ${id} -->`, '', p.body, '');
  }
  index.push('');
}
index.push('## Optional', '', `- [OpenAPI spec](${site}openapi/bot-api.yaml): the Bot API as OpenAPI 3.1`, '');
out('llms.txt', index.join('\n'));
out('llms-full.txt', full.join('\n'));
console.log(`llms.txt: ${sections.reduce((n, s) => n + s.ids.length, 0)} pages`);
