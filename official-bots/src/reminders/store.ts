import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Lang, Quiet, Rule } from '../lib/time';

/** Who a job is for: the person who set it, someone else, or the whole chat. */
export type Target = { kind: 'me' | 'user'; userId: string; username: string } | { kind: 'here' };

export type Job = {
  id: string;
  chatId: string;
  isGroup: boolean;
  creatorId: string;
  /** 'reminder' mentions its target; 'message' is posted as written. */
  kind: 'reminder' | 'message';
  target: Target;
  text: string;
  rule: Rule | null;
  tz: string;
  lang: Lang;
  nextAt: number;
  /** This occurrence was moved out of the target's quiet hours. */
  postponed: boolean;
  createdAt: number;
};

export type Settings = { userId: string; tz: string | null; quiet: Quiet | null; lang: Lang | null };

type JobRow = {
  id: string;
  chat_id: string;
  is_group: number;
  creator_id: string;
  kind: string;
  target: string;
  text: string;
  rule: string | null;
  tz: string;
  lang: string;
  next_at: number;
  postponed: number;
  created_at: number;
};

const toJob = (r: JobRow): Job => ({
  id: r.id,
  chatId: r.chat_id,
  isGroup: !!r.is_group,
  creatorId: r.creator_id,
  kind: r.kind as Job['kind'],
  target: JSON.parse(r.target) as Target,
  text: r.text,
  rule: r.rule ? (JSON.parse(r.rule) as Rule) : null,
  tz: r.tz,
  lang: r.lang as Lang,
  nextAt: r.next_at,
  postponed: !!r.postponed,
  createdAt: r.created_at,
});

/** Jobs and per-person settings, in SQLite so a restart loses nothing. */
export class ReminderStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        is_group INTEGER NOT NULL,
        creator_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        target_user TEXT,
        text TEXT NOT NULL,
        rule TEXT,
        tz TEXT NOT NULL,
        lang TEXT NOT NULL,
        next_at INTEGER NOT NULL,
        postponed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs (next_at);
      CREATE INDEX IF NOT EXISTS jobs_chat ON jobs (chat_id);
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT PRIMARY KEY,
        tz TEXT,
        quiet_from INTEGER,
        quiet_to INTEGER,
        lang TEXT
      );
    `);
    // Added after the first release; older databases get the column here.
    try {
      this.db.exec('ALTER TABLE settings ADD COLUMN tz_hinted INTEGER NOT NULL DEFAULT 0');
    } catch {
      // already there
    }
  }

  /** Whether this person was already told how to set their time zone. */
  hintedTz(userId: string): boolean {
    return !!this.db.query<{ h: number }, [string]>('SELECT tz_hinted AS h FROM settings WHERE user_id = ?').get(userId)?.h;
  }

  markHintedTz(userId: string): void {
    this.db
      .query('INSERT INTO settings (user_id, tz_hinted) VALUES (?, 1) ON CONFLICT (user_id) DO UPDATE SET tz_hinted = 1')
      .run(userId);
  }

  add(job: Job): void {
    this.db
      .query(
        `INSERT INTO jobs (id, chat_id, is_group, creator_id, kind, target, target_user, text, rule, tz, lang, next_at, postponed, created_at)
         VALUES ($id, $chat, $group, $creator, $kind, $target, $targetUser, $text, $rule, $tz, $lang, $next, $postponed, $created)`,
      )
      .run({
        id: job.id,
        chat: job.chatId,
        group: job.isGroup ? 1 : 0,
        creator: job.creatorId,
        kind: job.kind,
        target: JSON.stringify(job.target),
        targetUser: job.target.kind === 'here' ? null : job.target.userId,
        text: job.text,
        rule: job.rule ? JSON.stringify(job.rule) : null,
        tz: job.tz,
        lang: job.lang,
        next: job.nextAt,
        postponed: job.postponed ? 1 : 0,
        created: job.createdAt,
      });
  }

  get(id: string): Job | null {
    const r = this.db.query<JobRow, [string]>('SELECT * FROM jobs WHERE id = ?').get(id);
    return r ? toJob(r) : null;
  }

  due(now: number, limit = 100): Job[] {
    return this.db.query<JobRow, [number, number]>('SELECT * FROM jobs WHERE next_at <= ? ORDER BY next_at LIMIT ?').all(now, limit).map(toJob);
  }

  inChat(chatId: string): Job[] {
    return this.db.query<JobRow, [string]>('SELECT * FROM jobs WHERE chat_id = ? ORDER BY next_at').all(chatId).map(toJob);
  }

  countByCreator(creatorId: string): number {
    return this.db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM jobs WHERE creator_id = ?').get(creatorId)!.n;
  }

  reschedule(id: string, nextAt: number, postponed: boolean): void {
    this.db.query('UPDATE jobs SET next_at = ?, postponed = ? WHERE id = ?').run(nextAt, postponed ? 1 : 0, id);
  }

  remove(id: string): void {
    this.db.query('DELETE FROM jobs WHERE id = ?').run(id);
  }

  removeChat(chatId: string): number {
    return this.db.query('DELETE FROM jobs WHERE chat_id = ?').run(chatId).changes;
  }

  /** A deletion request: everything set by or for this person. */
  forget(userId: string): void {
    this.db.query('DELETE FROM jobs WHERE creator_id = ? OR target_user = ?').run(userId, userId);
    this.db.query('DELETE FROM settings WHERE user_id = ?').run(userId);
  }

  settings(userId: string): Settings {
    const r = this.db
      .query<{ tz: string | null; quiet_from: number | null; quiet_to: number | null; lang: string | null }, [string]>(
        'SELECT tz, quiet_from, quiet_to, lang FROM settings WHERE user_id = ?',
      )
      .get(userId);
    return {
      userId,
      tz: r?.tz ?? null,
      quiet: r?.quiet_from != null && r.quiet_to != null ? { from: r.quiet_from, to: r.quiet_to } : null,
      lang: (r?.lang as Lang | null) ?? null,
    };
  }

  saveSettings(s: Settings): void {
    this.db
      .query(
        `INSERT INTO settings (user_id, tz, quiet_from, quiet_to, lang) VALUES ($user, $tz, $from, $to, $lang)
         ON CONFLICT (user_id) DO UPDATE SET tz = $tz, quiet_from = $from, quiet_to = $to, lang = $lang`,
      )
      .run({ user: s.userId, tz: s.tz, from: s.quiet?.from ?? null, to: s.quiet?.to ?? null, lang: s.lang });
  }
}
