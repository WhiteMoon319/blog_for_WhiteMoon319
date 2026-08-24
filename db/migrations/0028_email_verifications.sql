-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 邮箱验证码表
CREATE TABLE IF NOT EXISTS email_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, consumed, expires_at);

-- SMTP 凭据（加密存储，复用 ai-credentials 同款加密机制）
CREATE TABLE IF NOT EXISTS email_credentials (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  smtp_host                 TEXT NOT NULL DEFAULT '',
  smtp_port                 INTEGER NOT NULL DEFAULT 465,
  smtp_username             TEXT NOT NULL DEFAULT '',
  smtp_password_ciphertext  TEXT NOT NULL DEFAULT '',
  encryption_key_version    INTEGER NOT NULL DEFAULT 1,
  from_email                TEXT NOT NULL DEFAULT '',
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);