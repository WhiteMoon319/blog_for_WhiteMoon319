// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CollectionRow {
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
  /** 文集归属人（即文集署名作者）；遗留数据在迁移 0035 中回填为管理员 */
  created_by: number | null;
  /** 1 = 公用（任何作者可写入）；0 = 私有（仅归属人/协作者/管理员可写入） */
  is_public: number;
}

export interface PostRow {
  id: number;
  collection_id: number | null;
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  cover_url: string;
  status: 'draft' | 'published';
  view_count: number;
  is_pinned: number;
  scheduled_at: string | null;
  deleted_at: string | null;
  meta_keywords: string;
  created_at: string;
  updated_at: string;
  summary_source: 'local' | 'manual' | 'ai';
  /** 归属人（决定编辑权），与对外署名解耦 */
  created_by: number | null;
}

export type PostWithCollection = PostRow & { collection_slug: string | null };

/** 作者引用（前台署名、作者页与编辑器选择器共用） */
export interface AuthorRef {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
}

/** 作者引用 + 已发布篇数（作者页与搜索结果用） */
export type AuthorSummary = AuthorRef & { post_count: number };

/** 带署名的文章：authors 由批量查询装配，避免逐篇查询 */
export type PostWithAuthors = PostRow & { authors: AuthorRef[] };

export interface PostInput {
  title: string;
  slug: string;
  collection_id?: number | null;
  summary?: string;
  content_md?: string;
  cover_url?: string;
  status?: 'draft' | 'published';
  meta_keywords?: string;
  is_pinned?: number;
  scheduled_at?: string | null;
  summary_source?: 'local' | 'manual' | 'ai';
  created_by?: number | null;
}

const POST_FIELDS = [
  'title',
  'slug',
  'collection_id',
  'summary',
  'content_md',
  'cover_url',
  'status',
  'meta_keywords',
  'is_pinned',
  'scheduled_at',
] as const;
export type PostPatch = Partial<Record<(typeof POST_FIELDS)[number], string | number | null>>;

const COLLECTION_FIELDS = ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order', 'ref_summaries', 'ai_prompt_id', 'is_public'] as const;
export type CollectionPatch = Partial<Record<(typeof COLLECTION_FIELDS)[number], string | number>>;

export interface PostVersionRow {
  id: number;
  post_id: number;
  version: number;
  title: string;
  slug: string;
  collection_id: number | null;
  summary: string;
  content_md: string;
  cover_url: string;
  status: 'draft' | 'published';
  meta_keywords: string;
  message: string;
  created_at: string;
  base_version: number | null;
  content_md_patch: string;
  summary_source: string;
  /** 署名快照（JSON 数组字符串）；'[]' 视为不覆盖当前署名 */
  authors: string;
}

export interface TagRow {
  id: number;
  name: string;
  created_at: string;
}

export interface TagCountRow extends TagRow {
  collections: number;
  posts: number;
  total: number;
}

export interface TagPageCollectionsRow extends CollectionRow {
  post_count: number;
}

export interface TagPageResult {
  tag: TagRow;
  collections: TagPageCollectionsRow[];
  posts: PostWithCollection[];
}

export interface TagsUnionResult {
  collections: TagPageCollectionsRow[];
  posts: PostWithCollection[];
  // 每个文集旗下命中文章（两级展示展开用），按 collection_id 分组
  collectionPosts: Map<number, PostWithCollection[]>;
}
