import { api } from './client';
import type { ApiUser } from './auth';

export type Availability = {
  username: string;
  available: boolean;
};

export type Visibility = 'everyone' | 'contacts' | 'nobody';

export type UserPatch = Partial<{
  username: string;
  display_name: string;
  bio: string;
  avatar_uri: string;
  username_public: boolean;
  last_seen_visibility: Visibility;
  photo_visibility: Visibility;
  /** Reciprocal: off means you neither send nor see read receipts. */
  read_receipts: boolean;
  /**
   * The wider switch: no read receipts, no typing, no recording indicator.
   * Reciprocal on the same terms, and enforced on the server — a client that
   * simply does not send is defeated by a client that would rather.
   */
  ghost_mode: boolean;
  /**
   * Stay visible, pinned at the moment you switched it on. Reciprocal unless
   * the account is premium — and `is_premium` is deliberately absent from
   * this type, because it is not something a client may set.
   */
  last_seen_frozen: boolean;
}>;

export const me = () => api.get<ApiUser>('/api/users/me');

export const patchMe = (patch: UserPatch) => api.patch<ApiUser>('/api/users/me', patch);

/**
 * Erase the account for good.
 *
 * No grace period: an account that is "deleted" but still there is a lie
 * told to someone who asked to be gone. Everything that references the user
 * goes with it.
 */
export const deleteMe = () => api.del<void>('/api/users/me');

export const checkAvailability = (username: string) =>
  api.get<Availability>(`/api/users/availability?username=${encodeURIComponent(username)}`);

export const userByUsername = (username: string) =>
  api.get<ApiUser>(`/api/users/by-username/${encodeURIComponent(username)}`);

export const searchUsers = (q: string) =>
  api.get<ApiUser[]>(`/api/users/search?q=${encodeURIComponent(q)}`);
