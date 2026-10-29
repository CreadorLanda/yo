import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Thin wrapper over the file APIs used by sticker import.
 *
 * Kept in one place so the rest of the import path deals in plain
 * Uint8Arrays and never touches URIs or storage layout.
 */

/**
 * Read a local file as bytes.
 *
 * Android pickers hand back `content://` URIs, which the File API cannot
 * open directly — reading one throws before any upload starts, which
 * looked like "sending media silently does nothing". Copy those into the
 * cache first and read the copy.
 */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  if (uri.startsWith('content://')) {
    const copy = new File(Paths.cache, 'inbox', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    copy.create({ intermediates: true, overwrite: true });
    try {
      await FileSystem.copyAsync({ from: uri, to: copy.uri });
      return copy.bytes();
    } finally {
      deleteTempFile(copy.uri);
    }
  }
  return new File(uri).bytes();
}

/**
 * Stickers extracted from a bundle live only in memory, but the upload
 * path needs a file URI. Write them to the cache directory, which the
 * system reclaims on its own when space runs low.
 */
export async function writeTempFile(name: string, bytes: Uint8Array): Promise<string> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const file = new File(Paths.cache, 'sticker-import', `${Date.now()}-${safe}`);
  file.create({ intermediates: true, overwrite: true });
  file.write(bytes);
  return file.uri;
}

export function deleteTempFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best effort; the upload result remains authoritative.
  }
}
