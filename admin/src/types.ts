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
}

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