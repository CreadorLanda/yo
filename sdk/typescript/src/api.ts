import type { KeyServer, PreKeyBundle, SenderKeyEntry, UploadKeysRequest } from './crypto.js';
import type { BotProfile, ChatMember, Choice, CommandDefinition } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(`${status} ${code}${detail ? `: ${detail}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Bot API over HTTP. Rate limits are handled here: a `429` waits for
 * `Retry-After` and tries again, and a `5xx` or network failure backs off
 * (0.5 s, 1 s, 2 s…), up to `maxRetries` times.
 */
export class ApiClient implements KeyServer {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly maxRetries = 4,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/bot/v1${path}`, {
          method,
          headers: {
            Authorization: `Bot ${this.token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (attempt++ >= this.maxRetries) throw err;
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (res.status === 429 && attempt++ < this.maxRetries) {
        const retry = Number(res.headers.get('retry-after') ?? '1');
        await sleep(Math.max(1, retry) * 1000);
        continue;
      }
      if (res.status >= 500 && res.status !== 503 && attempt++ < this.maxRetries) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : undefined;
      if (!res.ok) {
        const e = (data ?? {}) as { error?: string; detail?: string };
        throw new ApiError(res.status, e.error ?? `http_${res.status}`, e.detail);
      }
      return data as T;
    }
  }

  me() {
    return this.request<BotProfile>('GET', '/me');
  }

  // KeyServer
  uploadKeys(body: UploadKeysRequest) {
    return this.request<{ one_time_remaining: number }>('PUT', '/keys', body);
  }
  bundle(username: string) {
    return this.request<PreKeyBundle>('GET', `/users/by-username/${encodeURIComponent(username)}/keys`);
  }
  fetchSenderKeys(chatId: string) {
    return this.request<{ epoch: number; keys: SenderKeyEntry[] | null }>('GET', `/groups/${chatId}/sender-keys`);
  }
  async publishSenderKeys(chatId: string, epoch: number, entries: { user_id: string; ciphertext: string }[]) {
    await this.request('POST', `/groups/${chatId}/sender-keys`, { epoch, entries });
  }

  /** Direct or group; for a group, its title and what the admins allowed the bot. */
  chat(chatId: string) {
    return this.request<{ id: string; type: 'direct' | 'group'; title?: string; scopes?: string[] }>('GET', `/chats/${chatId}`);
  }

  // Moderation (#333): needs members.manage; never works on admins or moderators.
  mute(chatId: string, userId: string, seconds: number, reason?: string) {
    return this.request('POST', `/chats/${chatId}/moderation/members/${userId}/mute`, { seconds, reason });
  }
  unmute(chatId: string, userId: string) {
    return this.request('DELETE', `/chats/${chatId}/moderation/members/${userId}/mute`);
  }
  kick(chatId: string, userId: string, reason?: string) {
    return this.request('POST', `/chats/${chatId}/moderation/members/${userId}/kick`, { reason });
  }
  ban(chatId: string, userId: string, reason?: string) {
    return this.request('POST', `/chats/${chatId}/moderation/members/${userId}/ban`, { reason });
  }
  unban(chatId: string, userId: string) {
    return this.request('DELETE', `/chats/${chatId}/moderation/members/${userId}/ban`);
  }
  /** Deletes a member's message for everyone. */
  deleteAsModerator(chatId: string, messageId: number) {
    return this.request('DELETE', `/chats/${chatId}/moderation/messages/${messageId}`);
  }
  members(chatId: string) {
    return this.request<ChatMember[]>('GET', `/chats/${chatId}/members`);
  }
  sendMessage(chatId: string, content: string, opts: { replyToId?: number; messageType?: string } = {}) {
    return this.request<{ id: number }>('POST', `/chats/${chatId}/messages`, {
      content,
      message_type: opts.messageType ?? 'text',
      ...(opts.replyToId ? { reply_to_id: opts.replyToId } : {}),
    });
  }
  editMessage(chatId: string, messageId: number, content: string) {
    return this.request('PATCH', `/chats/${chatId}/messages/${messageId}`, { content });
  }
  deleteMessage(chatId: string, messageId: number) {
    return this.request('DELETE', `/chats/${chatId}/messages/${messageId}`);
  }
  react(chatId: string, messageId: number, emoji: string) {
    return this.request('POST', `/chats/${chatId}/messages/${messageId}/reactions`, { emoji });
  }
  ephemeral(chatId: string, userId: string, content: string) {
    return this.request('POST', `/chats/${chatId}/ephemeral`, { user_id: userId, content });
  }
  setCommands(commands: CommandDefinition[], chatId?: string) {
    return this.request('PUT', chatId ? `/chats/${chatId}/commands` : '/commands', { commands });
  }
  answerAutocomplete(requestId: string, choices: Choice[]) {
    return this.request('POST', `/autocomplete/${requestId}`, { choices });
  }
  updates(offset: number) {
    return this.request<unknown[]>('GET', `/updates?offset=${offset}`);
  }
}
