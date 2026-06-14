import { Elysia, t } from 'elysia';
import type { D1Database } from '@cloudflare/workers-types';
import { createDb } from '../db';
import type { Env } from '../env';
import {
  addBookmark,
  createAuthSession,
  createUser,
  deleteAuthSessionByToken,
  deleteGameSession,
  deleteUserData,
  getDailyCompletion,
  getGameSession,
  getProfile,
  getSettings,
  getUserByEmail,
  getUserById,
  insertCompletion,
  insertAnonymousPlayEvent,
  insertFeedback,
  listAllFeedback,
  listLeaderboardPoints,
  listLeaderboardSpeed,
  listBookmarks,
  listFeedbackForUser,
  listCommunityStats,
  listCompletions,
  listDailyCompletions,
  patchProfile,
  patchSettings,
  removeBookmark,
  resolveUserByToken,
  upsertDailyCompletion,
  upsertGameSession,
} from '../db/repos';
import { getDailyChallengeDefinition, getDailyChallengeDefinitionV2, parseDailyChallengeQuery } from '../lib/daily-catalog';
import { isoNow, newId } from '../lib/crypto';
import {
  buildDerivedStats,
  buildDifficultyChart,
  buildSummary,
  getProfileRankLabel,
  isWithinPeriod,
  type StatsPeriod,
} from '../services/aggregates';
import { buildAchievementHallView, buildStatsAchievementUnlocks, buildHellModeProgress, buildProfileMilestone } from '../services/achievement-hall';
import {
  buildActivityFeed,
  buildActivitySummary,
  filterActivityEntries,
  parseActivityQuery,
} from '../services/activity';
import { redirectTo } from '../lib/redirect';
import { createOAuthState, verifyOAuthState } from '../lib/oauth-state';
import {
  buildGoogleAuthUrl,
  completeGoogleSignIn,
  getFrontendOrigin,
  getGoogleOAuthConfig,
  getOAuthStateSecret,
  requireGoogleOAuthConfig,
  requireOAuthStateSecret,
} from '../services/google-oauth';
import {
  changeUserPassword,
  loginWithPassword,
  normalizeAuthEmail,
  registerWithPassword,
} from '../services/password-auth';
import { buildAnonymousPlayStatsSummary } from '../services/anonymous-play-stats';
import {
  countryFromRequest,
  parseDifficultyId,
  parsePlayMode,
  parsePlayStatsPeriod,
} from '../lib/play-stats';

const authPasswordBody = t.String({ minLength: 8, maxLength: 128 });
const authEmailBody = t.String({ format: 'email', maxLength: 255 });

function sessionToApi(row: NonNullable<Awaited<ReturnType<typeof getGameSession>>>) {
  return {
    version: 1 as const,
    playMode: row.playMode as 'classic' | 'hell',
    difficultyId: row.difficultyId,
    dailyDateKey: row.dailyDateKey ?? undefined,
    puzzleTemplate: JSON.parse(row.puzzleTemplateJson),
    solution: JSON.parse(row.solutionJson),
    cages: row.cagesJson ? JSON.parse(row.cagesJson) : undefined,
    grid: JSON.parse(row.gridJson),
    notes: JSON.parse(row.notesJson),
    mistakes: row.mistakes,
    hintsUsed: row.hintsUsed,
    elapsedSeconds: row.elapsedSeconds,
    updatedAt: row.updatedAt,
  };
}

function completionToApi(row: Awaited<ReturnType<typeof listCompletions>>[number]) {
  return {
    id: row.id,
    playMode: row.playMode,
    difficultyId: row.difficultyId,
    dailyDateKey: row.dailyDateKey ?? undefined,
    result: row.result,
    elapsedSeconds: row.elapsedSeconds,
    mistakes: row.mistakes,
    hintsUsed: row.hintsUsed,
    completedAt: row.completedAt,
  };
}

function dailyToApi(row: Awaited<ReturnType<typeof listDailyCompletions>>[number]) {
  return {
    dateKey: row.dateKey,
    mode: row.playMode as 'classic' | 'hell',
    difficultyId: row.difficultyId,
    elapsedSeconds: row.elapsedSeconds,
    mistakes: row.mistakes,
    hintsUsed: row.hintsUsed,
    completedAt: row.completedAt,
  };
}

function userToApi(user: NonNullable<Awaited<ReturnType<typeof getUserById>>>) {
  return {
    id: user.id,
    googleId: user.googleId ?? null,
    email: user.email,
    name: user.displayName,
    displayName: user.displayName,
    picture: user.avatarUrl ?? null,
    avatarUrl: user.avatarUrl ?? null,
    locale: user.locale ?? null,
    provider: user.provider,
  };
}

export function createV1Routes(d1: D1Database, cfEnv: Env) {
  const db = createDb(d1);

  async function requireUser(authorization: string | undefined) {
    const user = await resolveUserByToken(db, authorization ?? null);
    if (!user) throw new Error('UNAUTHORIZED');
    return user;
  }

  function parseFeedbackAdminEmails(): Set<string> {
    const raw = cfEnv.FEEDBACK_ADMIN_EMAILS?.trim() || 'fgwenzk@gmail.com';
    return new Set(
      raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async function requireFeedbackAdmin(authorization: string | undefined) {
    const user = await requireUser(authorization);
    const email = user.email?.trim().toLowerCase() ?? '';
    if (!email || !parseFeedbackAdminEmails().has(email)) {
      throw new Error('FORBIDDEN');
    }
    return user;
  }

  return new Elysia({ prefix: '/v1' })
    .onError(({ error, set }) => {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: 'unauthorized' };
      }
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        set.status = 403;
        return { error: 'forbidden' };
      }
      if (error instanceof Error && error.message === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
        set.status = 503;
        return { error: 'google_oauth_not_configured' };
      }
      if (error instanceof Error && error.message === 'GOOGLE_ID_ALREADY_LINKED') {
        set.status = 409;
        return { error: 'google_account_linked_to_other_user' };
      }
      if (error instanceof Error && error.message.startsWith('GOOGLE_')) {
        set.status = 400;
        return { error: 'google_oauth_failed' };
      }
      if (error instanceof Error && error.message === 'INVALID_PLAY_STATS') {
        set.status = 400;
        return { error: 'invalid_play_stats' };
      }
      console.error(error);
      set.status = 500;
      return { error: 'internal_error' };
    })
    .get('/auth/google', async ({ set }) => {
      const config = getGoogleOAuthConfig(cfEnv);
      if (!config) {
        set.status = 503;
        return { error: 'google_oauth_not_configured' };
      }
      const secret = getOAuthStateSecret(cfEnv);
      if (!secret) {
        set.status = 503;
        return { error: 'oauth_state_secret_missing', hint: 'Set API_SECRET_KEY in .dev.vars' };
      }
      const state = await createOAuthState(secret);
      return redirectTo(buildGoogleAuthUrl(config, state));
    })
    .get('/auth/callback', async ({ query }) => {
      const config = requireGoogleOAuthConfig(cfEnv);
      const secret = requireOAuthStateSecret(cfEnv);
      const frontend = getFrontendOrigin(cfEnv);

      const code = query.code;
      const state = query.state;
      const oauthError = query.error;

      if (oauthError) {
        return redirectTo(`${frontend}/auth/callback?error=${encodeURIComponent(oauthError)}`);
      }

      if (!code || !state) {
        return redirectTo(`${frontend}/auth/callback?error=missing_code`);
      }

      const validState = await verifyOAuthState(secret, state);
      if (!validState) {
        return redirectTo(`${frontend}/auth/callback?error=invalid_state`);
      }

      try {
        const session = await completeGoogleSignIn(db, config, code);
        const params = new URLSearchParams({
          token: session.token,
          expiresAt: session.expiresAt,
        });
        return redirectTo(`${frontend}/auth/callback?${params}`);
      } catch (err) {
        console.error(err);
        return redirectTo(`${frontend}/auth/callback?error=exchange_failed`);
      }
    })
    .get('/auth/google/url', async ({ set }) => {
      const config = getGoogleOAuthConfig(cfEnv);
      if (!config) {
        set.status = 503;
        return { error: 'google_oauth_not_configured' };
      }
      const secret = getOAuthStateSecret(cfEnv);
      if (!secret) {
        set.status = 503;
        return { error: 'oauth_state_secret_missing' };
      }
      const state = await createOAuthState(secret);
      return {
        url: buildGoogleAuthUrl(config, state),
        state,
        /** 须在 Google Cloud「已授权的重定向 URI」中一字不差添加此地址 */
        redirectUri: config.redirectUri,
      };
    })
    .post(
      '/auth/google',
      async ({ body, set }) => {
        const config = getGoogleOAuthConfig(cfEnv);
        if (!config) {
          set.status = 503;
          return { error: 'google_oauth_not_configured' };
        }
        try {
          const session = await completeGoogleSignIn(
            db,
            config,
            body.code,
            body.redirectUri,
          );
          return session;
        } catch (err) {
          console.error(err);
          set.status = 400;
          return { error: 'google_oauth_failed' };
        }
      },
      {
        body: t.Object({
          code: t.String(),
          redirectUri: t.Optional(t.String()),
        }),
      },
    )
    .post('/auth/guest', async () => {
      const user = await createUser(db, {
        displayName: 'Guest Player',
        provider: 'guest',
      });
      const { token, expiresAt } = await createAuthSession(db, user.id);
      return {
        token,
        expiresAt,
        user: userToApi(user),
      };
    })
    .get(
      '/auth/email',
      async ({ query, set }) => {
        const email = normalizeAuthEmail(query.email);
        if (!email.includes('@')) {
          set.status = 400;
          return { error: 'invalid_email' };
        }
        const user = await getUserByEmail(db, email);
        return { exists: Boolean(user) };
      },
      {
        query: t.Object({
          email: t.String({ minLength: 3, maxLength: 255 }),
        }),
      },
    )
    .post(
      '/auth/register',
      async ({ body, set }) => {
        const result = await registerWithPassword(db, body);
        if (!result.ok) {
          if (result.error === 'email_taken') set.status = 409;
          else set.status = 400;
          return { error: result.error };
        }
        return {
          token: result.token,
          expiresAt: result.expiresAt,
          user: userToApi(result.user),
        };
      },
      {
        body: t.Object({
          email: authEmailBody,
          password: authPasswordBody,
          displayName: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
        }),
      },
    )
    .post(
      '/auth/login',
      async ({ body, set }) => {
        const result = await loginWithPassword(db, body);
        if (!result.ok) {
          set.status = 401;
          return { error: result.error };
        }
        return {
          token: result.token,
          expiresAt: result.expiresAt,
          user: userToApi(result.user),
        };
      },
      {
        body: t.Object({
          email: authEmailBody,
          password: authPasswordBody,
        }),
      },
    )
    .patch(
      '/auth/password',
      async ({ body, request, set }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        const result = await changeUserPassword(db, user.id, body);
        if (!result.ok) {
          if (result.error === 'wrong_password') set.status = 401;
          else if (result.error === 'password_not_set') set.status = 400;
          else set.status = 400;
          return { error: result.error };
        }
        return { ok: true };
      },
      {
        body: t.Object({
          currentPassword: t.Optional(authPasswordBody),
          newPassword: authPasswordBody,
        }),
      },
    )
    .post(
      '/auth/session',
      async ({ body }) => {
        const displayName =
          body.displayName?.trim() ||
          body.email?.split('@')[0]?.replace(/[._]/g, ' ') ||
          'Sudoku Player';
        let user = body.email ? await getUserByEmail(db, body.email.trim()) : null;

        if (!user) {
          user = await createUser(db, {
            email: body.email?.trim() ?? null,
            displayName,
            provider: body.provider,
          });
        } else {
          await patchProfile(db, user.id, { displayName });
        }

        const full = (await getUserById(db, user.id))!;
        const { token, expiresAt } = await createAuthSession(db, user.id);
        return {
          token,
          expiresAt,
          session: {
            version: 1,
            signedIn: true,
            provider: body.provider,
            email: body.email ?? '',
            displayName,
            signedInAt: isoNow(),
          },
          user: userToApi(full),
        };
      },
      {
        body: t.Object({
          provider: t.Union([t.Literal('google'), t.Literal('email')]),
          email: t.Optional(t.String()),
          displayName: t.Optional(t.String()),
        }),
      },
    )
    .get(
      '/leaderboards',
      async ({ query, set }) => {
        const typeRaw = query.type as string;
        const type =
          typeRaw === 'points' || typeRaw === 'wins' ? 'points' : typeRaw === 'speed' ? 'speed' : null;
        const period = (query.period ?? 'all') as 'all' | '30d' | '7d' | 'today';
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));
        const cursor = Math.max(0, Number(query.cursor ?? 0) || 0);
        const modeRaw = query.mode;
        const difficultyIdRaw = query.difficultyId;

        if (!type) {
          set.status = 400;
          return { error: 'invalid_type' };
        }
        if (period !== 'all' && period !== '30d' && period !== '7d' && period !== 'today') {
          set.status = 400;
          return { error: 'invalid_period' };
        }

        const mode =
          modeRaw === 'classic' || modeRaw === 'hell' ? (modeRaw as 'classic' | 'hell') : ('hell' as const);
        const difficultyId =
          difficultyIdRaw &&
          ['easy', 'medium', 'hard', 'expert', 'master'].includes(difficultyIdRaw)
            ? difficultyIdRaw
            : ('master' as const);

        const pageSize = limit + 1;
        const rows =
          type === 'points'
            ? await listLeaderboardPoints(db, { period, limit: pageSize, cursor, mode, difficultyId })
            : await listLeaderboardSpeed(db, { period, limit: pageSize, cursor, mode, difficultyId });

        const visible = rows.filter((r) => r.value > 0);
        const hasMore = visible.length > limit;
        const slice = visible.slice(0, limit);
        return {
          entries: slice.map((r, idx) => ({
            rank: idx + 1 + cursor,
            userId: r.userId,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
            value: r.value,
            updatedAt: r.updatedAt,
          })),
          nextCursor: hasMore ? String(cursor + limit) : null,
        };
      },
      {
        query: t.Object({
          type: t.String(),
          period: t.Optional(t.String()),
          limit: t.Optional(t.Union([t.String(), t.Number()])),
          cursor: t.Optional(t.String()),
          mode: t.Optional(t.String()),
          difficultyId: t.Optional(t.String()),
        }),
      },
    )
    .post(
      '/stats/play-events',
      async ({ body, request }) => {
        const playMode = parsePlayMode(body.playMode);
        const difficultyId = parseDifficultyId(body.difficultyId);
        if (!playMode || !difficultyId) {
          throw new Error('INVALID_PLAY_STATS');
        }
        const completedAt = body.completedAt?.trim() || isoNow();
        const country = countryFromRequest(request.headers);
        const row = await insertAnonymousPlayEvent(db, {
          playMode,
          difficultyId,
          completedAt,
          country,
        });
        return row;
      },
      {
        body: t.Object({
          playMode: t.Union([t.Literal('classic'), t.Literal('hell')]),
          difficultyId: t.String(),
          completedAt: t.Optional(t.String()),
        }),
      },
    )
    .get(
      '/stats/play-events/summary',
      async ({ query }) => {
        const period = parsePlayStatsPeriod(query.period);
        const playModeRaw = query.playMode?.trim();
        const difficultyRaw = query.difficultyId?.trim();
        const playMode = playModeRaw ? parsePlayMode(playModeRaw) : null;
        const difficultyId = difficultyRaw ? parseDifficultyId(difficultyRaw) : null;
        if (playModeRaw && !playMode) throw new Error('INVALID_PLAY_STATS');
        if (difficultyRaw && !difficultyId) throw new Error('INVALID_PLAY_STATS');
        return buildAnonymousPlayStatsSummary(db, period, { playMode, difficultyId });
      },
      {
        query: t.Object({
          period: t.Optional(t.String()),
          playMode: t.Optional(t.String()),
          difficultyId: t.Optional(t.String()),
        }),
      },
    )
    .get('/auth/session', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const profile = await getProfile(db, user.id);
      return {
        user: userToApi(user),
        profile: {
          displayName: user.displayName,
          bio: profile?.bio ?? '',
          publicProfile: profile?.publicProfile ?? true,
        },
      };
    })
    .delete('/auth/session', async ({ request }) => {
      await deleteAuthSessionByToken(db, request.headers.get('authorization') ?? undefined);
      return { ok: true };
    })
    .get('/users/me', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const profile = await getProfile(db, user.id);
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      const summary = buildSummary(completions, daily);
      const locale = request.headers.get('accept-language')?.startsWith('zh') ? 'zh' : 'en';
      return {
        user: userToApi(user),
        profile: {
          displayName: user.displayName,
          bio: profile?.bio ?? '',
          publicProfile: profile?.publicProfile ?? true,
        },
        summary,
        rank: getProfileRankLabel(locale, summary.wins),
        milestone: buildProfileMilestone(completions, daily),
        hellMode: buildHellModeProgress(completions, daily),
      };
    })
    .patch(
      '/users/me',
      async ({ body, request }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        await patchProfile(db, user.id, {
          displayName: body.displayName,
          bio: body.bio,
          publicProfile: body.publicProfile,
        });
        return { ok: true };
      },
      {
        body: t.Object({
          displayName: t.Optional(t.String()),
          bio: t.Optional(t.String()),
          publicProfile: t.Optional(t.Boolean()),
        }),
      },
    )
    .delete('/users/me', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      await deleteUserData(db, user.id);
      await deleteAuthSessionByToken(db, request.headers.get('authorization') ?? undefined);
      return { ok: true };
    })
    .get('/users/me/settings', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      return JSON.parse(await getSettings(db, user.id));
    })
    .patch(
      '/users/me/settings',
      async ({ body, request }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        await patchSettings(db, user.id, JSON.stringify(body));
        return { ok: true };
      },
      {
        body: t.Object({
          mistakeLimit: t.Union([
            t.Literal('3'),
            t.Literal('5'),
            t.Literal('unlimited'),
          ]),
          highlightMatching: t.Boolean(),
          highlightRelated: t.Boolean(),
          showTimer: t.Boolean(),
        }),
      },
    )
    .get('/users/me/progress', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const session = await getGameSession(db, user.id);
      const completions = await listCompletions(db, user.id);
      const dailyCompletions = await listDailyCompletions(db, user.id);
      return {
        activeSession: session ? sessionToApi(session) : null,
        completions: completions.map(completionToApi),
        dailyCompletions: dailyCompletions.map(dailyToApi),
      };
    })
    .put(
      '/users/me/progress/session',
      async ({ body, request }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        await upsertGameSession(db, user.id, {
          playMode: body.playMode,
          difficultyId: body.difficultyId,
          dailyDateKey: body.dailyDateKey ?? null,
          puzzleTemplateJson: JSON.stringify(body.puzzleTemplate),
          solutionJson: JSON.stringify(body.solution),
          cagesJson: body.cages != null ? JSON.stringify(body.cages) : null,
          gridJson: JSON.stringify(body.grid),
          notesJson: JSON.stringify(body.notes),
          mistakes: body.mistakes,
          hintsUsed: body.hintsUsed,
          elapsedSeconds: body.elapsedSeconds,
        });
        return { ok: true };
      },
      {
        body: t.Object({
          playMode: t.Union([t.Literal('classic'), t.Literal('hell')]),
          difficultyId: t.String(),
          dailyDateKey: t.Optional(t.String()),
          puzzleTemplate: t.Any(),
          solution: t.Any(),
          cages: t.Optional(t.Any()),
          grid: t.Any(),
          notes: t.Any(),
          mistakes: t.Number(),
          hintsUsed: t.Number(),
          elapsedSeconds: t.Number(),
        }),
      },
    )
    .delete('/users/me/progress/session', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      await deleteGameSession(db, user.id);
      return { ok: true };
    })
    .post(
      '/games/completions',
      async ({ body, request }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        const id = newId();
        const completedAt = isoNow();
        await insertCompletion(db, user.id, {
          id,
          playMode: body.playMode,
          difficultyId: body.difficultyId,
          dailyDateKey: body.dailyDateKey ?? null,
          result: body.result,
          elapsedSeconds: body.elapsedSeconds,
          mistakes: body.mistakes,
          hintsUsed: body.hintsUsed,
          completedAt,
        });
        await deleteGameSession(db, user.id);
        return { id, completedAt };
      },
      {
        body: t.Object({
          playMode: t.Union([t.Literal('classic'), t.Literal('hell')]),
          difficultyId: t.String(),
          dailyDateKey: t.Optional(t.String()),
          result: t.Union([t.Literal('win'), t.Literal('loss')]),
          elapsedSeconds: t.Number(),
          mistakes: t.Number(),
          hintsUsed: t.Number(),
        }),
      },
    )
    .get('/daily/challenges/:dateKey', async ({ params, query, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const selection = parseDailyChallengeQuery(query);
      const definition = getDailyChallengeDefinitionV2(params.dateKey, selection);
      const completion = await getDailyCompletion(
        db,
        user.id,
        definition.dateKey,
        definition.mode,
        definition.difficultyId,
      );
      const daily = await listDailyCompletions(db, user.id);
      return {
        definition,
        completed: Boolean(completion),
        completion: completion ? dailyToApi(completion) : null,
        streak: buildSummary([], daily).dailyStreak,
        totalCompletions: daily.length,
      };
    })
    .post(
      '/daily/completions',
      async ({ body, request }) => {
        const user = await requireUser(request.headers.get('authorization') ?? undefined);
        const playMode = body.playMode === 'hell' ? 'hell' : 'classic';
        const existing = await getDailyCompletion(
          db,
          user.id,
          body.dateKey,
          playMode,
          body.difficultyId,
        );
        if (existing) {
          return {
            ok: true,
            alreadyCompleted: true,
            completedAt: existing.completedAt,
            completion: dailyToApi(existing),
          };
        }
        const completedAt = isoNow();
        await upsertDailyCompletion(db, user.id, {
          dateKey: body.dateKey,
          playMode,
          difficultyId: body.difficultyId,
          elapsedSeconds: body.elapsedSeconds,
          mistakes: body.mistakes,
          hintsUsed: body.hintsUsed,
          completedAt,
        });
        await deleteGameSession(db, user.id);
        return { ok: true, alreadyCompleted: false, completedAt };
      },
      {
        body: t.Object({
          dateKey: t.String(),
          playMode: t.Optional(t.Union([t.Literal('classic'), t.Literal('hell')])),
          difficultyId: t.String(),
          elapsedSeconds: t.Number(),
          mistakes: t.Number(),
          hintsUsed: t.Number(),
        }),
      },
    )
    .get('/users/me/stats', async ({ query, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const period = (query.period ?? '30d') as StatsPeriod;
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      return buildDerivedStats(completions, daily, period);
    })
    .get('/users/me/stats/difficulty-chart', async ({ query, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const period = (query.period ?? '30d') as StatsPeriod;
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      const community = await listCommunityStats(db);
      return { bars: buildDifficultyChart(completions, daily, period, community) };
    })
    .get('/users/me/stats/achievements', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      return buildStatsAchievementUnlocks(completions, daily);
    })
    .get('/users/me/achievements', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      return buildAchievementHallView(completions, daily);
    })
    .get('/users/me/activity', async ({ query, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const locale = query.locale === 'zh' ? 'zh' : 'en';
      const { types, range } = parseActivityQuery(query);
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      const allEntries = buildActivityFeed(completions, daily, locale);
      const entries = filterActivityEntries(allEntries, types, range);
      const filteredCompletions =
        types.includes('games')
          ? completions.filter((c) => isWithinPeriod(c.completedAt, range))
          : [];
      const filteredDaily =
        types.includes('daily')
          ? daily.filter((d) => isWithinPeriod(d.dateKey, range))
          : [];
      return {
        summary: buildActivitySummary(
          types.includes('games') ? filteredCompletions : [],
          types.includes('daily') ? filteredDaily : [],
          locale,
        ),
        entries,
      };
    })
    .get('/users/me/feedback', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const rows = await listFeedbackForUser(db, user.id);
      return {
        entries: rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          subject: r.subject,
          message: r.message,
          createdAt: r.createdAt,
        })),
      };
    })
    .get(
      '/feedback/entries',
      async ({ query, request }) => {
        await requireFeedbackAdmin(request.headers.get('authorization') ?? undefined);
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
        const cursor = Math.max(0, Number(query.cursor ?? 0) || 0);
        const rows = await listAllFeedback(db, { limit, cursor });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
          entries: page.map((r) => ({
            id: r.id,
            userId: r.userId,
            name: r.name,
            email: r.email,
            subject: r.subject,
            message: r.message,
            createdAt: r.createdAt,
          })),
          nextCursor: hasMore ? String(cursor + limit) : null,
        };
      },
      {
        query: t.Object({
          limit: t.Optional(t.String()),
          cursor: t.Optional(t.String()),
        }),
      },
    )
    .get('/users/me/rank', async ({ query, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const locale = query.locale === 'zh' ? 'zh' : 'en';
      const completions = await listCompletions(db, user.id);
      const daily = await listDailyCompletions(db, user.id);
      const summary = buildSummary(completions, daily);
      return { rank: getProfileRankLabel(locale, summary.wins) };
    })
    .post(
      '/feedback',
      async ({ body, request }) => {
        const auth = request.headers.get('authorization') ?? undefined;
        const user = await resolveUserByToken(db, auth ?? null);
        const id = await insertFeedback(db, {
          userId: user?.id ?? null,
          name: body.name ?? '',
          email: body.email ?? '',
          subject: body.subject ?? '',
          message: body.message,
        });
        return { id };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          email: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          message: t.String(),
        }),
      },
    )
    .get('/users/me/bookmarks', async ({ request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      return { slugs: await listBookmarks(db, user.id) };
    })
    .put('/users/me/bookmarks/:slug', async ({ params, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      await addBookmark(db, user.id, params.slug);
      return { ok: true };
    })
    .delete('/users/me/bookmarks/:slug', async ({ params, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      await removeBookmark(db, user.id, params.slug);
      return { ok: true };
    })
    .get('/site/not-found', ({ query }) => {
      const locale = query.locale === 'zh' ? 'zh' : 'en';
      const prefix = `/${locale}`;
      const links = [
        { id: 'home', path: `${prefix}/`, icon: 'home' },
        { id: 'play', path: `${prefix}/play?difficulty=medium`, icon: 'sports_esports' },
        { id: 'daily', path: `${prefix}/daily`, icon: 'calendar_today' },
        { id: 'levels', path: `${prefix}/levels`, icon: 'layers' },
        { id: 'stats', path: `${prefix}/stats`, icon: 'analytics' },
      ];
      return { links };
    });
}
