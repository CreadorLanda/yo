import { api } from './client';

export type Platform = 'ios' | 'android' | 'web' | 'desktop';

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export type ApiUser = {
  id: string;
  username: string;
  display_name: string;
  bio?: string;
  avatar_uri?: string;
  username_public: boolean;
  created_at: string;
  /** Privacy. Served on /users/me. */
  last_seen_visibility?: 'everyone' | 'contacts' | 'nobody';
  photo_visibility?: 'everyone' | 'contacts' | 'nobody';
  read_receipts?: boolean;
  /** The wider switch — see UserPatch in data/api/users.ts. */
  ghost_mode?: boolean;
};

export type StartResponse = {
  sent: boolean;
  /** Only set when APP_ENV=dev on the server — short-circuits SMS. */
  dev_code?: string;
};

export type VerifyResponse = {
  user: ApiUser;
  tokens: Tokens;
};

export const authStart = (phone: string) =>
  api.post<StartResponse>('/api/auth/start', { phone }, { auth: false });

export const authVerify = (input: {
  phone: string;
  code: string;
  device: string;
  /** Stable per-installation id, so the server reuses this device's row. */
  device_key?: string;
  platform: Platform;
}) => api.post<VerifyResponse>('/api/auth/verify', input, { auth: false });

export const authRefresh = (refresh_token: string) =>
  api.post<{ tokens: Tokens }>('/api/auth/refresh', { refresh_token }, { auth: false });

/** Server-side revocation of the refresh-token family. Idempotent. */
export const authLogout = (refresh_token: string) =>
  api.post<void>('/api/auth/logout', { refresh_token }, { auth: false });
