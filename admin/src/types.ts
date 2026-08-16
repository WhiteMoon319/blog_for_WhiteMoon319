export interface Collection {
  id: number;
  title: string;
  slug: string;
  summary: string;
  theme_color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  collection_id: number | null;
  title: string;
  slug: string;
  summary: string;
  content_md: string;
  cover_url: string;
  status: 'draft' | 'published';
  view_count?: number;
  created_at: string;
  updated_at: string;
}

export interface MediaFile {
  key: string;
  size: number;
  uploaded: string;
  url: string;
}