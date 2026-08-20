CREATE TABLE IF NOT EXISTS daily_views (
  post_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, day)
);

CREATE TABLE IF NOT EXISTS daily_view_ips (
  post_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (post_id, day, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_daily_view_ips_day ON daily_view_ips(day);