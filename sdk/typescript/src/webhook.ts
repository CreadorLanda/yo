import { createHmac, timingSafeEqual } from 'node:crypto';

import type { BotEvent } from './types.js';

/** How far a delivery's timestamp may be from this clock. */
export const SIGNATURE_WINDOW_SECONDS = 5 * 60;

/**
 * Check a webhook delivery came from ZwoSocial and is fresh: the HMAC over
 * `timestamp + "." + body` must match, and the timestamp must be within five
 * minutes — a captured request replayed later fails.
 */
export function verifySignature(
  secret: string,
  timestamp: string | null,
  body: string,
  signature: string | null,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > SIGNATURE_WINDOW_SECONDS) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A fetch-style handler (Bun.serve, Deno, Hono, Next route handlers…) that
 * verifies each delivery and hands the event on. Answers 401 to anything
 * unsigned or stale, 200 once `onEvent` has run.
 */
export function webhookHandler(secret: string, onEvent: (e: BotEvent) => Promise<void>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = await req.text();
    if (
      !verifySignature(secret, req.headers.get('x-zwosocial-timestamp'), body, req.headers.get('x-zwosocial-signature'))
    ) {
      return new Response('bad signature', { status: 401 });
    }
    await onEvent(JSON.parse(body) as BotEvent);
    return new Response('ok');
  };
}
