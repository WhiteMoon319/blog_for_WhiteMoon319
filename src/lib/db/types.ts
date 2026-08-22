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
}

export type PostWithCollection = PostRow & { collection_slug: string | null };

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

const COLLECTION_FIELDS = ['title', 'slug', 'summary', 'theme_color', 'sort_order', 'post_order', 'ref_summaries'] as const;
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