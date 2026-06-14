export const PLAY_MODES = ['classic', 'hell'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

export const DIFFICULTY_IDS = ['easy', 'medium', 'hard', 'expert', 'master'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export type PlayStatsPeriod = '7d' | '30d' | 'all';

export function parsePlayMode(raw: string): PlayMode | null {
  return PLAY_MODES.includes(raw as PlayMode) ? (raw as PlayMode) : null;
}

export function parseDifficultyId(raw: string): DifficultyId | null {
  return DIFFICULTY_IDS.includes(raw as DifficultyId) ? (raw as DifficultyId) : null;
}

export function parsePlayStatsPeriod(raw: string | undefined): PlayStatsPeriod {
  if (raw === '7d' || raw === '30d' || raw === 'all') return raw;
  return '30d';
}

/** Cloudflare Workers injects CF-IPCountry (ISO 3166-1 alpha-2). Local dev → XX. */
export function countryFromRequest(headers: Headers): string {
  const raw = headers.get('CF-IPCountry')?.trim().toUpperCase();
  if (!raw || raw === 'T1') return 'XX';
  return /^[A-Z]{2}$/.test(raw) ? raw : 'XX';
}

export function periodStartIso(period: PlayStatsPeriod, now = new Date()): string | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : 30;
  const start = new Date(now.getTime() - days * 86_400_000);
  return start.toISOString();
}
