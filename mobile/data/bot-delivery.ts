import { submitBotUpdate } from '@/data/api/bots';
import { routeToBots } from '@/data/bot-routing';
import { chatBots } from '@/data/bot-store';
import { encryptForPeerOrFail } from '@/data/crypto';

/**
 * Sending to bots in privacy mode (#322, ADR 0002).
 *
 * The group message goes out as usual. Then each bot it is addressed to gets
 * its own pairwise envelope, the same `soc1.` a direct message uses, carrying
 * the text and what it refers to. The server stores it in the bot's inbox
 * without being able to open it.
 */

/**
 * Deliver a just-sent group message to the bots it addresses. Never throws:
 * a bot that cannot be reached must not make the person's message fail.
 */
export async function deliverToBots(input: {
  chatId: string;
  text: string;
  messageId?: number;
  replyToId?: number;
  replyToSenderId?: string | null;
}): Promise<void> {
  try {
    const bots = await chatBots(input.chatId);
    const routes = routeToBots({ text: input.text, bots, replyToSenderId: input.replyToSenderId });
    for (const route of routes) {
      try {
        const body = JSON.stringify({
          v: 1,
          kind: route.kind,
          text: input.text,
          message_id: input.messageId,
          reply_to_id: input.replyToId,
        });
        const content = await encryptForPeerOrFail(route.botId, body, { peerUsername: route.username });
        await submitBotUpdate(input.chatId, route.botId, {
          kind: route.kind,
          content,
          message_id: input.messageId,
        });
      } catch (err) {
        console.warn('[bots] could not reach', route.username, err);
      }
    }
  } catch (err) {
    console.warn('[bots] delivery skipped', err);
  }
}
