-- AI 供应商 API Key 加密凭据
-- 固定 id = 1 单凭据模式；多供应商时再扩展
CREATE TABLE ai_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key_ciphertext TEXT NOT NULL,
  encryption_key_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);