/**
 * `expo-secure-store` has no web implementation: there is no OS keystore in a
 * browser. This keeps the same three calls on `localStorage` so the web client
 * can sign in. It is NOT secure storage; anything in `localStorage` is readable
 * by scripts on the page. That is acceptable for the development web client
 * this exists for, and a reason not to ship it as a production target as is.
 */
const PREFIX = 'securestore:';

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    // Private mode or blocked storage: the session simply does not persist.
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    // Same as above.
  }
}

export const WHEN_UNLOCKED = 'WHEN_UNLOCKED';
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
export const ALWAYS = 'ALWAYS';
export const ALWAYS_THIS_DEVICE_ONLY = 'ALWAYS_THIS_DEVICE_ONLY';
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY';
