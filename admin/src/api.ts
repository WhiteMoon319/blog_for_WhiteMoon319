// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Collection, MediaFile, Post, PostVersion, Tag } from './types';

export interface CorpusStats {
  total_chars: number;
  published_chars: number;
  post_count: number;
  collection_id?: number | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, silent401 = false): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 && !silent401) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ authenticated: boolean; sub?: string }>('/api/auth/me'),

  login: (password: string) =>
    request<{ ok: boolean; role?: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }, true),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  render: (md: string) =>
    request<{ html: string; toc: Array<{ id: string; text: string; level: number }> }>('/api/render', {
      method: 'POST',
      body: JSON.stringify({ md }),
    }),

  collections: () => request<{ collections: Collection[] }>('/api/collections'),

  tags: () => request<{ tags: Tag[] }>('/api/tags'),

  collection: (id: number) =>
    request<{ collection: Collection; tags: Tag[] }>(`/api/collections/${id}`),

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

  post: (id: number) => request<{ post: Post; tags: Tag[]; version: number }>(`/api/posts/${id}`),

  createPost: (data: Partial<Post>) =>
    request<{ post: Post; tags: Tag[]; version: number }>('/api/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePost: (id: number, data: Partial<Post>) =>
    request<{ post: Post; tags: Tag[]; version: number }>(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePost: (id: number) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),

  batchPosts: (payload:
    | {
        action: 'publish' | 'draft' | 'delete' | 'trash' | 'restore' | 'purge' | 'move' | 'pin' | 'unpin';
        ids: number[];
        collection_id?: number | null;
      }
    | {
        action: 'create';
        collection_id?: number | null;
        posts: Array<{
          title: string;
          slug?: string;
          summary?: string;
          content_md?: string;
          collection_id?: number | null;
          status?: 'draft' | 'published';
        }>;
      }) =>
    request<{ ok: boolean; count?: number; results?: Array<{ ok: boolean; error?: string; post?: Post }> }>(
      '/api/posts/batch',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  postVersions: (id: number) => request<{ versions: PostVersion[] }>(`/api/posts/${id}/versions`),

  restorePostVersion: (id: number, version: number) =>
    request<{ ok: boolean; post: Post }>(`/api/posts/${id}/versions/${version}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
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

  settings: () => request<Record<string, string>>('/api/settings'),

  saveSettings: (data: Record<string, string>) =>
    request<{ ok: boolean; saved?: string[] }>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; message?: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  pages: (all = false) =>
    request<{ pages: Array<{ id: number; slug: string; title: string; content_md: string; published: number; updated_at: string }> }>(
      `/api/pages${all ? '?all=1' : ''}`,
    ),

  page: (id: number) =>
    request<{ page: { id: number; slug: string; title: string; content_md: string; published: number; updated_at: string } }>(
      `/api/pages/${id}`,
    ),

  createPage: (data: { slug: string; title: string; content_md?: string; published?: number }) =>
    request<{ page: { id: number } }>('/api/pages', { method: 'POST', body: JSON.stringify(data) }),

  updatePage: (id: number, data: { slug?: string; title?: string; content_md?: string; published?: number }) =>
    request<{ page: { id: number } }>(`/api/pages/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePage: (id: number) =>
    request<{ ok: boolean }>(`/api/pages/${id}`, { method: 'DELETE' }),

  stats: (days = 30, collection?: number | 'none') =>
    request<{
      days: number;
      start_day: string;
      end_day: string;
      total_views: number;
      daily: Array<{ day: string; views: number }>;
      top_posts: Array<{ id: number; title: string; slug: string; views: number }>;
      corpus: CorpusStats;
    }>(`/api/stats?days=${days}${collection !== undefined ? `&collection=${collection}` : ''}`),
  statsCorpus: (collection?: number | 'none') =>
    request<CorpusStats>(
      `/api/stats/corpus${collection !== undefined ? `?collection=${collection}` : ''}`,
    ),

  aiModels: () => request<{ models: string[] }>('/api/ai/models'),

  aiSummary: (md: string, collectionId?: number, postId?: number, promptId?: string) =>
    request<{ summaries: string[]; prompt_id: string }>('/api/ai/summary', {
      method: 'POST',
      body: JSON.stringify({ content_md: md, collection_id: collectionId, post_id: postId, prompt_id: promptId }),
    }),

  aiTest: (config: {
    provider?: string;
    base_url?: string;
    model?: string;
    reasoning_effort?: string;
    api_key?: string;
  }) => request<{ ok: boolean; saved?: boolean; error?: string; api_key_configured?: boolean; api_key_masked?: string | boolean }>('/api/ai/test', {
    method: 'POST',
    body: JSON.stringify(config),
  }),

  aiBatchSummary: (ids: number[], force = false) =>
    request<{ results: Array<{ id: number; status: string; error?: string }> }>('/api/ai/batch-summary', {
      method: 'POST',
      body: JSON.stringify({ ids, force }),
    }),

  deleteAiKey: () => request<{ ok: boolean }>('/api/settings/ai-key', { method: 'DELETE' }),

  // ---- 邮件配置 ----
  emailSettings: () => request<{ configured: boolean; smtp_host?: string; smtp_port?: number; smtp_username?: string; from_email?: string }>('/api/settings/email'),
  emailTestAndSave: (data: { smtp_host: string; smtp_port: number; smtp_username: string; smtp_password: string; from_email: string; test_email?: string }) =>
    request<{ ok?: boolean; error?: string }>('/api/settings/email', { method: 'POST', body: JSON.stringify(data) }),
  emailClear: () => request<{ ok: boolean }>('/api/settings/email', { method: 'DELETE' }),

  // ---- 用户管理 ----
  users: () => request<{ users: Array<{ id: number; username: string; display_name: string; email: string; role: string; status: string; created_at: string }> }>('/api/users'),
  userBan: (id: number) => request<{ ok: boolean }>(`/api/users/${id}/ban`, { method: 'POST' }),

  // ---- 评论管理 ----
  adminComments: (status = 'pending', page = 1, postId?: number) => {
    let url = `/api/admin/comments?status=${status}&page=${page}`;
    if (postId) url += `&post_id=${postId}`;
    return request<{ comments: Array<{ id: number; post_id: number; body: string; attachments: string; status: string; created_at: string; username: string; display_name: string; post_title: string }>; total: number; page: number }>(url);
  },
  adminCommentUpdate: (id: number, status: 'approved' | 'rejected') =>
    request<{ ok: boolean }>(`/api/admin/comments/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
  adminCommentDelete: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/comments/${id}`, { method: 'DELETE' }),
};

// 带下载语义的受保护导出：以 blob 形式拉取并触发浏览器下载，401 时照常跳登录。
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}