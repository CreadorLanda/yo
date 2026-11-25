import { submitBotUpdate } from '@/data/api/bots';
import { interactionPayload } from '@/data/bot-message';
import { encryptForPeerOrFail } from '@/data/crypto';

/**
 * A click on a bot's button, menu or form (#325), sent to that bot alone in
 * a pairwise envelope — the same inbox commands use (#322). The server
 * learns that someone interacted, not with what.
 */
export async function sendInteraction(input: {
  chatId: string;
  botId: string;
  botUsername: string;
  messageId: string;
  componentId: string;
  values?: string[] | Record<string, string>;
}): Promise<void> {
  const serverId = Number(input.messageId);
  const content = await encryptForPeerOrFail(
    input.botId,
    interactionPayload({ messageId: Number.isFinite(serverId) ? serverId : input.messageId, componentId: input.componentId, values: input.values }),
    { peerUsername: input.botUsername },
  );
  await submitBotUpdate(input.chatId, input.botId, {
    kind: 'interaction',
    content,
    ...(Number.isFinite(serverId) ? { message_id: serverId } : {}),
  });
}
