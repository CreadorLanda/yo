import * as Clipboard from 'expo-clipboard';

import { SECRET_CLIPBOARD_SECONDS } from '@/data/bot-policy';

/**
 * Copy a secret (a bot token, a webhook secret) and take it back off the
 * clipboard after a minute (#328) — unless the person has copied something
 * else since, which is theirs to keep. Never written anywhere else.
 */
export async function copySecret(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
  setTimeout(() => {
    void (async () => {
      try {
        if ((await Clipboard.getStringAsync()) === value) await Clipboard.setStringAsync('');
      } catch {
        // The clipboard may be unavailable in the background; nothing to do.
      }
    })();
  }, SECRET_CLIPBOARD_SECONDS * 1000);
}
