/** 与前端 daily-challenge/catalog.ts 规则保持一致 */

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert' | 'master';

const DAILY_TIP_IDS = [
  'focusBoxes',
  'singleCandidate',
  'pencilMarks',
  'scanRows',
  'hiddenSingle',
  'breathing',
] as const;

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildPuzzleSeed(dateKey: string, difficultyId: DifficultyId): string {
  return `daily:${dateKey}:${difficultyId}`;
}

function pickTipId(dateKey: string): string {
  const date = new Date(dateKey.replace(/-/g, '/'));
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return DAILY_TIP_IDS[dayOfYear % DAILY_TIP_IDS.length] ?? 'focusBoxes';
}

export function getDailyChallengeDefinition(dateKey: string, reference = new Date()) {
  const difficultyId: DifficultyId = 'medium';
  const parsed = new Date(dateKey.replace(/-/g, '/'));
  const isValid = !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === dateKey;
  const key = isValid ? dateKey : toDateKey(reference);

  return {
    dateKey: key,
    difficultyId,
    puzzleSeed: buildPuzzleSeed(key, difficultyId),
    reward: { type: 'badge' as const, id: 'sudoku-hot-daily' },
    tipId: pickTipId(key),
  };
}

export function computeStreak(dateKeys: string[], reference = new Date()): number {
  if (dateKeys.length === 0) return 0;
  const set = new Set(dateKeys);
  let streak = 0;
  const cursor = new Date(reference);
  cursor.setHours(0, 0, 0, 0);
  for (;;) {
    const key = toDateKey(cursor);
    if (!set.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
