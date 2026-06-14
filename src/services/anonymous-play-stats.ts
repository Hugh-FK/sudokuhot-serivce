import type { AppDb } from '../db';
import { aggregateAnonymousPlayStats } from '../db/repos';
import type { DifficultyId, PlayMode, PlayStatsPeriod } from '../lib/play-stats';
import { periodStartIso } from '../lib/play-stats';

export async function buildAnonymousPlayStatsSummary(
  db: AppDb,
  period: PlayStatsPeriod,
  filters?: { playMode?: PlayMode | null; difficultyId?: DifficultyId | null },
) {
  const since = periodStartIso(period);
  const playMode = filters?.playMode ?? null;
  const difficultyId = filters?.difficultyId ?? null;
  const raw = await aggregateAnonymousPlayStats(db, { since, playMode, difficultyId });

  return {
    period,
    since: since ?? null,
    filters: { playMode, difficultyId },
    total: raw.total,
    byMode: Object.fromEntries(raw.byMode.map((r) => [r.playMode, r.count])),
    byDifficulty: Object.fromEntries(raw.byDifficulty.map((r) => [r.difficultyId, r.count])),
    byCountry: Object.fromEntries(raw.byCountry.map((r) => [r.country, r.count])),
    byDay: raw.byDay.map((r) => ({ date: r.date, count: r.count })),
  };
}
