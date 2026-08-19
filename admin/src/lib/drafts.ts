// 本地草稿自动保存（IndexedDB）：仅浏览器本地保留，不写入服务器。
// 明确边界：不解决多端并发——服务器冲突仍由 base_version 乐观锁 + 用户选择处理。
// 键约定：post:{id} 按文章隔离；new:{uuid} 为新建草稿临时键（见 PostEditorView 中 sessionStorage 关联）。

export interface DraftSnapshot {
  key: string;
  post_id: number | null;
  title: string;
  slug: string;
  collection_id: number | null;
  summary: string;
  cover_url: string;
  meta_keywords: string;
  status: 'draft' | 'published';
  tags: string[];
  content_md: string;
  base_version: number;
  saved_at: string;
}

const DB_NAME = 'blog-admin';
const DB_VERSION = 1;
const STORE = 'drafts';

export type DraftSaveResult = { ok: true } | { ok: false; error: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 不可用'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入被中止'));
  });
}

export async function saveDraft(snapshot: DraftSnapshot): Promise<DraftSaveResult> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot);
    await txDone(tx);
    db.close();
    return { ok: true };
  } catch (e) {
    // 空间不足、隐私模式禁用等：只提示用户，绝不阻断服务器保存
    return { ok: false, error: e instanceof DOMException && e.name === 'QuotaExceededError' ? '本地空间不足，自动保存未生效' : '本地自动保存不可用' };
  }
}

export async function loadDraft(key: string): Promise<DraftSnapshot | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get(key);
  const result = await new Promise<DraftSnapshot | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as DraftSnapshot | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
  });
  db.close();
  return result ?? null;
}

export async function clearDraft(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
  db.close();
}

// 多标签页提示：用 localStorage 标记 + storage 事件跨标签广播，
// 只做"另一标签也在编辑"的提示，不宣称已解决并发。
const ACTIVITY_PREFIX = 'draft-activity:';

export function markTabActivity(key: string): void {
  try {
    localStorage.setItem(ACTIVITY_PREFIX + key, String(Date.now()));
  } catch {
    // localStorage 不可用时忽略，多标签提示为尽力而为
  }
}

export function listenTabActivity(key: string, cb: () => void): () => void {
  const on = (e: StorageEvent) => {
    if (e.key === ACTIVITY_PREFIX + key && e.newValue) cb();
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}