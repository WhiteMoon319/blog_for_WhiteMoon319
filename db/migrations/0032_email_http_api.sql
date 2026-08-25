-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 邮件配置改为 HTTP API 模式（兼容 Resend/Mailgun/SMTP2Go 等）
ALTER TABLE email_credentials ADD COLUMN api_url TEXT NOT NULL DEFAULT '';
ALTER TABLE email_credentials ADD COLUMN api_key_ciphertext TEXT NOT NULL DEFAULT '';