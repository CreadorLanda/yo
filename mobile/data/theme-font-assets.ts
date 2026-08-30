import * as Font from 'expo-font';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono/600SemiBold';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { Lora_400Regular } from '@expo-google-fonts/lora/400Regular';
import { Lora_500Medium } from '@expo-google-fonts/lora/500Medium';
import { Lora_600SemiBold } from '@expo-google-fonts/lora/600SemiBold';
import { Lora_700Bold } from '@expo-google-fonts/lora/700Bold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_500Medium } from '@expo-google-fonts/nunito/500Medium';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';

import type { FontFamilyId } from './theme-fonts';

/**
 * The bytes behind [theme-fonts], and the only file that touches a .ttf.
 *
 * Kept apart from the catalog so that the catalog stays pure: this module
 * cannot be imported outside a bundler, and the weight-to-face logic worth
 * testing has no business being on the far side of that line.
 *
 * Faces are imported one subpath at a time rather than through the packages'
 * barrel files on purpose — `@expo-google-fonts/inter` re-exports eighteen
 * weights, and importing the barrel would pull every one of them into the
 * app. Four weights of five families is already ~5 MB of the download.
 */

type LoadableFamily = Exclude<FontFamilyId, 'system'>;

const FACES: Record<LoadableFamily, Record<string, number>> = {
  inter: {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  },
  nunito: {
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
  },
  lora: {
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
  },
  space: {
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  },
  jetbrains: {
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  },
};

/** Families whose faces are registered and safe to name in a style. */
const ready = new Set<FontFamilyId>(['system']);
/** In-flight loads, so two callers asking at once do the work once. */
const inFlight = new Map<FontFamilyId, Promise<boolean>>();
/**
 * Families that would not load. Remembered so a broken face is attempted
 * once rather than on every store change for the life of the process —
 * the caller in [theme-store] retries on each emit, and without this a
 * missing font would turn every theme tweak into another failed load.
 */
const failed = new Set<FontFamilyId>();

export function isFontFamilyReady(id: FontFamilyId): boolean {
  return ready.has(id);
}

/** Whether asking for this family again could still change anything. */
export function needsFontLoad(id: FontFamilyId): boolean {
  return !ready.has(id) && !failed.has(id);
}

/**
 * Register a family's four faces, once.
 *
 * Resolves `false` rather than throwing when a face will not load. An
 * unregistered family name is not a crash on either platform — the text draws
 * in the system font — so a failed load costs the person their typeface and
 * nothing else, and must not be allowed to take the app's boot down with it.
 */
export async function loadFontFamily(id: FontFamilyId): Promise<boolean> {
  if (ready.has(id)) return true;
  if (failed.has(id)) return false;
  const faces = FACES[id as LoadableFamily];
  if (!faces) return false;

  const existing = inFlight.get(id);
  if (existing) return existing;

  const task = Font.loadAsync(faces)
    .then(() => {
      ready.add(id);
      return true;
    })
    .catch((err) => {
      console.warn(`themes: could not load the ${id} typeface`, err);
      failed.add(id);
      return false;
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, task);
  return task;
}
