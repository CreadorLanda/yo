import * as SecureStore from 'expo-secure-store';

/**
 * Tiny typed HTTP wrapper around the Socialize API.
 *
 * What it does:
 *   - Reads the base URL from EXPO_PUBLIC_API_URL with a sensible localhost
 *     fallback. Set the env var in app.config.* (or via Expo) to point at
 *     your dev machine's LAN IP when running on a device.
 *   - Injects `Authorization: Bearer <access>` from secure storage when the
 *     call needs auth (the default).
 *   - On a 401, attempts a single refresh in flight and replays the call.
 *     Concurrent 401s share one refresh promise — no thundering herd.
 *   - Throws a typed ApiError so screens can map status / code to UX.
 */

const DEFAULT_BASE_URL = 'http://localhost:8080';

/** Resolve the URL at request time so tests and runtime configuration cannot
 * be made stale by an earlier module import. */
export function getBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL;
}

const BASE_URL = getBaseUrl();

export const ACCESS_KEY = 'auth.access';
export const REFRESH_KEY = 'auth.refresh';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

type RequestOpts = Omit<RequestInit, 'body'> & {
  /** JSON body. Pass anything serializable; the client adds the header for you. */
  json?: unknown;
  /** Defaults to true; set false for /auth/* endpoints. */
  auth?: boolean;
};

let inFlightRefresh: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { tokens?: { access_token: string; refresh_token: string } };
    if (!body.tokens) return false;
    await SecureStore.setItemAsync(ACCESS_KEY, body.tokens.access_token);
    await SecureStore.setItemAsync(REFRESH_KEY, body.tokens.refresh_token);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { json, auth = true, headers, method = 'GET', ...rest } = opts;
  const h: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  if (json !== undefined) h['content-type'] = 'application/json';
  if (auth) {
    const access = await SecureStore.getItemAsync(ACCESS_KEY);
    if (access) h.Authorization = `Bearer ${access}`;
  }

  const send = async () =>
    fetch(`${BASE_URL}${path}`, {
      ...rest,
      method,
      headers: h,
      body: json !== undefined ? JSON.stringify(json) : (rest as RequestInit).body,
    });

  let res = await send();
  if (res.status === 401 && auth) {
    inFlightRefresh ??= tryRefresh().finally(() => {
      // clear AFTER the promise resolves so other callers awaiting share it
      setTimeout(() => {
        inFlightRefresh = null;
      }, 0);
    });
    const refreshed = await inFlightRefresh;
    if (refreshed) {
      const access = await SecureStore.getItemAsync(ACCESS_KEY);
      if (access) h.Authorization = `Bearer ${access}`;
      res = await send();
    }
  }

  if (!res.ok) {
    let body: { error?: string; detail?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.detail ?? body.error);
  }

  // Empty body (204 etc.) → cast as unknown.
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOpts) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, json?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'POST', json }),
  patch: <T>(path: string, json?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'PUT', json }),
  del: <T>(path: string, opts?: RequestOpts) => request<T>(path, { ...opts, method: 'DELETE' }),
};

export { BASE_URL };
