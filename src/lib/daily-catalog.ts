/** 与前端 daily-challenge/catalog.ts 规则保持一致 */

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert' | 'master';
export type DailyPlayMode = 'classic' | 'hell';

const DAILY_TIP_IDS = [
  'focusBoxes',
  'singleCandidate',
  'pencilMarks',
  'scanRows',
  'hiddenSingle',
  'breathing',
] as const;

const PLAY_MODES: DailyPlayMode[] = ['classic', 'hell'];

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildPuzzleSeed(dateKey: string, difficultyId: DifficultyId): string {
  return `daily:${dateKey}:${difficultyId}`;
}

export function buildPuzzleSeedV2(
  dateKey: string,
  mode: DailyPlayMode,
  difficultyId: DifficultyId,
): string {
  return `daily:${dateKey}:${mode}:${difficultyId}`;
}

function pickTipId(dateKey: string): string {
  const date = new Date(dateKey.replace(/-/g, '/'));
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return DAILY_TIP_IDS[dayOfYear % DAILY_TIP_IDS.length] ?? 'focusBoxes';
}

function parsePlayMode(raw: string | undefined): DailyPlayMode {
  return raw === 'hell' ? 'hell' : 'classic';
}

function parseDifficultyId(raw: string | undefined): DifficultyId {
  const ids: DifficultyId[] = ['easy', 'medium', 'hard', 'expert', 'master'];
  return ids.includes(raw as DifficultyId) ? (raw as DifficultyId) : 'medium';
}

export function getDailyChallengeDefinition(dateKey: string, reference = new Date()) {
  return getDailyChallengeDefinitionV2(dateKey, { mode: 'classic', difficultyId: 'medium' }, reference);
}

export function getDailyChallengeDefinitionV2(
  dateKey: string,
  selection: { mode: DailyPlayMode; difficultyId: DifficultyId },
  reference = new Date(),
) {
  const parsed = new Date(dateKey.replace(/-/g, '/'));
  const isValid = !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === dateKey;
  const key = isValid ? dateKey : toDateKey(reference);
  const mode = parsePlayMode(selection.mode);
  const difficultyId = parseDifficultyId(selection.difficultyId);

  return {
    dateKey: key,
    mode,
    difficultyId,
    puzzleSeed: buildPuzzleSeedV2(key, mode, difficultyId),
    reward: { type: 'badge' as const, id: 'sudoku-hot-daily' },
    tipId: pickTipId(key),
  };
}

export function parseDailyChallengeQuery(query: {
  mode?: string;
  difficulty?: string;
}): { mode: DailyPlayMode; difficultyId: DifficultyId } {
  return {
    mode: parsePlayMode(query.mode),
    difficultyId: parseDifficultyId(query.difficulty),
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

export { PLAY_MODES };
