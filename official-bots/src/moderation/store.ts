import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { DEFAULTS, type Settings } from './policy';

/**
 * The Moderation bot's state: per-group settings, warnings, who it has
 * seen in each group (to tell joins apart), welcomes waiting for an
 * accept, bans it made, and one-time codes linking a log chat. Message
 * contents are never stored.
 */
export class ModerationStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (chat_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS warnings (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS warnings_by ON warnings (chat_id, user_id, at);
      CREATE TABLE IF NOT EXISTS members (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (chat_id, user_id));
      CREATE TABLE IF NOT EXISTS pending (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, message_id INTEGER, PRIMARY KEY (chat_id, user_id));
      CREATE TABLE IF NOT EXISTS bans (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, PRIMARY KEY (chat_id, user_id));
      CREATE TABLE IF NOT EXISTS link_codes (code TEXT PRIMARY KEY, chat_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
  }

  settings(chatId: string): Settings {
    const row = this.db.query<{ json: string }, [string]>('SELECT json FROM settings WHERE chat_id = ?').get(chatId);
    return { ...DEFAULTS, chatId, title: '', ...(row ? (JSON.parse(row.json) as Partial<Settings>) : {}) };
  }

  save(s: Settings): void {
    this.db
      .query('INSERT INTO settings (chat_id, json) VALUES (?, ?) ON CONFLICT (chat_id) DO UPDATE SET json = excluded.json')
      .run(s.chatId, JSON.stringify(s));
  }

  warn(chatId: string, userId: string, reason: string, now: number): number {
    this.db.query('INSERT INTO warnings (chat_id, user_id, at, reason) VALUES (?, ?, ?, ?)').run(chatId, userId, now, reason);
    this.db.query('DELETE FROM warnings WHERE at < ?').run(now - 30 * 86_400_000);
    return this.db
      .query<{ n: number }, [string, string, number]>('SELECT count(*) AS n FROM warnings WHERE chat_id = ? AND user_id = ? AND at > ?')
      .get(chatId, userId, now - 86_400_000)!.n;
  }

  /** The member ids last seen, or null the first time. */
  knownMembers(chatId: string): Set<string> | null {
    const rows = this.db.query<{ user_id: string }, [string]>('SELECT user_id FROM members WHERE chat_id = ?').all(chatId);
    const seen = this.db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM settings WHERE chat_id = ?').get(chatId)!.n;
    return rows.length || seen ? new Set(rows.map((r) => r.user_id)) : null;
  }

  setMembers(chatId: string, ids: string[]): void {
    const tx = this.db.transaction(() => {
      this.db.query('DELETE FROM members WHERE chat_id = ?').run(chatId);
      for (const id of ids) this.db.query('INSERT INTO members (chat_id, user_id) VALUES (?, ?)').run(chatId, id);
    });
    tx();
  }

  addPending(chatId: string, userId: string, messageId: number | null): void {
    this.db.query('INSERT OR REPLACE INTO pending (chat_id, user_id, message_id) VALUES (?, ?, ?)').run(chatId, userId, messageId);
  }

  takePending(chatId: string, userId: string): { messageId: number | null } | null {
    const row = this.db.query<{ message_id: number | null }, [string, string]>('SELECT message_id FROM pending WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
    if (!row) return null;
    this.db.query('DELETE FROM pending WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
    return { messageId: row.message_id };
  }

  recordBan(chatId: string, userId: string, username: string): void {
    this.db.query('INSERT OR REPLACE INTO bans (chat_id, user_id, username) VALUES (?, ?, ?)').run(chatId, userId, username);
  }

  bannedByName(chatId: string, username: string): string | null {
    return this.db.query<{ user_id: string }, [string, string]>('SELECT user_id FROM bans WHERE chat_id = ? AND lower(username) = lower(?)').get(chatId, username)?.user_id ?? null;
  }

  dropBan(chatId: string, userId: string): void {
    this.db.query('DELETE FROM bans WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  }

  newLinkCode(chatId: string, now: number): string {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    this.db.query('INSERT INTO link_codes (code, chat_id, expires_at) VALUES (?, ?, ?)').run(code, chatId, now + 15 * 60_000);
    return code;
  }

  useLinkCode(code: string, now: number): string | null {
    const row = this.db.query<{ chat_id: string; expires_at: number }, [string]>('SELECT chat_id, expires_at FROM link_codes WHERE code = ?').get(code.toUpperCase());
    this.db.query('DELETE FROM link_codes WHERE code = ? OR expires_at < ?').run(code.toUpperCase(), now);
    return row && row.expires_at > now ? row.chat_id : null;
  }

  removeChat(chatId: string): void {
    for (const t of ['settings', 'warnings', 'members', 'pending', 'bans', 'link_codes']) this.db.query(`DELETE FROM ${t} WHERE chat_id = ?`).run(chatId);
  }

  forget(userId: string): void {
    for (const t of ['warnings', 'pending', 'bans']) this.db.query(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
}
