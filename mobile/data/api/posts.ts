import { api } from './client';

export type PostKind = 'post' | 'reel';
export type PostVisibility = 'public' | 'contacts';

export interface PostMediaDTO {
  id: string;
  kind: 'image' | 'video';
  /** Relative API path, e.g. /api/media/{id}/file */
  url: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}

export interface PostDTO {
  id: string;
  author_id: string;
  author_name?: string;
  author_username?: string;
  author_avatar?: string;
  kind: PostKind;
  caption: string;
  visibility: PostVisibility;
  /** In slide order. Never null. */
  media: PostMediaDTO[];
  is_own: boolean;
  created_at: string;
}

export function createPost(body: {
  kind: PostKind;
  caption?: string;
  visibility?: PostVisibility;
  /** Ids from the media upload, in slide order. */
  media_ids: string[];
}) {
  return api.post<PostDTO>('/api/posts', body);
}

/**
 * One page of someone's grid, newest first.
 *
 * `before` is the `created_at` of the last post already shown, so paging does
 * not shift when something new is published in between.
 */
export function listPosts(opts: { author?: string; kind?: PostKind; before?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.author) q.set('author', opts.author);
  if (opts.kind) q.set('kind', opts.kind);
  if (opts.before) q.set('before', opts.before);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return api.get<PostDTO[]>(qs ? `/api/posts?${qs}` : '/api/posts');
}

export function getPost(id: string) {
  return api.get<PostDTO>(`/api/posts/${id}`);
}

export function deletePost(id: string) {
  return api.del<void>(`/api/posts/${id}`);
}
