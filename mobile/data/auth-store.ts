import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { authLogout } from './api/auth';
import type { ApiUser, Tokens } from './api/auth';
import { ACCESS_KEY, REFRESH_KEY } from './api/client';

/**
 * Authenticated-session store, persisted to the OS keychain via
 * expo-secure-store. The API client reads the tokens directly from
 * SecureStore; this module owns the *user* cache + reactive hook so
 * screens can re-render when sign-in / sign-out happens.
 */

const USER_KEY = 'auth.user';
/**
 * The signed-in number, kept on the device.
 *
 * The server stores only a hash of it — deliberately, so a breach cannot
 * hand out phone numbers — which means it can never tell us what ours is.
 * The device is the only place that can answer, so it keeps its own copy.
 */
const PHONE_KEY = 'auth.phone';

let cachedUser: ApiUser | null = null;
let booted = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// One-time load at app startup so screens that mount before bootstrap
// finishes don't flash a logged-out view. Safe to call multiple times.
/**
 * In flight, so a second caller waits for the answer instead of being told
 * there is no session.
 *
 * The flag alone was a race: `booted` was set before the `await`, so anything
 * that called this while the keychain read was still running got `cachedUser`
 * — still null — and concluded the person was signed out. A reply typed into
 * a notification does exactly that on a cold start, which is how it silently
 * sent nothing.
 */
let booting: Promise<ApiUser | null> | null = null;

export async function bootstrapAuth(): Promise<ApiUser | null> {
  if (booted) return cachedUser;
  if (booting) return booting;
  booting = restoreSession().finally(() => {
    booting = null;
  });
  return booting;
}

async function restoreSession(): Promise<ApiUser | null> {
  booted = true;
  try {
    // The keychain read is inside the try too: on Android it throws outright
    // when the entry cannot be decrypted (restored backup, changed signing
    // key). Letting that escape would reject bootstrap and leave the caller
    // with no session *and* no resolution — worse than being signed out.
    const json = await SecureStore.getItemAsync(USER_KEY);
    if (!json) return null;
    cachedUser = JSON.parse(json) as ApiUser;
    emit();
    return cachedUser;
  } catch {
    return null;
  }
}

export async function setSession(user: ApiUser, tokens: Tokens, phone?: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ...(phone ? [SecureStore.setItemAsync(PHONE_KEY, phone)] : []),
  ]);
  cachedUser = user;
  emit();
}

export async function setUser(user: ApiUser): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  cachedUser = user;
  emit();
}

export async function clearSession(): Promise<void> {
  // Best-effort server-side revocation BEFORE we wipe the token locally.
  // If the network is gone, we still proceed — the local wipe is what the
  // user expects from "logout". The family-tracking on the server means a
  // stale token won't be reusable for long anyway.
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  if (refresh) {
    try {
      // Race against a 3s deadline — fetch in RN has no default timeout,
      // so without this a flaky network would keep the user stuck on the
      // logout dialog forever.
      await Promise.race([
        authLogout(refresh),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('logout_timeout')), 3000),
        ),
      ]);
    } catch {
      /* server unreachable / timeout — proceed with the local wipe */
    }
  }
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
    SecureStore.deleteItemAsync(PHONE_KEY),
  ]);
  cachedUser = null;
  emit();
}

/** Reactive — re-renders subscribers when the user changes. */
export function useCurrentUser(): ApiUser | null {
  return useSyncExternalStore(subscribe, () => cachedUser);
}

/** Non-reactive sync read, for cases where you only need the current value. */
export function getCurrentUser(): ApiUser | null {
  return cachedUser;
}

/** The signed-in number, or empty when this device never recorded one. */
export async function getSessionPhone(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(PHONE_KEY)) ?? '';
  } catch {
    return '';
  }
}
