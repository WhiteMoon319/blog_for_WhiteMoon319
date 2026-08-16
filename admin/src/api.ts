import type { Collection, MediaFile, Post } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ authenticated: boolean; sub?: string }>('/api/auth/me'),

  login: (password: string) =>
    request<{ ok: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  collections: () => request<{ collections: Collection[] }>('/api/collections'),

  createCollection: (data: Partial<Collection>) =>
    request<{ collection: Collection }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCollection: (id: number, data: Partial<Collection>) =>
    request<{ collection: Collection }>(`/api/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCollection: (id: number) =>
    request<{ ok: boolean }>(`/api/collections/${id}`, { method: 'DELETE' }),

  posts: (query = '') => request<{ posts: Post[] }>(`/api/posts?status=all${query}`),

  post: (id: number) => request<{ post: Post }>(`/api/posts/${id}`),

  createPost: (data: Partial<Post>) =>
    request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify(data) }),

  updatePost: (id: number, data: Partial<Post>) =>
    request<{ post: Post }>(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePost: (id: number) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),

  batchPosts: (payload: {
    action: 'publish' | 'draft' | 'delete' | 'move';
    ids: number[];
    collection_id?: number | null;
  }) => request<{ ok: boolean; count: number }>('/api/posts/batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  upload: async (file: File): Promise<{ url: string; key: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
    }
    return body as { url: string; key: string };
  },

  media: (cursor?: string) =>
    request<{ files: MediaFile[]; cursor?: string }>(
      `/api/media${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  deleteMedia: (key: string) =>
    request<{ ok: boolean }>(`/api/media?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
};