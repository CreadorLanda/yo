/** Shapes of the Bot API, as the SDK uses them. */

export type BotProfile = {
  id: string;
  username: string;
  display_name: string;
  description: string;
  privacy_mode: boolean;
  verified: boolean;
};

export type ChatMember = { user_id: string; username: string; display_name: string; is_bot: boolean; role: string };

export type OptionType = 'string' | 'number' | 'user' | 'datetime' | 'choice';

export type Choice = { name: string; value: string | number };

export type CommandOption = {
  name: string;
  description: string;
  description_pt?: string;
  type: OptionType;
  required?: boolean;
  choices?: Choice[];
  autocomplete?: boolean;
};

export type CommandDefinition = {
  name: string;
  description: string;
  description_pt?: string;
  options?: CommandOption[];
};

/** An event, as the gateway and webhooks deliver it. */
export type BotEvent = {
  id: number;
  type: string;
  chat_id?: string;
  data: unknown;
  created_at: string;
};

/** What a person's client sealed for the bot (#322). */
export type Update = {
  update_id: number;
  chat_id: string;
  sender_id: string;
  kind: 'command' | 'mention' | 'reply' | 'interaction';
  content: string;
  message_id?: number;
  created_at: string;
};

/** A message in a chat, as `message.created` carries it. */
export type ChatMessage = {
  id: number;
  chat_id: string;
  sender_id?: string;
  sender_name?: string;
  content: string;
  message_type: string;
  reply_to_id?: number;
  created_at: string;
};

// ── Interactive messages (#325) ─────────────────────────────────────────────

export type ButtonStyle = 'primary' | 'secondary' | 'danger' | 'link';

export type Component =
  | { type: 'button'; id?: string; label: string; style?: ButtonStyle; url?: string; disabled?: boolean }
  | {
      type: 'select';
      id: string;
      placeholder?: string;
      options: { label: string; value: string; description?: string }[];
      min?: number;
      max?: number;
      disabled?: boolean;
    }
  | { type: 'user_select'; id: string; placeholder?: string; max?: number; disabled?: boolean }
  | {
      type: 'form';
      id: string;
      title?: string;
      submit_label?: string;
      fields: {
        id: string;
        label: string;
        type: 'text' | 'number' | 'date' | 'choice';
        required?: boolean;
        placeholder?: string;
        choices?: { label: string; value: string }[];
      }[];
      disabled?: boolean;
    };

export type Card = {
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: string;
  footer?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
};

/** A reply: plain text, or text with a card and components. */
export type Reply =
  | string
  | { text?: string; card?: Card; components?: Component[][]; expires_at?: string };

/** Turn a reply into the message body the app reads. */
export function encodeReply(reply: Reply): string {
  if (typeof reply === 'string') return reply;
  if (!reply.card && !reply.components?.length) return reply.text ?? '';
  return JSON.stringify({ zi1: { text: reply.text ?? '', ...reply } });
}
