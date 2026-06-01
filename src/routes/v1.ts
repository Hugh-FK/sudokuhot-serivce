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
  insertFeedback,
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
import { getDailyChallengeDefinition } from '../lib/daily-catalog';
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

function sessionToApi(row: NonNullable<Awaited<ReturnType<typeof getGameSession>>>) {
  return {
    version: 1 as const,
    playMode: row.playMode as 'classic' | 'hell',
    difficultyId: row.difficultyId,
    dailyDateKey: row.dailyDateKey ?? undefined,
    puzzleTemplate: JSON.parse(row.puzzleTemplateJson),
    solution: JSON.parse(row.solutionJson),
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

  return new Elysia({ prefix: '/v1' })
    .onError(({ error, set }) => {
      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        set.status = 401;
        return { error: 'unauthorized' };
      }
      if (error instanceof Error && error.message === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
        set.status = 503;
        return { error: 'google_oauth_not_configured' };
      }
      if (error instanceof Error && error.message.startsWith('GOOGLE_')) {
        set.status = 400;
        return { error: 'google_oauth_failed' };
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
          mistakeLimit: t.Union([t.Literal('3'), t.Literal('5'), t.Literal('unlimited')]),
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
    .get('/daily/challenges/:dateKey', async ({ params, request }) => {
      const user = await requireUser(request.headers.get('authorization') ?? undefined);
      const definition = getDailyChallengeDefinition(params.dateKey);
      const completion = await getDailyCompletion(db, user.id, definition.dateKey);
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
        const completedAt = isoNow();
        await upsertDailyCompletion(db, user.id, {
          dateKey: body.dateKey,
          difficultyId: body.difficultyId,
          elapsedSeconds: body.elapsedSeconds,
          mistakes: body.mistakes,
          hintsUsed: body.hintsUsed,
          completedAt,
        });
        await deleteGameSession(db, user.id);
        return { ok: true, completedAt };
      },
      {
        body: t.Object({
          dateKey: t.String(),
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
