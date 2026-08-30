import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { hasLockCode, relockAll, verifyLockCode } from './chat-lock';
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  sanitizeTimeout,
  shouldLock,
  type LockTimeoutMs,
} from './app-lock-policy';

/**
 * The lock on the app itself.
 *
 * [chat-lock] guards individual conversations; anyone holding an unlocked
 * phone could still open Yo and read everything that was not individually
 * locked. The README has promised "App lock" since the beginning, and a
 * security promise that is not true is worse than one never made.
 *
 * **There is one secret.** The code is [chat-lock]'s — this module never
 * stores, hashes or compares a passcode of its own, it calls
 * `verifyLockCode`. Two codes to remember is how people end up choosing
 * `0000` for both.
 *
 * Biometrics sit *on top of* that code, never instead of it. The device
 * decides what that means — Face ID or Touch ID on iOS, whatever
 * `BiometricPrompt` offers on Android — and the app is only ever told yes or
 * no. No face or fingerprint data reaches this process, which is precisely
 * why this is the OS's job and not ours.
 */

const PREFS_KEY = 'app.lock.v1';

type Prefs = { enabled: boolean; biometrics: boolean; timeoutMs: LockTimeoutMs };

const DEFAULTS: Prefs = {
  enabled: false,
  biometrics: false,
  timeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
};

let prefs: Prefs = { ...DEFAULTS };
/**
 * Starts locked, not unlocked.
 *
 * Until the stored prefs have been read there is no way to know whether this
 * app is locked, and the safe answer to "I do not know yet" is yes. Starting
 * unlocked would flash the chat list for one frame on every cold start of a
 * locked app — the exact thing the lock exists to prevent.
 */
let locked = true;
let hydrated = false;
/** When the app last left the screen. Null while it is in front. */
let backgroundedAt: number | null = null;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function persist() {
  if (!hydrated) return;
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }).catch(() => {});
}

/**
 * Read the stored settings. Safe to call before sign-in, and idempotent.
 *
 * Resolves the initial `locked` value: an app with the lock off is not
 * locked, and one with it on starts locked until the code or a fingerprint
 * says otherwise.
 */
export async function bootstrapAppLock(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    prefs = {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULTS.enabled,
      biometrics: typeof stored.biometrics === 'boolean' ? stored.biometrics : DEFAULTS.biometrics,
      timeoutMs: sanitizeTimeout(stored.timeoutMs),
    };
    // A lock with no code behind it cannot be entered, and would strand the
    // person outside their own app. Treat it as off.
    if (prefs.enabled && !(await hasLockCode())) prefs.enabled = false;
  } catch {
    prefs = { ...DEFAULTS };
  }
  hydrated = true;
  locked = prefs.enabled;
  emit();
}

export function useAppLockPrefs(): Prefs {
  return useSyncExternalStore(
    subscribe,
    () => prefs,
    () => prefs,
  );
}

export function useAppLocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => locked,
    () => locked,
  );
}

export function isAppLocked(): boolean {
  return locked;
}

/**
 * Turn the lock on or off.
 *
 * Turning it on needs a code to already exist — the caller is expected to
 * have collected one. Turning it off needs the current code, for the same
 * reason [chat-lock] refuses to overwrite one: otherwise anyone holding the
 * phone walks past the lock by switching it off.
 */
export async function setAppLockEnabled(enabled: boolean, code: string): Promise<boolean> {
  if (!(await verifyLockCode(code))) return false;
  prefs = { ...prefs, enabled };
  if (!enabled) locked = false;
  await persist();
  emit();
  return true;
}

export async function setAppLockBiometrics(on: boolean): Promise<void> {
  prefs = { ...prefs, biometrics: on };
  await persist();
  emit();
}

export async function setAppLockTimeout(timeoutMs: LockTimeoutMs): Promise<void> {
  prefs = { ...prefs, timeoutMs: sanitizeTimeout(timeoutMs) };
  await persist();
  emit();
}

/** What the device can actually offer, for the settings screen to be honest. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export async function unlockWithAppCode(code: string): Promise<boolean> {
  if (!(await verifyLockCode(code))) return false;
  locked = false;
  emit();
  return true;
}

/**
 * Ask the OS to confirm the person, and unlock if it does.
 *
 * `disableDeviceFallback` on purpose: the system's own passcode sheet is not
 * this app's code, and letting it stand in would mean the phone's PIN opens
 * Yo. The way past a failed fingerprint is the code on our own screen.
 */
export async function unlockWithBiometrics(prompt: string): Promise<boolean> {
  if (!prefs.biometrics) return false;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      disableDeviceFallback: true,
      cancelLabel: undefined,
    });
    if (!res.success) return false;
  } catch {
    return false;
  }
  locked = false;
  emit();
  return true;
}

/** Lock now — on sign-out, and from the background timer. */
export function lockAppNow(): void {
  if (!prefs.enabled) return;
  locked = true;
  // Locking the app must also re-hide any conversation that was revealed;
  // otherwise unlocking once reopens every locked chat with it.
  relockAll();
  emit();
}

/**
 * Re-arm the lock on sign-out.
 *
 * Signing out does not clear the code — it is the device's, not the
 * account's — so the next person to open the app meets the lock again rather
 * than the state the last session happened to leave behind.
 */
export function resetAppLock(): void {
  backgroundedAt = null;
  locked = prefs.enabled;
  emit();
}

/** The app left the screen: start the clock. */
export function noteBackgrounded(at: number = Date.now()): void {
  if (backgroundedAt === null) backgroundedAt = at;
}

/**
 * The app came back. Locks if the grace period ran out.
 *
 * Returns whether it is now locked, so the caller can decide whether to
 * offer biometrics straight away.
 */
export function noteForegrounded(now: number = Date.now()): boolean {
  const since = backgroundedAt;
  backgroundedAt = null;
  if (!prefs.enabled || locked) return locked;
  if (shouldLock(since, now, prefs.timeoutMs)) lockAppNow();
  return locked;
}
