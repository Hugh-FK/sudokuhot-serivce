/** Static achievement card metadata (labels come from the client i18n). */
export type AchievementHallId =
  | 'masterOfLogic'
  | 'grandmasterRealm'
  | 'centurion'
  | 'eliteTactician'
  | 'speedDemon'
  | 'unstoppable'
  | 'sonicSolver'
  | 'marathonMan'
  | 'killerKing'
  | 'patternSeer'
  | 'sudokuZen'
  | 'theSpecialist';

export type AchievementBadgeTone = 'primary' | 'secondary' | 'tertiary';

export type AchievementHallCard = {
  id: AchievementHallId;
  icon: string;
  iconVariant?: string;
  unlocked: boolean;
  badgeTone?: AchievementBadgeTone;
  progress?: { current: number; total: number };
  lockOnly?: boolean;
};

export const ACHIEVEMENT_HALL_SUMMARY = {
  unlocked: 12,
  total: 40,
  progressPercent: 30,
  gold: 3,
  silver: 5,
  bronze: 4,
} as const;

export const ACHIEVEMENT_RECENT = [
  { achievementId: 'masterOfLogic' as const, icon: 'stars', iconTone: 'yellow' as const, timeKey: 'hours2' as const },
  { achievementId: 'speedDemon' as const, icon: 'timer', iconTone: 'blue' as const, timeKey: 'yesterday' as const },
  { achievementId: 'weeklyWarrior' as const, icon: 'calendar_today', iconTone: 'green' as const, timeKey: 'days3' as const },
] as const;

export const ACHIEVEMENT_CATEGORIES: {
  id: 'progression' | 'speed' | 'special';
  achievements: AchievementHallCard[];
}[] = [
  {
    id: 'progression',
    achievements: [
      { id: 'masterOfLogic', icon: 'psychology', iconVariant: 'primary-fixed', unlocked: true, badgeTone: 'primary', progress: { current: 50, total: 50 } },
      { id: 'grandmasterRealm', icon: 'castle', unlocked: false, progress: { current: 325, total: 500 } },
      { id: 'centurion', icon: 'emoji_events', iconVariant: 'secondary-container', unlocked: true, badgeTone: 'secondary', progress: { current: 100, total: 100 } },
      { id: 'eliteTactician', icon: 'trophy', unlocked: false, lockOnly: true },
    ],
  },
  {
    id: 'speed',
    achievements: [
      { id: 'speedDemon', icon: 'bolt', iconVariant: 'accent-sky', unlocked: true, badgeTone: 'secondary' },
      { id: 'unstoppable', icon: 'local_fire_department', iconVariant: 'tertiary-fixed', unlocked: true, badgeTone: 'tertiary' },
      { id: 'sonicSolver', icon: 'rocket_launch', unlocked: false, lockOnly: true },
      { id: 'marathonMan', icon: 'timer_10', unlocked: false, lockOnly: true },
    ],
  },
  {
    id: 'special',
    achievements: [
      { id: 'killerKing', icon: 'skull', iconVariant: 'primary-container', unlocked: true, badgeTone: 'primary', progress: { current: 10, total: 10 } },
      { id: 'patternSeer', icon: 'grid_view', unlocked: false, progress: { current: 8, total: 20 } },
      { id: 'sudokuZen', icon: 'auto_awesome', unlocked: false, lockOnly: true },
      { id: 'theSpecialist', icon: 'celebration', unlocked: false, lockOnly: true },
    ],
  },
];
