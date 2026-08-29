import { getDB } from './index';

/**
 * Theme storage.
 *
 * Two shapes, because they change at different rates. A pack is a document —
 * written whole when someone saves the editor, read once at launch. A pref is
 * a single choice — the active theme, the installed set — rewritten on every
 * tap. Keeping them apart means applying a theme does not rewrite every pack
 * the person owns.
 *
 * Only *owned* packs are stored. The bundled ones ship with the app: writing
 * them here would freeze a copy that stops getting updates, and the row would
 * outlive a pack we later remove.
 */

export type StoredPack = { id: string; json: string; createdAt: string };

export async function listStoredPacks(): Promise<StoredPack[]> {
  const db = await getDB();
  const res = await db.execute(
    'SELECT id, json, created_at FROM theme_packs ORDER BY created_at ASC',
  );
  const rows = (res.rows ?? []) as { id: string; json: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, json: r.json, createdAt: r.created_at }));
}

export async function saveStoredPack(id: string, json: string): Promise<void> {
  const db = await getDB();
  await db.execute(
    `INSERT INTO theme_packs (id, json, created_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
    [id, json, new Date().toISOString()],
  );
}

export async function deleteStoredPack(id: string): Promise<void> {
  const db = await getDB();
  await db.execute('DELETE FROM theme_packs WHERE id = ?', [id]);
}

export async function readThemePrefs(): Promise<Record<string, string>> {
  const db = await getDB();
  const res = await db.execute('SELECT key, value FROM theme_prefs');
  const rows = (res.rows ?? []) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/**
 * Write the whole pref set in one transaction.
 *
 * Per-key writes would leave the theme half-applied if the app died between
 * them — installed without active, or active pointing at a pack the installed
 * set no longer contains. They are one decision and they land together.
 */
export async function writeThemePrefs(prefs: Record<string, string>): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(prefs)) {
      await tx.execute(
        `INSERT INTO theme_prefs (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      );
    }
  });
}
