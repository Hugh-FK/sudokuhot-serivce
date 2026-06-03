-- 每用户仅保留一条会话（保留最新 rowid），并强制 user_id 唯一
DELETE FROM auth_sessions
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM auth_sessions GROUP BY user_id
);

DROP INDEX IF EXISTS idx_auth_sessions_user;
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_user_id_unique ON auth_sessions(user_id);
