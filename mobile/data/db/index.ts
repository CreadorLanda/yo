import { open, isSQLCipher, type DB } from '@op-engineering/op-sqlite';

import { getDatabaseKey } from './key';
import { MIGRATIONS } from './schema';
import { splitStatements } from './split';

/**
 * The local database.
 *
 * Encrypted with SQLCipher, keyed from the OS keystore. Opening it is the
 * only place that key is used; everything downstream deals in plain rows.
 */

/**
 * Deliberately still `socialize.db`, after the project was renamed to Yo and then ZwoSocial.
 *
 * This filename is the address of every message already on someone's phone.
 * Changing it does not rename the file — it opens a new, empty database and
 * silently abandons the old one. Every conversation the person had would
 * vanish on update, with the data still sitting on disk where nothing looks
 * for it.
 *
 * A rename is possible, but it is a migration — open the old name, copy, then
 * delete — not a string edit. Not worth doing for tidiness.
 */
const DB_NAME = 'socialize.db';

let db: DB | null = null;
let opening: Promise<DB> | null = null;

/**
 * Why the local database is unavailable, if it is.
 *
 * Every caller wraps getDB in a catch, because a missing cache must never
 * break the screen. The cost is that a database that never opens is
 * indistinguishable from one that is merely empty: reads fall through to the
 * network and the only symptom is that nothing is ever fast. Recording the
 * reason once makes the difference inspectable.
 */
let failure: string | null = null;
let warned = false;

export function dbFailure(): string | null {
  return failure;
}

export async function getDB(): Promise<DB> {
  if (db) return db;
  if (opening) return opening;

  opening = (async () => {
    const encryptionKey = await getDatabaseKey();
    const handle = open({ name: DB_NAME, encryptionKey });

    // A build without the SQLCipher flag opens the file happily and stores
    // everything in the clear. Fail loudly rather than quietly shipping an
    // unencrypted history — the flag lives in package.json under
    // "op-sqlite" and only takes effect on a native rebuild.
    if (!isSQLCipher()) {
      throw new Error(
        'db_not_encrypted: this build lacks SQLCipher. Rebuild the dev client after setting "op-sqlite": { "sqlcipher": true }.',
      );
    }

    await migrate(handle);
    db = handle;
    return handle;
  })();

  try {
    const handle = await opening;
    failure = null;
    return handle;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    // Once per launch: a broken database is hit on every chat open, and a
    // warning per open would bury everything else in the log.
    if (!warned) {
      warned = true;
      console.error(
        `[db] local database unavailable — everything falls back to the network. ${failure}`,
      );
    }
    throw err;
  } finally {
    opening = null;
  }
}

/**
 * Run pending migrations inside a transaction, tracked by user_version.
 * Append-only: a shipped migration is never edited, only followed.
 */
async function migrate(handle: DB): Promise<void> {
  const res = await handle.execute('PRAGMA user_version');
  const current = Number(res.rows?.[0]?.user_version ?? 0);

  for (let i = current; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i];
    await handle.transaction(async (tx) => {
      for (const stmt of splitStatements(m.sql)) {
        await tx.execute(stmt);
      }
      // user_version cannot be parameterised.
      await tx.execute(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Close and forget the handle — used on logout before wiping the file. */
export async function closeDB(): Promise<void> {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  db = null;
}

export { DB_NAME };
