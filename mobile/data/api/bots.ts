import { api } from './client';

/** What a chat granted a bot (#321, ADR 0002). */
export type BotScope =
  | 'messages.read.commands'
  | 'messages.read.all'
  | 'messages.send'
  | 'members.read'
  | 'members.manage'
  | 'events.manage';

export type BotDTO = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  description: string;
  privacy_mode: boolean;
  verified: boolean;
  owner_id: string;
  created_at: string;
};

export type BotInstallationDTO = {
  chat_id: string;
  bot: BotDTO;
  scopes: BotScope[];
  installed_by?: string;
  created_at: string;
};

export type BotUpdateKind = 'command' | 'mention' | 'reply' | 'interaction';

export function listChatBots(chatId: string) {
  return api.get<BotInstallationDTO[]>(`/api/chats/${chatId}/bots`);
}

/** Hand a bot the pairwise envelope addressed to it. */
export function submitBotUpdate(
  chatId: string,
  botId: string,
  body: { kind: BotUpdateKind; content: string; message_id?: number },
) {
  return api.post<{ update_id: number }>(`/api/chats/${chatId}/bots/${botId}/updates`, body);
}

// ── Owner: making and running bots (#328) ───────────────────────────────────

export type BotTokenDTO = { id: string; prefix: string; created_at: string; last_used_at?: string };
/** The one response that carries a token's secret. */
export type CreatedBotTokenDTO = BotTokenDTO & { token: string };

export type BotEventType =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'message.reaction'
  | 'command.invoked'
  | 'interaction.created'
  | 'members.changed'
  | 'bot.installed'
  | 'bot.removed'
  | 'ping';

export type BotWebhookDTO = {
  url: string;
  intents: BotEventType[];
  has_secret: boolean;
  /** Only in the reply that made or rotated it. */
  secret?: string;
};

export type BotDeliveryDTO = {
  id: number;
  event_id: number;
  event_type: BotEventType;
  status: 'pending' | 'delivered' | 'dead';
  attempts: number;
  last_status?: number;
  last_error?: string;
  created_at: string;
  delivered_at?: string;
};

export function createBot(body: { username: string; display_name: string; description?: string }) {
  return api.post<{ bot: BotDTO; token: CreatedBotTokenDTO }>('/api/bots', body);
}

export function listMyBots() {
  return api.get<BotDTO[]>('/api/bots');
}

export function getBot(idOrUsername: string) {
  return api.get<BotDTO>(`/api/bots/${encodeURIComponent(idOrUsername)}`);
}

export function updateBot(
  id: string,
  body: { display_name?: string; description?: string; avatar_url?: string; privacy_mode?: boolean },
) {
  return api.patch<BotDTO>(`/api/bots/${id}`, body);
}

export function deleteBot(id: string) {
  return api.del<void>(`/api/bots/${id}`);
}

export function listBotTokens(id: string) {
  return api.get<BotTokenDTO[]>(`/api/bots/${id}/tokens`);
}

/** A new secret; every previous token stops working. */
export function rotateBotToken(id: string) {
  return api.post<CreatedBotTokenDTO>(`/api/bots/${id}/tokens`, {});
}

export function revokeBotTokens(id: string) {
  return api.del<void>(`/api/bots/${id}/tokens`);
}

export function getBotWebhook(id: string) {
  return api.get<BotWebhookDTO>(`/api/bots/${id}/webhook`);
}

export function setBotWebhook(id: string, body: { url: string; intents?: BotEventType[] }) {
  return api.put<BotWebhookDTO>(`/api/bots/${id}/webhook`, body);
}

export function clearBotWebhook(id: string) {
  return api.del<void>(`/api/bots/${id}/webhook`);
}

export function rotateBotWebhookSecret(id: string) {
  return api.post<BotWebhookDTO>(`/api/bots/${id}/webhook/secret`, {});
}

export function listBotDeliveries(id: string) {
  return api.get<BotDeliveryDTO[]>(`/api/bots/${id}/deliveries`);
}

export function sendBotTestEvent(id: string) {
  return api.post<void>(`/api/bots/${id}/test-event`, {});
}

/** Open (or find) your direct chat with a bot. */
export function openBotDirect(id: string) {
  return api.post<{ chat_id: string }>(`/api/bots/${id}/dm`, {});
}

// ── A bot in a chat (#326) ──────────────────────────────────────────────────

export function installBot(chatId: string, body: { bot_id?: string; username?: string; scopes?: BotScope[] }) {
  return api.post<BotInstallationDTO>(`/api/chats/${chatId}/bots`, body);
}

export function updateBotScopes(chatId: string, botId: string, scopes: BotScope[]) {
  return api.patch<BotInstallationDTO>(`/api/chats/${chatId}/bots/${botId}`, { scopes });
}

export function uninstallBot(chatId: string, botId: string) {
  return api.del<void>(`/api/chats/${chatId}/bots/${botId}`);
}

// ── Slash commands (#324) ───────────────────────────────────────────────────

export function listChatCommands(chatId: string) {
  return api.get<import('@/data/bot-commands').ChatCommand[]>(`/api/chats/${chatId}/commands`);
}

/** Ask a bot for choices; `content` is the typed value sealed for the bot. */
export function requestAutocomplete(
  chatId: string,
  botId: string,
  body: { command: string; option: string; content: string },
) {
  return api.post<{ choices: import('@/data/bot-commands').CommandChoice[] }>(
    `/api/chats/${chatId}/bots/${botId}/autocomplete`,
    body,
  );
}
