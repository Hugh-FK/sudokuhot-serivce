CREATE TABLE anonymous_play_events (
  id TEXT PRIMARY KEY NOT NULL,
  play_mode TEXT NOT NULL,
  difficulty_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_anonymous_play_events_completed
  ON anonymous_play_events(completed_at DESC);

CREATE INDEX idx_anonymous_play_events_country_completed
  ON anonymous_play_events(country, completed_at DESC);
