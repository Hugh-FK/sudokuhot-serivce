import { integer, sqliteTable, text, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  googleId: text('google_id'),
  locale: text('locale'),
  provider: text('provider').notNull().default('guest'),
  passwordHash: text('password_hash'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (t) => [
  uniqueIndex('users_email_unique').on(t.email),
  uniqueIndex('users_google_id_unique').on(t.googleId),
]);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('auth_sessions_user_id_unique').on(t.userId)],
);

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  bio: text('bio').notNull().default(''),
  publicProfile: integer('public_profile', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settingsJson: text('settings_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const gameSessions = sqliteTable('game_sessions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  playMode: text('play_mode').notNull(),
  difficultyId: text('difficulty_id').notNull(),
  dailyDateKey: text('daily_date_key'),
  puzzleTemplateJson: text('puzzle_template_json').notNull(),
  solutionJson: text('solution_json').notNull(),
  /** hell（killer）模式的笼子数据；classic 会话为 null */
  cagesJson: text('cages_json'),
  gridJson: text('grid_json').notNull(),
  notesJson: text('notes_json').notNull(),
  mistakes: integer('mistakes').notNull().default(0),
  hintsUsed: integer('hints_used').notNull().default(0),
  elapsedSeconds: integer('elapsed_seconds').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const gameCompletions = sqliteTable('game_completions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  playMode: text('play_mode').notNull(),
  difficultyId: text('difficulty_id').notNull(),
  dailyDateKey: text('daily_date_key'),
  result: text('result').notNull(),
  elapsedSeconds: integer('elapsed_seconds').notNull(),
  mistakes: integer('mistakes').notNull(),
  hintsUsed: integer('hints_used').notNull(),
  completedAt: text('completed_at').notNull(),
});

export const userDailyCompletions = sqliteTable(
  'user_daily_completions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dateKey: text('date_key').notNull(),
    playMode: text('play_mode').notNull().default('classic'),
    difficultyId: text('difficulty_id').notNull(),
    elapsedSeconds: integer('elapsed_seconds').notNull(),
    mistakes: integer('mistakes').notNull(),
    hintsUsed: integer('hints_used').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dateKey, t.playMode, t.difficultyId] })],
);

export const feedbackEntries = sqliteTable('feedback_entries', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  subject: text('subject').notNull().default(''),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull(),
});

export const blogBookmarks = sqliteTable(
  'blog_bookmarks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slug] })],
);

export const difficultyCommunityStats = sqliteTable('difficulty_community_stats', {
  difficultyId: text('difficulty_id').primaryKey(),
  avgWinHeightPct: integer('avg_win_height_pct').notNull(),
  updatedAt: text('updated_at').notNull(),
});
