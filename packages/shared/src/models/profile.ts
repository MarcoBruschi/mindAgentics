/**
 * User Profile & Gamification Domain Models
 * Profile progression, stats, badges, and XP mechanics for mindAgentics.
 */

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface UserBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: BadgeTier;
  unlockedAt?: string;
  progress?: number;
  maxProgress?: number;
}

export interface OrchestratorStats {
  recruitsCount: number;
  tasksDelegated: number;
  portalsOpened: number;
  knowledgeGraphsBuilt: number;
  routinesExecuted: number;
  totalCanvasTimeMinutes: number;
}

export interface UserProfile {
  id: string;
  name: string;
  callsign: string;
  avatarId: string;
  avatarUrl?: string;
  title: string;
  level: number;
  currentXp: number;
  xpToNextLevel: number;
  totalXp: number;
  streakDays: number;
  longestStreakDays?: number;
  lastActiveDate: string;
  activityHistory?: Record<string, number>;
  hasCompletedOnboarding?: boolean;
  badges: UserBadge[];
  stats: OrchestratorStats;
}

export const INITIAL_BADGES: UserBadge[] = [];

export function getTitleForLevel(level: number): string {
  if (level <= 1) return 'Aprendiz de Orquestrador';
  if (level === 2) return 'Compositor de Agentes';
  if (level === 3) return 'Condutor de Enxame';
  if (level === 4) return 'Arquiteto de Inteligência';
  if (level === 5) return 'Orquestrador Cibernético';
  if (level === 6) return 'Mestre Orquestrador';
  if (level === 7) return 'Grande Regente Autônomo';
  if (level === 8) return 'Virtuoso Cognitivo';
  if (level === 9) return 'Lorde de Sistemas';
  return 'Soberano do Canvas';
}

export function calculateLevelAndXp(totalXp: number): {
  level: number;
  currentXp: number;
  xpToNextLevel: number;
  title: string;
} {
  const xp = Math.max(0, Math.floor(totalXp));
  let lvl = 1;
  let accumulated = 0;

  while (true) {
    const required = 100 * lvl;
    if (xp < accumulated + required) {
      const currentXp = xp - accumulated;
      const xpToNextLevel = required - currentXp;
      return {
        level: lvl,
        currentXp,
        xpToNextLevel,
        title: getTitleForLevel(lvl),
      };
    }
    accumulated += required;
    lvl++;
  }
}

export function createDefaultProfile(): UserProfile {
  const today = new Date().toISOString().split('T')[0];
  const initialLvl = calculateLevelAndXp(0);
  return {
    id: 'user-default',
    name: 'Orchestrator',
    callsign: 'ARCHITECT-01',
    avatarId: 'avatar-conductor',
    title: initialLvl.title,
    level: initialLvl.level,
    currentXp: initialLvl.currentXp,
    xpToNextLevel: initialLvl.xpToNextLevel,
    totalXp: 0,
    streakDays: 1,
    longestStreakDays: 1,
    activityHistory: { [today]: 1 },
    lastActiveDate: today,
    hasCompletedOnboarding: false,
    badges: [],
    stats: {
      recruitsCount: 0,
      tasksDelegated: 0,
      portalsOpened: 0,
      knowledgeGraphsBuilt: 0,
      routinesExecuted: 0,
      totalCanvasTimeMinutes: 0,
    },
  };
}
