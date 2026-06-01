import { and, desc, eq, gt, isNull } from 'drizzle-orm';
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

export type { AppDb };

const DEFAULT_SETTINGS = JSON.stringify({
  mistakeLimit: '3',
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
  },
) {
  const id = newId();
  const now = isoNow();
  await db.insert(users).values({
    id,
    email: input.email ?? null,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
    googleId: input.googleId ?? null,
    locale: input.locale ?? null,
    provider: input.provider,
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
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByGoogleId(db: AppDb, googleId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.googleId, googleId), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAuthSession(db: AppDb, userId: string) {
  const token = newToken();
  const tokenHash = await hashToken(token);
  const id = newId();
  const expiresAt = addDaysIso(30);
  const now = isoNow();
  await db.insert(authSessions).values({
    id,
    userId,
    tokenHash,
    expiresAt,
    createdAt: now,
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
) {
  await db
    .insert(userDailyCompletions)
    .values({ ...row, userId })
    .onConflictDoUpdate({
      target: [userDailyCompletions.userId, userDailyCompletions.dateKey],
      set: {
        difficultyId: row.difficultyId,
        elapsedSeconds: row.elapsedSeconds,
        mistakes: row.mistakes,
        hintsUsed: row.hintsUsed,
        completedAt: row.completedAt,
      },
    });
}

export async function getDailyCompletion(db: AppDb, userId: string, dateKey: string) {
  const rows = await db
    .select()
    .from(userDailyCompletions)
    .where(
      and(eq(userDailyCompletions.userId, userId), eq(userDailyCompletions.dateKey, dateKey)),
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
