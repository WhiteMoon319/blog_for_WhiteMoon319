-- 统一用户表：读者 + 管理员 + 预留多作者
-- 会话 sub 统一为 user:{id}，不再有独立 admin sub
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','author','admin')),
  website_url     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 评论表：纯文本 + 图片附件，审核制
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at);

-- 种子管理员：从 admin_credentials 复制密码哈希（若存在）
-- 若无 admin_credentials，创建占位用户保留 env 回退登录路径
INSERT INTO users (username, display_name, email, email_verified, password_hash, role, session_version, created_at)
SELECT 'admin', '管理员', '3287047638@qq.com', 1,
       COALESCE((SELECT password_hash FROM admin_credentials WHERE id = 1), ''),
       'admin', 1, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');