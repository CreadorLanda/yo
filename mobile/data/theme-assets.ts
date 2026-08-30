import { Directory, File, Paths } from 'expo-file-system';

/**
 * Images a theme owns: photo wallpapers and custom icons.
 *
 * The picker hands back a URI in the OS cache — `.../Caches/ImagePicker/...`
 * on iOS, a content:// grant on Android. Storing that string is the same bug
 * as storing nothing: the row survives, the file does not, and the theme
 * comes back with a wallpaper that renders as a grey rectangle once the
 * system reclaims the cache. So the bytes are copied somewhere the app owns
 * before the URI is ever written down.
 *
 * Document storage, not cache, on purpose — this is content the person chose,
 * not something re-derivable from the network.
 */

const DIR_NAME = 'themes';

function assetDir(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

/** Whether a URI is one of ours, i.e. already safe to store. */
export function isThemeAsset(uri: string): boolean {
  return uri.includes(`/${DIR_NAME}/`) && uri.startsWith('file://');
}

function extensionOf(uri: string): string {
  const clean = uri.split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return '.jpg';
  const ext = clean.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.jpg';
}

/**
 * Copy a picked image into app storage and return the URI to store.
 *
 * Returns the original URI if the copy fails: a wallpaper that might not
 * survive a restart is still better than a picker that appears to do nothing,
 * and the failure is visible the next time rather than immediately.
 */
export async function persistThemeImage(uri: string): Promise<string> {
  if (!uri || isThemeAsset(uri)) return uri;
  try {
    const dir = assetDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${extensionOf(uri)}`;
    const target = new File(dir, name);
    new File(uri).copy(target);
    return target.uri;
  } catch {
    return uri;
  }
}

/**
 * Delete theme images nothing points at any more.
 *
 * Called after the catalog is restored, when the full set of live references
 * is known. Deleting at the moment a wallpaper is replaced would be wrong:
 * the same file can be referenced by an owned pack, by the personal overrides
 * and by an unsaved draft in the editor at once.
 */
export async function pruneThemeImages(keep: Iterable<string>): Promise<void> {
  try {
    const dir = assetDir();
    if (!dir.exists) return;
    const live = new Set<string>();
    for (const uri of keep) if (uri) live.add(uri);
    for (const entry of dir.list()) {
      if (entry instanceof Directory) continue;
      if (!live.has(entry.uri)) entry.delete();
    }
  } catch {
    // Orphaned images cost disk, not correctness.
  }
}
