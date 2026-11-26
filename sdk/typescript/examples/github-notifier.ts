/**
 * GitHub notifier: `/subscribe` in a chat, then point a GitHub webhook
 * (content type JSON, with a secret) at this server; pushes, pull requests,
 * issues and releases are posted as cards.
 *
 *   BOT_TOKEN=zsb_… API_URL=https://yo.alexandrelanda.com GITHUB_WEBHOOK_SECRET=… PORT=3000 \
 *     bun examples/github-notifier.ts
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Bot, type Reply } from '../src/index';

type Sub = { chatId: string; isGroup: boolean; by: string };

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL! });
const secret = process.env.GITHUB_WEBHOOK_SECRET!;
const subs = async () => ((await bot.store.get('subs')) as Sub[] | undefined) ?? [];

await bot.setCommands([
  { name: 'subscribe', description: 'Post GitHub activity here', description_pt: 'Publicar a actividade do GitHub aqui', options: [] },
  { name: 'unsubscribe', description: 'Stop posting GitHub activity here', description_pt: 'Deixar de publicar aqui', options: [] },
]);

bot.command('subscribe', async (ctx) => {
  const all = (await subs()).filter((s) => s.chatId !== ctx.chatId);
  await bot.store.set('subs', [...all, { chatId: ctx.chatId, isGroup: ctx.isGroup, by: ctx.senderId }]);
  return ctx.reply('✅ GitHub activity will be posted here.');
});

bot.command('unsubscribe', async (ctx) => {
  await bot.store.set('subs', (await subs()).filter((s) => s.chatId !== ctx.chatId));
  return ctx.reply('Stopped posting GitHub activity here.');
});

// Payload shapes: https://docs.github.com/webhooks/webhook-events-and-payloads
type Gh = Record<string, any>;
function describe(event: string, p: Gh): Reply | null {
  const repo = p.repository?.full_name ?? '';
  const link = (url: string) => [[{ type: 'button' as const, label: 'Open on GitHub', style: 'link' as const, url }]];
  switch (event) {
    case 'push': {
      if (!p.commits?.length) return null;
      const branch = String(p.ref).replace('refs/heads/', '');
      return {
        text: `${p.pusher?.name} pushed ${p.commits.length} commit(s) to ${repo}:${branch}`,
        card: { title: `${repo} · ${branch}`, description: p.commits.slice(0, 5).map((c: Gh) => `• ${String(c.message).split('\n')[0]}`).join('\n'), color: 'info' },
        components: link(p.compare),
      };
    }
    case 'pull_request': {
      const pr = p.pull_request;
      const what = p.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : p.action;
      if (!['opened', 'merged', 'closed', 'reopened', 'ready_for_review'].includes(what)) return null;
      return {
        text: `PR #${pr.number} ${what}: ${pr.title}`,
        card: { title: `#${pr.number} ${pr.title}`, description: `${repo} · ${what} by ${p.sender?.login}`, color: what === 'merged' ? 'success' : 'primary' },
        components: link(pr.html_url),
      };
    }
    case 'issues':
      if (!['opened', 'closed', 'reopened'].includes(p.action)) return null;
      return {
        text: `Issue #${p.issue.number} ${p.action}: ${p.issue.title}`,
        card: { title: `#${p.issue.number} ${p.issue.title}`, description: `${repo} · ${p.action} by ${p.sender?.login}`, color: p.action === 'closed' ? 'success' : 'warning' },
        components: link(p.issue.html_url),
      };
    case 'release':
      if (p.action !== 'published') return null;
      return { text: `🚀 ${repo} ${p.release.tag_name} released`, card: { title: p.release.name || p.release.tag_name, color: 'success' }, components: link(p.release.html_url) };
  }
  return null;
}

function signed(body: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/github') return new Response('not found', { status: 404 });
    const body = await req.text();
    if (!signed(body, req.headers.get('x-hub-signature-256'))) return new Response('bad signature', { status: 401 });
    const reply = describe(req.headers.get('x-github-event') ?? '', JSON.parse(body) as Gh);
    if (reply) {
      for (const s of await subs()) {
        await bot.send(s.chatId, reply, { isGroup: s.isGroup, to: s.by }).catch((err) => console.error(err));
      }
    }
    return new Response('ok');
  },
});

await bot.start();
