import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_HALL_SUMMARY,
  ACHIEVEMENT_RECENT,
  type AchievementHallCard,
  type AchievementHallId,
} from '../lib/achievement-catalog';
import { computeStreak } from '../lib/daily-catalog';
import type { gameCompletions, userDailyCompletions } from '../db/schema';
import { buildSummary } from './aggregates';

type CompletionRow = typeof gameCompletions.$inferSelect;
type DailyRow = typeof userDailyCompletions.$inferSelect;

function normalizeElapsedSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function dailyCompletionAsWin(d: DailyRow): CompletionRow {
  return {
    id: `daily-${d.userId}-${d.dateKey}-${d.playMode}-${d.difficultyId}`,
    userId: d.userId,
    playMode: d.playMode,
    difficultyId: d.difficultyId,
    dailyDateKey: d.dateKey,
    result: 'win',
    elapsedSeconds: normalizeElapsedSeconds(d.elapsedSeconds),
    mistakes: d.mistakes,
    hintsUsed: d.hintsUsed,
    completedAt: d.completedAt,
  };
}

function allAchievementWins(completions: CompletionRow[], daily: DailyRow[]): CompletionRow[] {
  const gameWins = completions
    .filter((c) => c.result === 'win')
    .map((c) => ({ ...c, elapsedSeconds: normalizeElapsedSeconds(c.elapsedSeconds) }));
  return [...gameWins, ...daily.map(dailyCompletionAsWin)];
}

type Evaluated = {
  unlocked: boolean;
  progress?: { current: number; total: number };
  badgeTone?: AchievementHallCard['badgeTone'];
  lockOnly?: boolean;
};

function countHardWinsNoHints(wins: CompletionRow[]) {
  return wins.filter((c) => c.difficultyId === 'hard' && c.hintsUsed === 0).length;
}

function countWinsThisMonthZeroMistakes(wins: CompletionRow[]) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return wins.filter((c) => {
    if (c.mistakes !== 0) return false;
    const d = new Date(c.completedAt);
    return d.getFullYear() === y && d.getMonth() === m;
  }).length;
}

function maxConsecutiveFlawlessFast(wins: CompletionRow[]) {
  const sorted = [...wins].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  let best = 0;
  let streak = 0;
  for (const c of sorted) {
    if (c.mistakes === 0 && c.elapsedSeconds <= 900) {
      streak += 1;
      best = Math.max(best, streak);
    } else {
      streak = 0;
    }
  }
  return best;
}

function evaluate(
  id: AchievementHallId,
  wins: CompletionRow[],
  summary: ReturnType<typeof buildSummary>,
): Evaluated {
  const totalWins = summary.wins;
  switch (id) {
    case 'masterOfLogic': {
      const current = countHardWinsNoHints(wins);
      return { unlocked: current >= 50, progress: { current: Math.min(current, 50), total: 50 }, badgeTone: 'primary' };
    }
    case 'grandmasterRealm': {
      const current = totalWins;
      return { unlocked: current >= 500, progress: { current: Math.min(current, 500), total: 500 }, badgeTone: 'primary' };
    }
    case 'centurion': {
      const current = countWinsThisMonthZeroMistakes(wins);
      return { unlocked: current >= 100, progress: { current: Math.min(current, 100), total: 100 }, badgeTone: 'secondary' };
    }
    case 'eliteTactician':
      return {
        unlocked: wins.some((c) => c.difficultyId === 'expert' && c.elapsedSeconds <= 300),
        lockOnly: !wins.some((c) => c.difficultyId === 'expert' && c.elapsedSeconds <= 300),
        badgeTone: 'secondary',
      };
    case 'speedDemon':
      return { unlocked: wins.some((c) => c.elapsedSeconds <= 180), badgeTone: 'secondary' };
    case 'unstoppable':
      return {
        unlocked: summary.dailyStreak >= 30,
        progress: { current: Math.min(summary.dailyStreak, 30), total: 30 },
        badgeTone: 'tertiary',
      };
    case 'sonicSolver': {
      const current = maxConsecutiveFlawlessFast(wins);
      return { unlocked: current >= 5, progress: { current: Math.min(current, 5), total: 5 }, lockOnly: current < 5 };
    }
    case 'marathonMan': {
      const longest = wins.reduce((max, c) => Math.max(max, c.elapsedSeconds), 0);
      const current = Math.min(longest, 7200);
      return { unlocked: longest >= 7200, progress: { current, total: 7200 }, lockOnly: longest < 7200 };
    }
    case 'killerKing': {
      const current = wins.filter((c) => c.playMode === 'hell').length;
      return { unlocked: current >= 10, progress: { current: Math.min(current, 10), total: 10 }, badgeTone: 'primary' };
    }
    case 'patternSeer': {
      const current = Math.min(wins.length, 20);
      return { unlocked: current >= 20, progress: { current, total: 20 } };
    }
    case 'sudokuZen':
    case 'theSpecialist':
      return { unlocked: false, lockOnly: true };
    default:
      return { unlocked: false, lockOnly: true };
  }
}

function mergeCard(base: AchievementHallCard, live: Evaluated): AchievementHallCard {
  if (live.lockOnly && !live.unlocked) {
    return { ...base, unlocked: false, lockOnly: true, progress: undefined };
  }
  return {
    ...base,
    unlocked: live.unlocked,
    progress: live.progress,
    badgeTone: live.unlocked ? live.badgeTone ?? base.badgeTone : base.badgeTone,
    lockOnly: live.lockOnly && !live.unlocked,
  };
}

function buildRecent(wins: CompletionRow[], summary: ReturnType<typeof buildSummary>, daily: DailyRow[]) {
  const items: {
    achievementId: AchievementHallId | 'weeklyWarrior';
    icon: string;
    iconTone: 'yellow' | 'blue' | 'green';
    completedAt: string;
    timeKey?: string;
  }[] = [];

  if (summary.dailyStreak >= 7) {
    const lastDaily = [...daily].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    items.push({
      achievementId: 'weeklyWarrior',
      icon: 'calendar_today',
      iconTone: 'green',
      completedAt: lastDaily?.completedAt ?? new Date().toISOString(),
    });
  }

  if (evaluate('speedDemon', wins, summary).unlocked) {
    const speedWin = [...wins]
      .filter((c) => c.elapsedSeconds <= 180)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (speedWin) {
      items.push({ achievementId: 'speedDemon', icon: 'timer', iconTone: 'blue', completedAt: speedWin.completedAt });
    }
  }

  if (evaluate('masterOfLogic', wins, summary).unlocked) {
    const hardWin = [...wins]
      .filter((c) => c.difficultyId === 'hard' && c.hintsUsed === 0)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (hardWin) {
      items.push({ achievementId: 'masterOfLogic', icon: 'stars', iconTone: 'yellow', completedAt: hardWin.completedAt });
    }
  }

  if (evaluate('killerKing', wins, summary).unlocked) {
    const hellWin = [...wins]
      .filter((c) => c.playMode === 'hell')
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (hellWin) {
      items.push({ achievementId: 'killerKing', icon: 'skull', iconTone: 'yellow', completedAt: hellWin.completedAt });
    }
  }

  return items.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 3);
}

export function buildAchievementHallView(
  completions: CompletionRow[],
  daily: DailyRow[],
) {
  const summary = buildSummary(completions, daily);
  const hasLive = summary.totalGames > 0;

  if (!hasLive) {
    const categories = ACHIEVEMENT_CATEGORIES.map((c) => ({
      id: c.id,
      achievements: c.achievements.map((a) => ({
        ...a,
        unlocked: false,
        lockOnly: true,
        progress: undefined,
      })),
    }));
    const total = categories.reduce((n, c) => n + c.achievements.length, 0);
    return {
      useLiveData: false,
      summary: { unlocked: 0, total, progressPercent: 0, gold: 0, silver: 0, bronze: 0 },
      recent: [],
      categories,
    };
  }

  const wins = allAchievementWins(completions, daily);
  const categories = ACHIEVEMENT_CATEGORIES.map((cat) => ({
    id: cat.id,
    achievements: cat.achievements.map((base) => mergeCard(base, evaluate(base.id, wins, summary))),
  }));

  const cards = categories.flatMap((c) => c.achievements);
  const unlockedCount = cards.filter((c) => c.unlocked).length;
  const total = cards.length;
  const countTone = (tone: NonNullable<AchievementHallCard['badgeTone']>) =>
    cards.filter((c) => c.unlocked && c.badgeTone === tone).length;

  const recent = buildRecent(wins, summary, daily);

  return {
    useLiveData: true,
    summary: {
      unlocked: unlockedCount,
      total,
      progressPercent: total > 0 ? Math.min(100, Math.round((unlockedCount / total) * 100)) : 0,
      gold: countTone('primary'),
      silver: countTone('secondary'),
      bronze: countTone('tertiary'),
    },
    recent:
      recent.length > 0
        ? recent
        : ACHIEVEMENT_RECENT.map((r) => ({
            achievementId: r.achievementId,
            icon: r.icon,
            iconTone: r.iconTone,
            completedAt: new Date().toISOString(),
            timeKey: r.timeKey,
          })),
    categories,
  };
}

export function buildStatsAchievementUnlocks(
  completions: CompletionRow[],
  daily: DailyRow[],
) {
  const summary = buildSummary(completions, daily);
  const wins = allAchievementWins(completions, daily);
  const hasLive = summary.totalGames > 0;
  if (!hasLive) {
    return {
      useLiveData: false,
      unlocked: {
        grandMaster: false,
        speedDemon: false,
        monthlyHero: false,
        zenWarrior: false,
        collector: false,
        deepThinker: false,
      },
    };
  }

  const evaluateId = (id: AchievementHallId) => evaluate(id, wins, summary).unlocked;

  return {
    useLiveData: true,
    unlocked: {
      grandMaster: summary.wins >= 10,
      speedDemon: wins.some((c) => c.elapsedSeconds <= 180) || evaluateId('speedDemon'),
      monthlyHero: summary.dailyStreak >= 7,
      zenWarrior: summary.dailyCompletions >= 14,
      collector: evaluateId('theSpecialist'),
      deepThinker: evaluateId('patternSeer'),
    },
  };
}

export function buildProfileMilestone(
  completions: CompletionRow[],
  daily: DailyRow[],
) {
  const TARGET = 15;
  const summary = buildSummary(completions, daily);
  if (summary.totalGames === 0) {
    return {
      useLiveData: true,
      current: 0,
      target: TARGET,
      percent: 0,
      remaining: TARGET,
    };
  }
  const wins = completions.filter((c) => c.result === 'win');
  const expertWins = wins.filter((c) => c.difficultyId === 'expert' || c.difficultyId === 'master').length;
  const current = Math.min(expertWins, TARGET);
  return {
    useLiveData: true,
    current,
    target: TARGET,
    percent: Math.min(100, Math.round((current / TARGET) * 100)),
    remaining: Math.max(0, TARGET - expertWins),
  };
}

export function buildHellModeProgress(completions: CompletionRow[], daily: DailyRow[]) {
  const summary = buildSummary(completions, daily);
  const wins = completions.filter((c) => c.result === 'win' && c.playMode === 'hell').length;
  if (summary.totalGames === 0 && wins === 0) {
    return { wins: 0, target: 10, useLiveData: false };
  }
  return { wins, target: 10, useLiveData: wins > 0 || summary.totalGames > 0 };
}
