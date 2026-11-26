import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Lang, Rule } from '../lib/time';

export type Task = {
  id: number;
  chatId: string;
  /** The number people see in this chat: #1, #2… */
  n: number;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: number | null;
  createdBy: string;
  createdAt: number;
  doneAt: number | null;
  doneBy: string | null;
  messageId: number | null;
  dueNotified: boolean;
};

export type Standup = {
  chatId: string;
  rule: Rule;
  tz: string;
  lang: Lang;
  /** How long answers are taken, in minutes, before the summary. */
  windowMin: number;
  nextAt: number;
};

export type Run = { id: number; chatId: string; startedAt: number; endsAt: number; messageId: number | null };
export type Answer = { userId: string; username: string; yesterday: string; today: string; blockers: string };

type TaskRow = {
  id: number;
  chat_id: string;
  n: number;
  title: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due_at: number | null;
  created_by: string;
  created_at: number;
  done_at: number | null;
  done_by: string | null;
  message_id: number | null;
  due_notified: number;
};

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  chatId: r.chat_id,
  n: r.n,
  title: r.title,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  dueAt: r.due_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  doneAt: r.done_at,
  doneBy: r.done_by,
  messageId: r.message_id,
  dueNotified: !!r.due_notified,
});

/**
 * Tasks, standups and digests. Standup answers are kept only until the
 * summary is posted.
 */
export class TaskStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL, n INTEGER NOT NULL, title TEXT NOT NULL,
        assignee_id TEXT, assignee_name TEXT, due_at INTEGER,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        done_at INTEGER, done_by TEXT, message_id INTEGER, due_notified INTEGER NOT NULL DEFAULT 0,
        UNIQUE (chat_id, n)
      );
      CREATE TABLE IF NOT EXISTS chats (chat_id TEXT PRIMARY KEY, is_group INTEGER NOT NULL, lang TEXT, tz TEXT, digest INTEGER NOT NULL DEFAULT 0, digest_next_at INTEGER);
      CREATE TABLE IF NOT EXISTS standups (chat_id TEXT PRIMARY KEY, rule TEXT NOT NULL, tz TEXT NOT NULL, lang TEXT NOT NULL, window_min INTEGER NOT NULL, next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, message_id INTEGER, closed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS answers (run_id INTEGER NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, yesterday TEXT NOT NULL, today TEXT NOT NULL, blockers TEXT NOT NULL, PRIMARY KEY (run_id, user_id));
    `);
  }

  // ── Chats ──

  chat(chatId: string): { isGroup: boolean; lang: Lang | null; tz: string | null; digest: boolean; digestNextAt: number | null } | null {
    const r = this.db
      .query<{ is_group: number; lang: string | null; tz: string | null; digest: number; digest_next_at: number | null }, [string]>('SELECT * FROM chats WHERE chat_id = ?')
      .get(chatId);
    return r ? { isGroup: !!r.is_group, lang: r.lang as Lang | null, tz: r.tz, digest: !!r.digest, digestNextAt: r.digest_next_at } : null;
  }

  touchChat(chatId: string, isGroup: boolean, patch: { lang?: Lang; tz?: string; digest?: boolean; digestNextAt?: number | null } = {}): void {
    const cur = this.chat(chatId);
    this.db
      .query('INSERT OR REPLACE INTO chats (chat_id, is_group, lang, tz, digest, digest_next_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(chatId, isGroup ? 1 : 0, patch.lang ?? cur?.lang ?? null, patch.tz ?? cur?.tz ?? null, (patch.digest ?? cur?.digest) ? 1 : 0, patch.digestNextAt !== undefined ? patch.digestNextAt : (cur?.digestNextAt ?? null));
  }

  digestsDue(now: number): string[] {
    return this.db.query<{ chat_id: string }, [number]>('SELECT chat_id FROM chats WHERE digest = 1 AND digest_next_at <= ?').all(now).map((r) => r.chat_id);
  }

  // ── Tasks ──

  addTask(t: Omit<Task, 'id' | 'n' | 'doneAt' | 'doneBy' | 'messageId' | 'dueNotified'>): Task {
    const n = (this.db.query<{ m: number | null }, [string]>('SELECT max(n) AS m FROM tasks WHERE chat_id = ?').get(t.chatId)?.m ?? 0) + 1;
    const r = this.db
      .query<{ id: number }, [string, number, string, string | null, string | null, number | null, string, number]>(
        'INSERT INTO tasks (chat_id, n, title, assignee_id, assignee_name, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      )
      .get(t.chatId, n, t.title, t.assigneeId, t.assigneeName, t.dueAt, t.createdBy, t.createdAt)!;
    return this.task(r.id)!;
  }

  task(id: number): Task | null {
    const r = this.db.query<TaskRow, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
    return r ? toTask(r) : null;
  }

  byNumber(chatId: string, n: number): Task | null {
    const r = this.db.query<TaskRow, [string, number]>('SELECT * FROM tasks WHERE chat_id = ? AND n = ?').get(chatId, n);
    return r ? toTask(r) : null;
  }

  open(chatId: string): Task[] {
    return this.db
      .query<TaskRow, [string]>('SELECT * FROM tasks WHERE chat_id = ? AND done_at IS NULL ORDER BY due_at IS NULL, due_at, n')
      .all(chatId)
      .map(toTask);
  }

  doneSince(chatId: string, since: number): Task[] {
    return this.db.query<TaskRow, [string, number]>('SELECT * FROM tasks WHERE chat_id = ? AND done_at >= ? ORDER BY done_at').all(chatId, since).map(toTask);
  }

  setMessage(id: number, messageId: number): void {
    this.db.query('UPDATE tasks SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  complete(id: number, by: string, at: number): void {
    this.db.query('UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ? AND done_at IS NULL').run(at, by, id);
  }

  assign(id: number, userId: string, name: string): void {
    this.db.query('UPDATE tasks SET assignee_id = ?, assignee_name = ? WHERE id = ?').run(userId, name, id);
  }

  dueToNotify(now: number): Task[] {
    return this.db.query<TaskRow, [number]>('SELECT * FROM tasks WHERE done_at IS NULL AND due_notified = 0 AND due_at IS NOT NULL AND due_at <= ?').all(now).map(toTask);
  }

  markNotified(id: number): void {
    this.db.query('UPDATE tasks SET due_notified = 1 WHERE id = ?').run(id);
  }

  // ── Standups ──

  standup(chatId: string): Standup | null {
    const r = this.db
      .query<{ rule: string; tz: string; lang: string; window_min: number; next_at: number }, [string]>('SELECT * FROM standups WHERE chat_id = ?')
      .get(chatId);
    return r ? { chatId, rule: JSON.parse(r.rule) as Rule, tz: r.tz, lang: r.lang as Lang, windowMin: r.window_min, nextAt: r.next_at } : null;
  }

  saveStandup(s: Standup): void {
    this.db
      .query('INSERT OR REPLACE INTO standups (chat_id, rule, tz, lang, window_min, next_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.chatId, JSON.stringify(s.rule), s.tz, s.lang, s.windowMin, s.nextAt);
  }

  dropStandup(chatId: string): void {
    this.db.query('DELETE FROM standups WHERE chat_id = ?').run(chatId);
  }

  standupsDue(now: number): Standup[] {
    return this.db
      .query<{ chat_id: string }, [number]>('SELECT chat_id FROM standups WHERE next_at <= ?')
      .all(now)
      .map((r) => this.standup(r.chat_id)!);
  }

  startRun(chatId: string, at: number, endsAt: number): Run {
    const r = this.db.query<{ id: number }, [string, number, number]>('INSERT INTO runs (chat_id, started_at, ends_at) VALUES (?, ?, ?) RETURNING id').get(chatId, at, endsAt)!;
    return { id: r.id, chatId, startedAt: at, endsAt, messageId: null };
  }

  setRunMessage(id: number, messageId: number): void {
    this.db.query('UPDATE runs SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  run(id: number): (Run & { closed: boolean }) | null {
    const r = this.db
      .query<{ id: number; chat_id: string; started_at: number; ends_at: number; message_id: number | null; closed: number }, [number]>('SELECT * FROM runs WHERE id = ?')
      .get(id);
    return r ? { id: r.id, chatId: r.chat_id, startedAt: r.started_at, endsAt: r.ends_at, messageId: r.message_id, closed: !!r.closed } : null;
  }

  runsToClose(now: number): Run[] {
    return this.db
      .query<{ id: number }, [number]>('SELECT id FROM runs WHERE closed = 0 AND ends_at <= ?')
      .all(now)
      .map((r) => this.run(r.id)!);
  }

  answer(runId: number, a: Answer): void {
    this.db
      .query('INSERT OR REPLACE INTO answers (run_id, user_id, username, yesterday, today, blockers) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, a.userId, a.username, a.yesterday, a.today, a.blockers);
  }

  answers(runId: number): Answer[] {
    return this.db
      .query<{ user_id: string; username: string; yesterday: string; today: string; blockers: string }, [number]>('SELECT * FROM answers WHERE run_id = ?')
      .all(runId)
      .map((r) => ({ userId: r.user_id, username: r.username, yesterday: r.yesterday, today: r.today, blockers: r.blockers }));
  }

  /** The summary is out: answers are not kept. */
  closeRun(id: number): void {
    this.db.query('UPDATE runs SET closed = 1 WHERE id = ?').run(id);
    this.db.query('DELETE FROM answers WHERE run_id = ?').run(id);
  }

  removeChat(chatId: string): void {
    this.db.query('DELETE FROM answers WHERE run_id IN (SELECT id FROM runs WHERE chat_id = ?)').run(chatId);
    for (const t of ['tasks', 'chats', 'standups', 'runs']) this.db.query(`DELETE FROM ${t} WHERE chat_id = ?`).run(chatId);
  }

  forget(userId: string): void {
    this.db.query('DELETE FROM answers WHERE user_id = ?').run(userId);
    this.db.query('DELETE FROM tasks WHERE created_by = ?').run(userId);
    this.db.query("UPDATE tasks SET assignee_id = NULL, assignee_name = NULL WHERE assignee_id = ?").run(userId);
    this.db.query('UPDATE tasks SET done_by = NULL WHERE done_by = ?').run(userId);
  }
}
