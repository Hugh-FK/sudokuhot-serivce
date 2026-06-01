import type { gameCompletions, userDailyCompletions } from '../db/schema';
import { buildSummary, formatTime, isWithinPeriod, type StatsPeriod } from './aggregates';
import { computeStreak } from '../lib/daily-catalog';

export type ActivityFeedKind = 'games' | 'achievements' | 'daily';
export type ActivityRange = StatsPeriod;

const ALL_ACTIVITY_KINDS: ActivityFeedKind[] = ['games', 'achievements', 'daily'];

export function parseActivityQuery(query: {
  types?: string;
  range?: string;
}): { types: ActivityFeedKind[]; range: ActivityRange } {
  const parsedTypes = (query.types ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is ActivityFeedKind =>
      ALL_ACTIVITY_KINDS.includes(t as ActivityFeedKind),
    );
  const rangeRaw = query.range ?? '30d';
  const range: ActivityRange = ['7d', '30d', 'month', 'year'].includes(rangeRaw)
    ? (rangeRaw as ActivityRange)
    : '30d';
  return {
    types: parsedTypes.length > 0 ? parsedTypes : [...ALL_ACTIVITY_KINDS],
    range,
  };
}

type ActivityEntry = ReturnType<typeof buildActivityFeed>[number];

export function filterActivityEntries(
  entries: ActivityEntry[],
  types: ActivityFeedKind[],
  range: ActivityRange,
  reference = new Date(),
): ActivityEntry[] {
  return entries.filter((e) => {
    if (!types.includes(e.kind)) return false;
    return isWithinPeriod(e.dateKey, range, reference);
  });
}

type CompletionRow = typeof gameCompletions.$inferSelect;
type DailyRow = typeof userDailyCompletions.$inferSelect;

const DIFF_LABEL: Record<string, { en: string; zh: string }> = {
  easy: { en: 'Easy', zh: '简单' },
  medium: { en: 'Medium', zh: '中等' },
  hard: { en: 'Hard', zh: '困难' },
  expert: { en: 'Expert', zh: '专家' },
  master: { en: 'Master', zh: '大师' },
};

const GAME_ICON =
  'bg-[var(--zen-secondary-container)] text-[var(--zen-on-secondary-container)]';
const DAILY_ICON =
  'bg-[var(--zen-tertiary-container)] text-[var(--zen-on-tertiary-container)]';
const ACHIEVEMENT_ICON =
  'bg-[var(--zen-primary-container)] text-[var(--zen-on-primary-fixed)]';
const LOSS_ICON =
  'bg-[var(--zen-surface-container-highest)] text-[var(--zen-outline)]';

function xpForWin(difficultyId: string, seconds: number): number {
  const base: Record<string, number> = {
    easy: 50,
    medium: 100,
    hard: 150,
    expert: 200,
    master: 250,
  };
  const bonus = seconds < 300 ? 50 : 0;
  return (base[difficultyId] ?? 100) + bonus;
}

function dayKeyFromIso(iso: string): string {
  if (iso.length >= 10 && !iso.includes('T')) return iso.slice(0, 10);
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPlayDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function buildActivityFeed(
  completions: CompletionRow[],
  daily: DailyRow[],
  locale: 'en' | 'zh',
) {
  const zh = locale === 'zh';
  const entries: {
    key: string;
    kind: 'games' | 'achievements' | 'daily';
    dateKey: string;
    completedAt: string;
    icon: string;
    iconFilled?: boolean;
    iconCircle: string;
    badgeVariant: 'xp-positive' | 'xp-negative' | 'earned' | 'collected';
    dimmed?: boolean;
    title: string;
    subtitle: string;
    badge: string;
  }[] = [];

  for (const c of completions) {
    const time = formatTime(c.elapsedSeconds);
    const diff = DIFF_LABEL[c.difficultyId] ?? { en: c.difficultyId, zh: c.difficultyId };
    const diffLabel = zh ? diff.zh : diff.en;
    const dateKey = dayKeyFromIso(c.completedAt);
    const win = c.result === 'win';
    entries.push({
      key: c.id,
      kind: 'games',
      dateKey,
      completedAt: c.completedAt,
      icon: win ? 'sports_esports' : 'history',
      iconCircle: win ? GAME_ICON : LOSS_ICON,
      badgeVariant: win ? 'xp-positive' : 'xp-negative',
      dimmed: !win,
      title: zh ? `完成对局：${diffLabel}` : `Game Finished: ${diffLabel}`,
      subtitle: zh
        ? `用时 ${time} • 结果：${win ? '胜利' : '失败'}`
        : `Time: ${time} • Result: ${win ? 'Win' : 'Loss'}`,
      badge: win ? `+${xpForWin(c.difficultyId, c.elapsedSeconds)} XP` : '-10 XP',
    });
  }

  for (const d of daily) {
    const dateLabel = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(d.dateKey.replace(/-/g, '/')));
    entries.push({
      key: `daily-${d.dateKey}`,
      kind: 'daily',
      dateKey: d.dateKey,
      completedAt: d.completedAt,
      icon: 'event_available',
      iconCircle: DAILY_ICON,
      badgeVariant: 'collected',
      title: zh ? '每日挑战完成' : 'Daily Challenge Completed',
      subtitle: zh
        ? `${dateLabel} • 奖励：Sudoku Hot 徽章`
        : `${dateLabel} • Reward: Sudoku Hot Badge`,
      badge: zh ? '已领取' : 'COLLECTED',
    });
  }

  const streak = computeStreak(daily.map((d) => d.dateKey));
  if (streak >= 7) {
    entries.push({
      key: 'achievement-weekly',
      kind: 'achievements',
      dateKey: dayKeyFromIso(new Date().toISOString()),
      completedAt: new Date().toISOString(),
      icon: 'stars',
      iconFilled: true,
      iconCircle: ACHIEVEMENT_ICON,
      badgeVariant: 'earned',
      title: zh ? '成就解锁' : 'Achievement Unlocked',
      subtitle: zh
        ? '周度战士 • 连续 7 天完成每日挑战'
        : 'Weekly Warrior • 7-day daily streak',
      badge: zh ? '已获得' : 'EARNED',
    });
  }

  entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return entries;
}

export function buildActivitySummary(
  completions: CompletionRow[],
  daily: DailyRow[],
  locale: 'en' | 'zh',
) {
  const s = buildSummary(completions, daily);
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(n);
  return {
    totalTime: formatPlayDuration(Math.max(s.totalPlaySeconds, 0)),
    gamesCompleted: fmt(s.totalGames),
    winStreak: locale === 'zh' ? `${s.dailyStreak} 局` : `${s.dailyStreak} games`,
  };
}
