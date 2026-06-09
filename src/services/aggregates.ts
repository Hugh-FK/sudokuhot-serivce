import type { gameCompletions, userDailyCompletions } from '../db/schema';
import { computeStreak } from '../lib/daily-catalog';

export type CompletionRow = typeof gameCompletions.$inferSelect;
export type DailyCompletionRow = typeof userDailyCompletions.$inferSelect;

export type StatsPeriod = '7d' | '30d' | 'month' | 'year';

export function isWithinPeriod(dateKeyOrIso: string, period: StatsPeriod, today = new Date()): boolean {
  const day =
    dateKeyOrIso.length === 10 && !dateKeyOrIso.includes('T')
      ? new Date(dateKeyOrIso.replace(/-/g, '/'))
      : new Date(dateKeyOrIso);
  if (Number.isNaN(day.getTime())) return false;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);
  if (period === '7d') {
    const from = new Date(start);
    from.setDate(from.getDate() - 6);
    return day >= from && day <= end;
  }
  if (period === '30d') {
    const from = new Date(start);
    from.setDate(from.getDate() - 29);
    return day >= from && day <= end;
  }
  if (period === 'month') {
    return day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear();
  }
  return day.getFullYear() === today.getFullYear();
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function buildSummary(
  completions: CompletionRow[],
  daily: DailyCompletionRow[],
  reference = new Date(),
) {
  const dailyKeys = daily.map((d) => d.dateKey);
  const wins = completions.filter((c) => c.result === 'win');
  const losses = completions.filter((c) => c.result === 'loss');
  const totalGames = completions.length + daily.length;
  const winCount = wins.length + daily.length;

  let bestWinSeconds: number | null = null;
  let bestWinDifficulty: string | null = null;
  let totalPlaySeconds = 0;
  let timedGames = 0;
  for (const c of wins) {
    const elapsed = c.elapsedSeconds;
    if (elapsed <= 0) continue;
    totalPlaySeconds += elapsed;
    timedGames += 1;
    if (bestWinSeconds === null || elapsed < bestWinSeconds) {
      bestWinSeconds = elapsed;
      bestWinDifficulty = c.difficultyId;
    }
  }
  for (const d of daily) {
    const elapsed = d.elapsedSeconds;
    if (elapsed <= 0) continue;
    totalPlaySeconds += elapsed;
    timedGames += 1;
    if (bestWinSeconds === null || elapsed < bestWinSeconds) {
      bestWinSeconds = elapsed;
      bestWinDifficulty = d.difficultyId;
    }
  }

  const winRate = totalGames > 0 ? Math.round((winCount / totalGames) * 1000) / 10 : 0;

  return {
    totalGames,
    wins: winCount,
    losses: losses.length,
    winRate,
    totalPlaySeconds,
    bestWinSeconds,
    bestWinDifficulty,
    dailyStreak: computeStreak(dailyKeys, reference),
    dailyCompletions: daily.length,
    timedGames,
  };
}

export function buildDerivedStats(
  completions: CompletionRow[],
  daily: DailyCompletionRow[],
  period: StatsPeriod,
  reference = new Date(),
) {
  const filteredCompletions = completions.filter((c) =>
    isWithinPeriod(c.completedAt, period, reference),
  );
  const filteredDaily = daily.filter((d) => isWithinPeriod(d.dateKey, period, reference));
  const global = buildSummary(completions, daily, reference);
  const periodSummary = buildSummary(filteredCompletions, filteredDaily, reference);
  const hasLive = global.totalGames > 0;

  if (!hasLive) {
    return {
      useLiveData: false,
      totalGames: '0',
      winRate: 0,
      avgTime: '—',
      bestTime: '—',
      bestTimeDifficulty: 'medium',
      accuracy: '—',
      streakDays: 0,
      weeklyDone: 0,
      weeklyTotal: 7,
    };
  }

  const usePeriod = periodSummary.totalGames > 0;
  const totalGames = usePeriod ? periodSummary.totalGames : global.totalGames;
  const winRate = usePeriod ? periodSummary.winRate : global.winRate;
  const totalPlaySeconds = usePeriod
    ? periodSummary.totalPlaySeconds
    : global.totalPlaySeconds;
  const timedGames = usePeriod ? periodSummary.timedGames : global.timedGames;
  const avgSeconds =
    timedGames > 0 ? Math.round(totalPlaySeconds / timedGames) : 0;

  const finished = filteredCompletions.filter((c) => c.result === 'win' || c.result === 'loss');
  let accuracy = '—';
  if (finished.length > 0) {
    const flawless = filteredCompletions.filter(
      (c) => c.result === 'win' && c.mistakes === 0,
    ).length;
    accuracy = `${Math.round((flawless / finished.length) * 1000) / 10}%`;
  }

  const bestSeconds = usePeriod ? periodSummary.bestWinSeconds : global.bestWinSeconds;
  const bestDiff = usePeriod ? periodSummary.bestWinDifficulty : global.bestWinDifficulty;

  return {
    useLiveData: true,
    totalGames: String(totalGames),
    winRate,
    avgTime: timedGames > 0 ? formatTime(avgSeconds) : '—',
    bestTime: bestSeconds !== null && bestSeconds > 0 ? formatTime(bestSeconds) : '—',
    bestTimeDifficulty: bestDiff ?? 'medium',
    accuracy,
    streakDays: global.dailyStreak,
    weeklyDone: Math.min(global.dailyStreak, 7),
    weeklyTotal: 7,
  };
}

export function buildDifficultyChart(
  completions: CompletionRow[],
  daily: DailyCompletionRow[],
  period: StatsPeriod,
  community: { difficultyId: string; avgWinHeightPct: number }[],
  reference = new Date(),
) {
  const ids = ['easy', 'medium', 'hard', 'expert', 'master'] as const;
  const winsBy: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

  for (const c of completions) {
    if (c.result !== 'win' || !isWithinPeriod(c.completedAt, period, reference)) continue;
    if (c.difficultyId in winsBy) winsBy[c.difficultyId]! += 1;
  }
  for (const d of daily) {
    if (!isWithinPeriod(d.dateKey, period, reference)) continue;
    if (d.difficultyId in winsBy) winsBy[d.difficultyId]! += 1;
  }

  const totalWins = ids.reduce((s, id) => s + (winsBy[id] ?? 0), 0);
  const communityMap = Object.fromEntries(
    community.map((c) => [c.difficultyId, c.avgWinHeightPct]),
  );
  const maxWins = Math.max(...ids.map((id) => winsBy[id] ?? 0), 1);
  let topId = 'medium';
  for (const id of ids) {
    if ((winsBy[id] ?? 0) >= (winsBy[topId] ?? 0)) topId = id;
  }

  if (totalWins === 0) {
    return ids.map((id) => ({
      id,
      avgHeight: communityMap[id] ?? 40,
      winHeight: id === 'medium' ? 75 : 40,
      highlight: id === 'expert',
      useLiveData: false,
    }));
  }

  return ids.map((id) => {
    const wins = winsBy[id] ?? 0;
    const winHeight = wins > 0 ? Math.max(12, Math.round((wins / maxWins) * 100)) : 6;
    return {
      id,
      avgHeight: communityMap[id] ?? 40,
      winHeight,
      highlight: id === topId && wins > 0,
      useLiveData: true,
    };
  });
}

export function getProfileRankLabel(locale: string, totalWins: number): string {
  if (locale === 'zh') {
    if (totalWins >= 100) return '数独大师';
    if (totalWins >= 50) return 'Sudoku Hot 达人';
    if (totalWins >= 20) return '进阶玩家';
    if (totalWins >= 5) return '专注新手';
    return '初来乍到';
  }
  if (totalWins >= 100) return 'Sudoku Master';
  if (totalWins >= 50) return 'Sudoku Hot Pro';
  if (totalWins >= 20) return 'Rising Solver';
  if (totalWins >= 5) return 'Focused Beginner';
  return 'Newcomer';
}
