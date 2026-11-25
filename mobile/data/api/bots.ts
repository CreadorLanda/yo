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
