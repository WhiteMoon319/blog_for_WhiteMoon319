// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Collection {
  id: number;
  title: string;
  slug: string;
  summary: string;
  theme_color: string;
  sort_order: number;
  post_order: 'asc' | 'desc';
  created_at: string;
  updated_at: string;
  ref_summaries: number;
  ai_prompt_id: string;
  /** 归属作者 id（管理员在后台可见；写作区用 CollectionWriteView 判断关系） */
  created_by?: number | null;
  /** 1 = 公用（任何作者可投稿）；0 = 私有（需归属人同意） */
  is_public?: number;
}

export interface AuthorRef {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
}

export interface AuthorOption extends AuthorRef {
  post_count: number;
}

/** 写作区看到的文集：带上我与它的关系、可写性与我的申请状态 */
export interface CollectionWriteView {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  theme_color?: string;
  is_public: number;
  created_by: number | null;
  relation: 'owner' | 'collaborator' | 'public' | 'private';
  can_write: boolean;
  invite_status: 'pending' | 'accepted' | 'rejected' | null;
}

export interface Post {
  id: number;
  collection_id: number | null;
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  cover_url: string;
  meta_keywords: string;
  is_pinned?: number;
  scheduled_at?: string | null;
  status: 'draft' | 'published';
  view_count?: number;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  /** 署名作者，按 sort_order 升序（第一位为主作者）；列表接口一次批量取回 */
  authors?: AuthorRef[];
}

/** 写入接口的文章载荷：authors 传用户 id 列表（服务端按顺序落署名） */
export type PostWritePayload = Partial<Omit<Post, 'authors'>> & { authors?: number[] };

export interface Tag {
  id: number;
  name: string;
  collections?: number;
  posts?: number;
  total?: number;
  created_at?: string;
}

export interface MediaFile {
  key: string;
  size: number;
  uploaded: string;
  url: string;
}

export interface PostVersion {
  id: number;
  post_id: number;
  version: number;
  title: string;
  slug: string;
  collection_id: number | null;
  summary: string;
  content_md: string;
  cover_url: string;
  meta_keywords: string;
  status: 'draft' | 'published';
  message: string;
  created_at: string;
}