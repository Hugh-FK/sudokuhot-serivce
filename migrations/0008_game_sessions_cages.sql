-- hell（killer）模式会话的笼子数据；classic 会话为 NULL
ALTER TABLE game_sessions ADD COLUMN cages_json TEXT;
