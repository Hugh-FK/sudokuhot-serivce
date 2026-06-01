-- Sudoku Hot D1 schema v1

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'guest',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '',
  public_profile INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  play_mode TEXT NOT NULL,
  difficulty_id TEXT NOT NULL,
  daily_date_key TEXT,
  puzzle_template_json TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  grid_json TEXT NOT NULL,
  notes_json TEXT NOT NULL,
  mistakes INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_completions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  play_mode TEXT NOT NULL,
  difficulty_id TEXT NOT NULL,
  daily_date_key TEXT,
  result TEXT NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  mistakes INTEGER NOT NULL,
  hints_used INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_completions_user_completed
  ON game_completions(user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS user_daily_completions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  difficulty_id TEXT NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  mistakes INTEGER NOT NULL,
  hints_used INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_key)
);

CREATE TABLE IF NOT EXISTS feedback_entries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, slug)
);

CREATE TABLE IF NOT EXISTS difficulty_community_stats (
  difficulty_id TEXT PRIMARY KEY NOT NULL,
  avg_win_height_pct INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- 柱图「玩家均值」mock（与前端 STATS_CHART_BARS 一致）
INSERT OR IGNORE INTO difficulty_community_stats (difficulty_id, avg_win_height_pct, updated_at) VALUES
  ('easy', 45, datetime('now')),
  ('medium', 65, datetime('now')),
  ('hard', 70, datetime('now')),
  ('expert', 30, datetime('now')),
  ('master', 20, datetime('now'));
