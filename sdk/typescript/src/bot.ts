import { ApiClient } from './api.js';
import { DecryptError, E2EE, isEnvelope, isGroupEnvelope } from './crypto.js';
import { Gateway } from './gateway.js';
import { FileStore, MemoryStore, type Store } from './store.js';
import {
  encodeReply,
  type BotEvent,
  type BotProfile,
  type ChatMember,
  type ChatMessage,
  type Choice,
  type CommandDefinition,
  type Reply,
  type Update,
} from './types.js';
import { webhookHandler } from './webhook.js';

export type BotOptions = {
  /** The bot token from My bots (`zsb_…`). */
  token: string;
  /** The ZwoSocial server, e.g. https://api.zwosocial.example */
  apiUrl: string;
  /** Where keys and sessions live. Defaults to `./.zwosocial-bot.json`. */
  store?: Store;
  /** Event types to receive over the gateway; all by default. */
  intents?: string[];
  log?: (msg: string) => void;
};

/** Everything a handler needs about what happened, and how to answer. */
export class Context {
  constructor(
    readonly bot: Bot,
    /** The chat it happened in. */
    readonly chatId: string,
    /** Who did it. */
    readonly senderId: string,
    /** Whether the chat is a group (the reply is sealed with a sender key). */
    readonly isGroup: boolean,
    /** The words of the message or command. */
    readonly text: string,
    /** The message it is about, when there is one. */
    readonly messageId?: number,
    /** For a command: its name and options. */
    readonly command?: { name: string; options: Record<string, string> },
    /** For a click: which component, and what was picked or filled in. */
    readonly componentId?: string,
    readonly values?: string[] | Record<string, string>,
  ) {}

  /** Answer in the chat, encrypted, as a reply to the message when there is one. */
  reply(reply: Reply): Promise<{ id: number }> {
    return this.bot.send(this.chatId, reply, { isGroup: this.isGroup, to: this.senderId, replyToId: this.messageId });
  }

  /** Answer only the person who did it ("Only you can see this"). Never stored. */
  replyPrivately(reply: Reply): Promise<void> {
    return this.bot.sendEphemeral(this.chatId, this.senderId, reply);
  }

  /** Replace one of the bot's messages, e.g. to disable buttons after a click. */
  edit(messageId: number, reply: Reply): Promise<void> {
    return this.bot.edit(this.chatId, messageId, reply, { isGroup: this.isGroup, to: this.senderId });
  }

  react(emoji: string): Promise<unknown> {
    if (!this.messageId) return Promise.resolve();
    return this.bot.api.react(this.chatId, this.messageId, emoji);
  }
}

type Handler = (ctx: Context) => unknown | Promise<unknown>;
type AutocompleteHandler = (input: { value: string; ctx: Context }) => Choice[] | Promise<Choice[]>;

const SEQ_KEY = 'gateway:seq';

/**
 * A ZwoSocial bot.
 *
 * ```ts
 * const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL! });
 * bot.command('ping', (ctx) => ctx.reply('pong'));
 * await bot.start();
 * ```
 */
export class Bot {
  readonly api: ApiClient;
  readonly store: Store;
  e2ee!: E2EE;
  me!: BotProfile;

  private commands = new Map<string, Handler>();
  private interactions = new Map<string, Handler>();
  private autocompletes = new Map<string, AutocompleteHandler>();
  private messageHandlers: Handler[] = [];
  private eventHandlers = new Map<string, ((e: BotEvent) => unknown)[]>();
  private gateway: Gateway | null = null;
  private seq = 0;
  private ready: Promise<void> | null = null;
  private log: (msg: string) => void;
  private groupChats = new Map<string, boolean>();

  constructor(private readonly opts: BotOptions) {
    this.api = new ApiClient(opts.apiUrl, opts.token);
    this.store = opts.store ?? new FileStore('.zwosocial-bot.json');
    this.log = opts.log ?? ((m) => console.log(`[bot] ${m}`));
  }

  // ── Registration ──

  /** Answer `/name`. Options arrive parsed in `ctx.command.options`. */
  command(name: string, handler: Handler): this {
    this.commands.set(name.toLowerCase(), handler);
    return this;
  }

  /** Any message the bot can read: direct messages, mentions, replies, and a group's traffic with full read. */
  onMessage(handler: Handler): this {
    this.messageHandlers.push(handler);
    return this;
  }

  /** A click on a component with this id (`*` for any). */
  onInteraction(componentId: string, handler: Handler): this {
    this.interactions.set(componentId, handler);
    return this;
  }

  /** Suggestions while someone types an option registered with `autocomplete: true`. */
  onAutocomplete(command: string, option: string, handler: AutocompleteHandler): this {
    this.autocompletes.set(`${command}:${option}`, handler);
    return this;
  }

  /** Any raw event, e.g. `bot.installed` or `user.data_deletion`. */
  on(type: string, handler: (e: BotEvent) => unknown): this {
    this.eventHandlers.set(type, [...(this.eventHandlers.get(type) ?? []), handler]);
    return this;
  }

  /** Register the commands people see when they type `/`. */
  setCommands(commands: CommandDefinition[], chatId?: string): Promise<unknown> {
    return this.api.setCommands(commands, chatId);
  }

  // ── Lifecycle ──

  /** Sign in and publish the bot's keys. Safe to call more than once. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      this.me = await this.api.me();
      this.e2ee = new E2EE(this.store, this.me.id, this.api);
      await this.e2ee.publishKeys();
      this.seq = (await this.store.get<number>(SEQ_KEY)) ?? 0;
      this.log(`signed in as @${this.me.username}`);
    })();
    return this.ready;
  }

  /** Connect to the gateway and handle events until `stop()`. */
  async start(): Promise<void> {
    await this.init();
    const url = `${this.opts.apiUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/bot/v1/gateway`;
    this.gateway = new Gateway({
      url,
      token: this.opts.token,
      intents: this.opts.intents,
      resumeFrom: () => this.seq,
      onEvent: (e) => this.handle(e),
      onReady: () => this.log('gateway ready'),
      log: this.log,
    });
    this.gateway.start();
  }

  stop(): void {
    this.gateway?.stop();
  }

  /** Resolves when every event received so far has been handled. */
  idle(): Promise<void> {
    return this.gateway?.idle() ?? Promise.resolve();
  }

  /** A fetch-style handler for webhook deliveries, instead of the gateway. */
  webhook(secret: string): (req: Request) => Promise<Response> {
    return webhookHandler(secret, async (e) => {
      await this.init();
      await this.handle(e);
    });
  }

  // ── Dispatch ──

  /** Handle one event. Duplicates (resume, retried webhooks) are skipped. */
  async handle(event: BotEvent): Promise<void> {
    if (event.id <= this.seq && event.type !== 'ping') return;
    try {
      await this.dispatch(event);
    } finally {
      if (event.id > this.seq) {
        this.seq = event.id;
        await this.store.set(SEQ_KEY, this.seq);
      }
    }
  }

  private async dispatch(event: BotEvent): Promise<void> {
    for (const h of this.eventHandlers.get(event.type) ?? []) await h(event);
    switch (event.type) {
      case 'command.invoked':
      case 'interaction.created':
        return this.onUpdate(event.data as Update);
      case 'message.created':
        // Mentions and replies arrive as updates (kind mention/reply) in
        // privacy mode, and as messages in a direct chat or with full read.
        if ((event.data as { update_id?: number }).update_id) return this.onUpdate(event.data as Update);
        return this.onChatMessage(event.data as ChatMessage);
      case 'command.autocomplete':
        return this.onAutocompleteEvent(event);
    }
  }

  /**
   * Whether a chat is a group. Updates do not say, and the answer decides
   * how a reply is sealed (sender key or pairwise). Chats do not change type,
   * so it is asked once.
   */
  private async isGroupChat(chatId: string): Promise<boolean> {
    const known = this.groupChats.get(chatId);
    if (known !== undefined) return known;
    const group = (await this.api.chat(chatId)).type === 'group';
    this.groupChats.set(chatId, group);
    return group;
  }

  private async onUpdate(u: Update): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await this.e2ee.decrypt(u.sender_id, u.content)) as Record<string, unknown>;
    } catch (err) {
      this.log(`could not open an update from ${u.sender_id}: ${String(err)}`);
      return;
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    const messageId = typeof payload.message_id === 'number' ? payload.message_id : u.message_id;
    const isGroup = await this.isGroupChat(u.chat_id);
    if (payload.kind === 'interaction') {
      const componentId = String(payload.component_id ?? '');
      const ctx = new Context(this, u.chat_id, u.sender_id, isGroup, '', messageId, undefined, componentId,
        payload.values as string[] | Record<string, string> | undefined);
      const handler = this.interactions.get(componentId) ?? this.interactions.get('*');
      await handler?.(ctx);
      return;
    }
    const command = (payload.command as Context['command']) ?? parseInvocation(text) ?? undefined;
    const ctx = new Context(this, u.chat_id, u.sender_id, isGroup, text, messageId, command);
    await this.route(ctx);
  }

  private async onChatMessage(m: ChatMessage): Promise<void> {
    if (!m.sender_id || m.sender_id === this.me.id || m.message_type !== 'text') return;
    let body: string;
    try {
      if (isGroupEnvelope(m.content)) body = await this.e2ee.decryptGroup(m.chat_id, m.content);
      else if (isEnvelope(m.content)) body = await this.e2ee.decrypt(m.sender_id, m.content);
      else return;
    } catch (err) {
      if (!(err instanceof DecryptError)) throw err;
      this.log(`could not open message ${m.id}: ${err.message}`);
      return;
    }
    const text = textOf(body);
    const ctx = new Context(this, m.chat_id, m.sender_id, isGroupEnvelope(m.content), text, m.id, parseInvocation(text) ?? undefined);
    await this.route(ctx);
  }

  private async route(ctx: Context): Promise<void> {
    if (ctx.command) {
      const handler = this.commands.get(ctx.command.name);
      if (handler) {
        await handler(ctx);
        return;
      }
    }
    for (const h of this.messageHandlers) await h(ctx);
  }

  private async onAutocompleteEvent(e: BotEvent): Promise<void> {
    const d = e.data as { request_id: string; sender_id: string; command: string; option: string; content: string };
    const handler = this.autocompletes.get(`${d.command}:${d.option}`);
    if (!handler || !e.chat_id) return;
    let value = '';
    try {
      value = String((JSON.parse(await this.e2ee.decrypt(d.sender_id, d.content)) as { value?: unknown }).value ?? '');
    } catch {
      return;
    }
    const ctx = new Context(this, e.chat_id, d.sender_id, await this.isGroupChat(e.chat_id), value);
    const choices = await handler({ value, ctx });
    await this.api.answerAutocomplete(d.request_id, choices.slice(0, 25));
  }

  // ── Sending ──

  private async seal(chatId: string, body: string, opts: { isGroup: boolean; to?: string }): Promise<string> {
    if (!opts.isGroup) {
      if (!opts.to) throw new Error('a direct reply needs the person it goes to');
      return this.e2ee.encrypt(opts.to, body);
    }
    const epoch = await this.e2ee.syncGroupKeys(chatId);
    const members: ChatMember[] = await this.api.members(chatId);
    return this.e2ee.encryptForGroup(chatId, body, epoch, members);
  }

  /** Send a message to a chat. In a direct chat, `to` is the person. */
  async send(chatId: string, reply: Reply, opts: { isGroup: boolean; to?: string; replyToId?: number }): Promise<{ id: number }> {
    await this.init();
    const content = await this.seal(chatId, encodeReply(reply), opts);
    return this.api.sendMessage(chatId, content, { replyToId: opts.replyToId });
  }

  async edit(chatId: string, messageId: number, reply: Reply, opts: { isGroup: boolean; to?: string }): Promise<void> {
    await this.init();
    await this.api.editMessage(chatId, messageId, await this.seal(chatId, encodeReply(reply), opts));
  }

  async sendEphemeral(chatId: string, userId: string, reply: Reply): Promise<void> {
    await this.init();
    await this.api.ephemeral(chatId, userId, await this.e2ee.encrypt(userId, encodeReply(reply)));
  }
}

/** The words of a body, whatever card or preview rides with them. */
export function textOf(body: string): string {
  if (body.startsWith('{"zl1"') || body.startsWith('{"zi1"')) {
    try {
      const o = JSON.parse(body) as Record<string, { text?: string }>;
      return (o.zl1 ?? o.zi1)?.text ?? '';
    } catch {
      return body;
    }
  }
  return body;
}

/** `/remind@bot when:… what:"two words"` → name and options (same rules as the app). */
export function parseInvocation(text: string): { name: string; options: Record<string, string> } | null {
  const head = /^\/([a-z0-9_-]{1,32})(?:@([a-z0-9_]{3,32}))?(?=\s|$)/i.exec(text.trim());
  if (!head) return null;
  const options: Record<string, string> = {};
  const rest = text.trim().slice(head[0].length);
  const re = /([a-z0-9_-]{1,32}):(?:"((?:[^"\\]|\\.)*)"|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) options[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  return { name: head[1].toLowerCase(), options };
}

export { MemoryStore };
