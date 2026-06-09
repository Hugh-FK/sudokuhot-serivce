import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppDb } from './index';
import {
  authSessions,
  blogBookmarks,
  difficultyCommunityStats,
  feedbackEntries,
  gameCompletions,
  gameSessions,
  userDailyCompletions,
  userProfiles,
  users,
  userSettings,
} from './schema';
import { addDaysIso, hashToken, isoNow, newId, newToken } from '../lib/crypto';
import { normalizeAuthEmail } from '../lib/email';

export type { AppDb };

const DEFAULT_SETTINGS = JSON.stringify({
  mistakeLimit: '10',
  highlightMatching: true,
  highlightRelated: true,
  showTimer: true,
});

export async function createUser(
  db: AppDb,
  input: {
    email?: string | null;
    displayName: string;
    provider: string;
    avatarUrl?: string | null;
    googleId?: string | null;
    locale?: string | null;
    passwordHash?: string | null;
  },
) {
  const id = newId();
  const now = isoNow();
  const email =
    input.email != null && input.email !== ''
      ? normalizeAuthEmail(input.email)
      : null;
  await db.insert(users).values({
    id,
    email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
    googleId: input.googleId ?? null,
    locale: input.locale ?? null,
    provider: input.provider,
    passwordHash: input.passwordHash ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(userProfiles).values({
    userId: id,
    bio: '',
    publicProfile: true,
    updatedAt: now,
  });
  await db.insert(userSettings).values({
    userId: id,
    settingsJson: DEFAULT_SETTINGS,
    updatedAt: now,
  });
  return (await getUserById(db, id))!;
}

export async function getUserById(db: AppDb, id: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(db: AppDb, email: string) {
  const normalized = normalizeAuthEmail(email);
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        sql`lower(trim(${users.email})) = ${normalized}`,
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Google 登录：绑定 google_id 并更新资料；同邮箱已注册用户合并到同一行 */
export async function linkGoogleAccount(
  db: AppDb,
  userId: string,
  input: {
    googleId: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
    locale?: string | null;
  },
) {
  const email = normalizeAuthEmail(input.email);
  const conflict = await getUserByGoogleId(db, input.googleId);
  if (conflict && conflict.id !== userId) {
    const conflictEmail = conflict.email ? normalizeAuthEmail(conflict.email) : '';
    if (conflictEmail === email) {
      await db.delete(authSessions).where(eq(authSessions.userId, conflict.id));
      await db.delete(users).where(eq(users.id, conflict.id));
    } else {
      throw new Error('GOOGLE_ID_ALREADY_LINKED');
    }
  }

  const current = await getUserById(db, userId);
  const provider = current?.passwordHash ? 'email' : 'google';

  await db
    .update(users)
    .set({
      googleId: input.googleId,
      email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      locale: input.locale ?? null,
      provider,
      updatedAt: isoNow(),
    })
    .where(eq(users.id, userId));
}

export async function resolveUserForGoogleSignIn(
  db: AppDb,
  input: {
    googleId: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
    locale?: string | null;
  },
) {
  const email = normalizeAuthEmail(input.email);
  const link = {
    googleId: input.googleId,
    email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    locale: input.locale,
  };

  const byGoogle = await getUserByGoogleId(db, input.googleId);
  const byEmail = await getUserByEmail(db, email);

  if (byGoogle && byEmail && byGoogle.id !== byEmail.id) {
    await linkGoogleAccount(db, byEmail.id, link);
    return (await getUserById(db, byEmail.id))!;
  }

  const existing = byGoogle ?? byEmail;
  if (existing) {
    await linkGoogleAccount(db, existing.id, link);
    return (await getUserById(db, existing.id))!;
  }

  return createUser(db, {
    email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
    googleId: input.googleId,
    locale: input.locale ?? null,
    provider: 'google',
  });
}

export async function getUserByGoogleId(db: AppDb, googleId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.googleId, googleId), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** 每用户仅一条会话；再次登录刷新 token_hash 与 expires_at，旧 token 失效 */
export async function createAuthSession(db: AppDb, userId: string) {
  const token = newToken();
  const tokenHash = await hashToken(token);
  const expiresAt = addDaysIso(30);
  const now = isoNow();
  await db
    .insert(authSessions)
    .values({
      id: newId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: authSessions.userId,
      set: {
        tokenHash,
        expiresAt,
      },
    });
  return { token, expiresAt };
}

export async function resolveUserByToken(db: AppDb, bearer: string | null) {
  if (!bearer?.startsWith('Bearer ')) return null;
  const token = bearer.slice(7).trim();
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = isoNow();
  const rows = await db
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        gt(authSessions.expiresAt, now),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function updateUserPasswordHash(db: AppDb, userId: string, passwordHash: string) {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: isoNow() })
    .where(eq(users.id, userId));
}

export async function deleteAuthSessionByToken(db: AppDb, bearer: string | null) {
  if (!bearer?.startsWith('Bearer ')) return;
  const token = bearer.slice(7).trim();
  if (!token) return;
  const tokenHash = await hashToken(token);
  await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

export async function getProfile(db: AppDb, userId: string) {
  const rows = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function patchProfile(
  db: AppDb,
  userId: string,
  patch: {
    displayName?: string;
    avatarUrl?: string | null;
    googleId?: string | null;
    locale?: string | null;
    email?: string | null;
    bio?: string;
    publicProfile?: boolean;
  },
) {
  const now = isoNow();
  const hasUserPatch =
    patch.displayName !== undefined ||
    patch.avatarUrl !== undefined ||
    patch.googleId !== undefined ||
    patch.locale !== undefined ||
    patch.email !== undefined;

  if (hasUserPatch) {
    const userPatch: {
      displayName?: string;
      avatarUrl?: string | null;
      googleId?: string | null;
      locale?: string | null;
      email?: string | null;
      updatedAt: string;
    } = { updatedAt: now };
    if (patch.displayName !== undefined) userPatch.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) userPatch.avatarUrl = patch.avatarUrl;
    if (patch.googleId !== undefined) userPatch.googleId = patch.googleId;
    if (patch.locale !== undefined) userPatch.locale = patch.locale;
    if (patch.email !== undefined) userPatch.email = patch.email;
    await db.update(users).set(userPatch).where(eq(users.id, userId));
  }
  if (patch.bio !== undefined || patch.publicProfile !== undefined) {
    const current = await getProfile(db, userId);
    await db
      .update(userProfiles)
      .set({
        bio: patch.bio ?? current?.bio ?? '',
        publicProfile:
          patch.publicProfile === undefined
            ? (current?.publicProfile ?? true)
            : patch.publicProfile,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, userId));
  }
}

export async function getSettings(db: AppDb, userId: string) {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return rows[0]?.settingsJson ?? DEFAULT_SETTINGS;
}

export async function patchSettings(db: AppDb, userId: string, settingsJson: string) {
  await db
    .update(userSettings)
    .set({ settingsJson, updatedAt: isoNow() })
    .where(eq(userSettings.userId, userId));
}

export async function getGameSession(db: AppDb, userId: string) {
  const rows = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertGameSession(
  db: AppDb,
  userId: string,
  session: Omit<typeof gameSessions.$inferInsert, 'userId'>,
) {
  const now = isoNow();
  await db
    .insert(gameSessions)
    .values({ ...session, userId, updatedAt: now })
    .onConflictDoUpdate({
      target: gameSessions.userId,
      set: { ...session, updatedAt: now },
    });
}

export async function deleteGameSession(db: AppDb, userId: string) {
  await db.delete(gameSessions).where(eq(gameSessions.userId, userId));
}

export async function insertCompletion(
  db: AppDb,
  userId: string,
  row: Omit<typeof gameCompletions.$inferInsert, 'userId'>,
) {
  await db.insert(gameCompletions).values({ ...row, userId });
}

export async function listCompletions(db: AppDb, userId: string, limit = 200) {
  return db
    .select()
    .from(gameCompletions)
    .where(eq(gameCompletions.userId, userId))
    .orderBy(desc(gameCompletions.completedAt))
    .limit(limit);
}

export async function listDailyCompletions(db: AppDb, userId: string) {
  return db
    .select()
    .from(userDailyCompletions)
    .where(eq(userDailyCompletions.userId, userId))
    .orderBy(desc(userDailyCompletions.dateKey));
}

export async function upsertDailyCompletion(
  db: AppDb,
  userId: string,
  row: Omit<typeof userDailyCompletions.$inferInsert, 'userId'>,
): Promise<'inserted' | 'exists'> {
  const existing = await getDailyCompletion(
    db,
    userId,
    row.dateKey,
    row.playMode ?? 'classic',
    row.difficultyId,
  );
  if (existing) return 'exists';

  await db.insert(userDailyCompletions).values({ ...row, userId, playMode: row.playMode ?? 'classic' });
  return 'inserted';
}

export async function getDailyCompletion(
  db: AppDb,
  userId: string,
  dateKey: string,
  playMode: string,
  difficultyId: string,
) {
  const rows = await db
    .select()
    .from(userDailyCompletions)
    .where(
      and(
        eq(userDailyCompletions.userId, userId),
        eq(userDailyCompletions.dateKey, dateKey),
        eq(userDailyCompletions.playMode, playMode),
        eq(userDailyCompletions.difficultyId, difficultyId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertFeedback(
  db: AppDb,
  input: {
    userId?: string | null;
    name: string;
    email: string;
    subject: string;
    message: string;
  },
) {
  const id = newId();
  const now = isoNow();
  await db.insert(feedbackEntries).values({
    id,
    userId: input.userId ?? null,
    name: input.name,
    email: input.email,
    subject: input.subject,
    message: input.message,
    createdAt: now,
  });
  return id;
}

export async function listFeedbackForUser(db: AppDb, userId: string, limit = 20) {
  return db
    .select()
    .from(feedbackEntries)
    .where(eq(feedbackEntries.userId, userId))
    .orderBy(desc(feedbackEntries.createdAt))
    .limit(limit);
}

/** 全部用户留言（管理员），按创建时间倒序 + offset 分页 */
export async function listAllFeedback(
  db: AppDb,
  input: { limit: number; cursor?: number },
) {
  const limit = Math.min(100, Math.max(1, input.limit));
  const offset = Math.max(0, input.cursor ?? 0);
  return db
    .select()
    .from(feedbackEntries)
    .orderBy(desc(feedbackEntries.createdAt))
    .limit(limit + 1)
    .offset(offset);
}

export async function listBookmarks(db: AppDb, userId: string) {
  const rows = await db
    .select({ slug: blogBookmarks.slug })
    .from(blogBookmarks)
    .where(eq(blogBookmarks.userId, userId))
    .orderBy(desc(blogBookmarks.createdAt));
  return rows.map((r) => r.slug);
}

export async function addBookmark(db: AppDb, userId: string, slug: string) {
  await db
    .insert(blogBookmarks)
    .values({ userId, slug, createdAt: isoNow() })
    .onConflictDoNothing();
}

export async function removeBookmark(db: AppDb, userId: string, slug: string) {
  await db
    .delete(blogBookmarks)
    .where(and(eq(blogBookmarks.userId, userId), eq(blogBookmarks.slug, slug)));
}

export async function listCommunityStats(db: AppDb) {
  return db.select().from(difficultyCommunityStats);
}

export type LeaderboardType = 'points' | 'speed';
export type LeaderboardPeriod = 'all' | '30d' | '7d' | 'today';

export type LeaderboardEntryRow = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  value: number;
  updatedAt?: string;
};

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeFromDate(period: LeaderboardPeriod): string | null {
  if (period === 'all') return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (period === 'today') return formatDateKey(now);
  const days = period === '7d' ? 6 : 29;
  now.setDate(now.getDate() - days);
  return formatDateKey(now);
}

function buildDailyWhere(input: {
  fromDate: string | null;
  mode?: 'classic' | 'hell';
  difficultyId?: string;
}) {
  const filters: unknown[] = [];
  if (input.fromDate) filters.push(sql`date_key >= ${input.fromDate}`);
  if (input.mode) filters.push(sql`play_mode = ${input.mode}`);
  if (input.difficultyId) filters.push(sql`difficulty_id = ${input.difficultyId}`);
  if (filters.length === 0) return sql``;
  return sql`where ${sql.join(filters as any, sql` and `)}`;
}

/** 积分榜：每局胜场 + 每次每日挑战完成各计 1 分 */
export async function listLeaderboardPoints(
  db: AppDb,
  input: {
    period: LeaderboardPeriod;
    limit: number;
    cursor?: number;
    mode?: 'classic' | 'hell';
    difficultyId?: string;
  },
): Promise<LeaderboardEntryRow[]> {
  const fromDate = computeFromDate(input.period);
  const offset = Math.max(0, input.cursor ?? 0);
  const dailyWhere = buildDailyWhere({
    fromDate,
    mode: input.mode,
    difficultyId: input.difficultyId,
  });

  const winFilters: unknown[] = [sql`result = 'win'`];
  if (fromDate) winFilters.push(sql`completed_at >= ${fromDate}`);
  if (input.mode) winFilters.push(sql`play_mode = ${input.mode}`);
  if (input.difficultyId) winFilters.push(sql`difficulty_id = ${input.difficultyId}`);
  const winWhere = sql`where ${sql.join(winFilters as any, sql` and `)}`;

  const rows = await db.all<LeaderboardEntryRow>(sql`
    select
      u.id as userId,
      u.display_name as displayName,
      u.avatar_url as avatarUrl,
      (coalesce(w.wins, 0) + coalesce(d.dailies, 0)) as value
    from users u
    left join (
      select user_id, count(*) as wins
      from game_completions
      ${winWhere}
      group by user_id
    ) w on w.user_id = u.id
    left join (
      select user_id, count(*) as dailies
      from user_daily_completions
      ${dailyWhere}
      group by user_id
    ) d on d.user_id = u.id
    where u.deleted_at is null and u.provider != 'guest'
      and (coalesce(w.wins, 0) + coalesce(d.dailies, 0)) > 0
    order by value desc, u.updated_at desc
    limit ${input.limit}
    offset ${offset}
  `);
  return rows;
}

export async function listLeaderboardSpeed(
  db: AppDb,
  input: {
    period: LeaderboardPeriod;
    limit: number;
    cursor?: number;
    mode?: 'classic' | 'hell';
    difficultyId?: string;
  },
): Promise<LeaderboardEntryRow[]> {
  const fromDate = computeFromDate(input.period);
  const offset = Math.max(0, input.cursor ?? 0);
  const dailyWhere = buildDailyWhere({
    fromDate,
    mode: input.mode,
    difficultyId: input.difficultyId,
  });

  const winFilters: unknown[] = [sql`result = 'win'`];
  if (fromDate) winFilters.push(sql`completed_at >= ${fromDate}`);
  if (input.mode) winFilters.push(sql`play_mode = ${input.mode}`);
  if (input.difficultyId) winFilters.push(sql`difficulty_id = ${input.difficultyId}`);
  const winWhere = sql`where ${sql.join(winFilters as any, sql` and `)}`;

  const rows = await db.all<LeaderboardEntryRow>(sql`
    with best_win as (
      select user_id, min(elapsed_seconds) as bestWin
      from game_completions
      ${winWhere}
      group by user_id
    ),
    best_daily as (
      select user_id, min(elapsed_seconds) as bestDaily
      from user_daily_completions
      ${dailyWhere}
      group by user_id
    )
    select
      u.id as userId,
      u.display_name as displayName,
      u.avatar_url as avatarUrl,
      case
        when bw.bestWin is null then bd.bestDaily
        when bd.bestDaily is null then bw.bestWin
        when bw.bestWin < bd.bestDaily then bw.bestWin
        else bd.bestDaily
      end as value
    from users u
    left join best_win bw on bw.user_id = u.id
    left join best_daily bd on bd.user_id = u.id
    where u.deleted_at is null and u.provider != 'guest'
      and (bw.bestWin is not null or bd.bestDaily is not null)
    order by value asc, u.updated_at desc
    limit ${input.limit}
    offset ${offset}
  `);
  return rows;
}

export async function deleteUserData(db: AppDb, userId: string) {
  const now = isoNow();
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
  await db.delete(gameSessions).where(eq(gameSessions.userId, userId));
  await db.delete(gameCompletions).where(eq(gameCompletions.userId, userId));
  await db.delete(userDailyCompletions).where(eq(userDailyCompletions.userId, userId));
  await db.delete(blogBookmarks).where(eq(blogBookmarks.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await db.delete(userSettings).where(eq(userSettings.userId, userId));
  await db
    .update(users)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(users.id, userId));
}
