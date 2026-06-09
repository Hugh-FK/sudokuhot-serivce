-- Daily completions: one row per (user, date, play_mode, difficulty_id)

CREATE TABLE user_daily_completions_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  play_mode TEXT NOT NULL DEFAULT 'classic',
  difficulty_id TEXT NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  mistakes INTEGER NOT NULL,
  hints_used INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_key, play_mode, difficulty_id)
);

INSERT INTO user_daily_completions_new (
  user_id,
  date_key,
  play_mode,
  difficulty_id,
  elapsed_seconds,
  mistakes,
  hints_used,
  completed_at
)
SELECT
  user_id,
  date_key,
  'classic',
  difficulty_id,
  elapsed_seconds,
  mistakes,
  hints_used,
  completed_at
FROM user_daily_completions;

DROP TABLE user_daily_completions;

ALTER TABLE user_daily_completions_new RENAME TO user_daily_completions;
