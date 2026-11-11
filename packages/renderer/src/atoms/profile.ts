import { atom, useAtom } from 'jotai';
import { useEffect, useCallback } from 'react';
import type {
  UserProfile,
  OrchestratorStats,
  UserBadge,
} from '@mindagentics/shared';

export interface LevelUpToast {
  id: string;
  type: 'level-up' | 'badge-unlocked';
  title: string;
  description: string;
  level?: number;
  badge?: UserBadge;
}

export const INITIAL_BADGES: UserBadge[] = [
  {
    id: 'badge-primeira-sinfonia',
    name: 'Primeira Sinfonia',
    description: 'Conectou e executou seu primeiro agente no canvas interativo.',
    icon: 'sparkles',
    tier: 'bronze',
    progress: 0,
    maxProgress: 1,
  },
  {
    id: 'badge-delegacao-cirurgica',
    name: 'Delegação Cirúrgica',
    description: 'Delegou tarefas de forma estruturada para agentes conectados.',
    icon: 'paperplane',
    tier: 'silver',
    progress: 0,
    maxProgress: 10,
  },
  {
    id: 'badge-mapeador-neural',
    name: 'Mapeador Neural',
    description: 'Construiu e explorou o Knowledge Graph determinístico do projeto.',
    icon: 'cpu',
    tier: 'gold',
    progress: 0,
    maxProgress: 1,
  },
  {
    id: 'badge-ponte-conhecimento',
    name: 'Ponte de Conhecimento',
    description: 'Abriu e conectou 5 portais de referência aos seus agentes.',
    icon: 'globe',
    tier: 'bronze',
    progress: 0,
    maxProgress: 5,
  },
  {
    id: 'badge-sentinela-autonomo',
    name: 'Sentinela Autônomo',
    description: 'Configurou e executou uma rotina automatizada de background.',
    icon: 'clock',
    tier: 'silver',
    progress: 0,
    maxProgress: 1,
  },
  {
    id: 'badge-em-chamas',
    name: 'Em Chamas',
    description: 'Manteve uma sequência de 3 dias ativos orquestrando no canvas.',
    icon: 'flame',
    tier: 'platinum',
    progress: 1,
    maxProgress: 3,
  },
];

export function createDefaultProfile(): UserProfile {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: 'user-default',
    name: 'Orchestrator',
    callsign: 'ARCHITECT-01',
    avatarId: 'avatar-conductor',
    avatarUrl: '',
    title: 'Aprendiz de Orquestrador',
    level: 1,
    currentXp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    streakDays: 1,
    lastActiveDate: today,
    hasCompletedOnboarding: false,
    badges: INITIAL_BADGES.map((b) => ({ ...b })),
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

function getInitialProfile(): UserProfile | null {
  try {
    const cached = localStorage.getItem('mindagentics_cached_profile');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object' && parsed.name) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export const profileAtom = atom<UserProfile | null>(getInitialProfile());
export const profileToastAtom = atom<LevelUpToast | null>(null);

export interface AvatarOption {
  id: string;
  label: string;
  icon: string;
  bgGradient: string;
  borderColor: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: 'avatar-conductor',
    label: 'Orquestrador',
    icon: '🪄',
    bgGradient: 'from-indigo-600 to-purple-600',
    borderColor: 'border-indigo-400',
  },
  {
    id: 'avatar-cyberpunk',
    label: 'Cyberpunk',
    icon: '⚡',
    bgGradient: 'from-fuchsia-600 to-pink-600',
    borderColor: 'border-fuchsia-400',
  },
  {
    id: 'avatar-hacker',
    label: 'Neon Hacker',
    icon: '👾',
    bgGradient: 'from-emerald-600 to-teal-600',
    borderColor: 'border-emerald-400',
  },
  {
    id: 'avatar-quantum',
    label: 'Quantum Bot',
    icon: '⚛️',
    bgGradient: 'from-cyan-600 to-blue-600',
    borderColor: 'border-cyan-400',
  },
  {
    id: 'avatar-terminal',
    label: 'Retro Terminal',
    icon: '📟',
    bgGradient: 'from-amber-600 to-orange-600',
    borderColor: 'border-amber-400',
  },
  {
    id: 'avatar-voyager',
    label: 'Space Voyager',
    icon: '🚀',
    bgGradient: 'from-violet-600 to-sky-600',
    borderColor: 'border-violet-400',
  },
  {
    id: 'avatar-matrix',
    label: 'Code Sentinel',
    icon: '🛡️',
    bgGradient: 'from-green-600 to-emerald-700',
    borderColor: 'border-emerald-400',
  },
  {
    id: 'avatar-neural',
    label: 'Neural Mind',
    icon: '🧠',
    bgGradient: 'from-purple-600 to-rose-600',
    borderColor: 'border-purple-400',
  },
];

export function getAvatarOption(avatarId?: string): AvatarOption {
  return (
    AVATAR_OPTIONS.find((a) => a.id === avatarId) ||
    AVATAR_OPTIONS[0]
  );
}

export function useUserProfile() {
  const [profile, setProfile] = useAtom(profileAtom);
  const [, setToast] = useAtom(profileToastAtom);

  const fetchProfile = useCallback(async () => {
    try {
      const bridge = window.mindAgentics?.profile || (window.api as any)?.profile;
      if (bridge?.get) {
        const p = await bridge.get();
        if (p) {
          setProfile(p);
          try {
            localStorage.setItem('mindagentics_cached_profile', JSON.stringify(p));
          } catch {}
          return p;
        }
      }
    } catch (err) {
      console.warn('[profileAtom] Failed to fetch profile from IPC:', err);
    }

    try {
      const cached = localStorage.getItem('mindagentics_cached_profile');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object' && parsed.name) {
          setProfile(parsed);
          return parsed;
        }
      }
    } catch {}

    const defaultProf = createDefaultProfile();
    setProfile(defaultProf);
    try {
      localStorage.setItem('mindagentics_cached_profile', JSON.stringify(defaultProf));
    } catch {}
    return defaultProf;
  }, [setProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      // Optimistically update React state and localStorage immediately
      setProfile((prev) => {
        const base = prev || getInitialProfile() || createDefaultProfile();
        const merged: UserProfile = {
          ...base,
          ...patch,
          stats: {
            ...base.stats,
            ...(patch.stats || {}),
          },
          badges: patch.badges || base.badges,
        };
        try {
          localStorage.setItem('mindagentics_cached_profile', JSON.stringify(merged));
        } catch {}
        return merged;
      });

      try {
        const bridge = window.mindAgentics?.profile || (window.api as any)?.profile;
        if (bridge?.update) {
          const updated = await bridge.update(patch);
          if (updated) {
            setProfile(updated);
            try {
              localStorage.setItem('mindagentics_cached_profile', JSON.stringify(updated));
            } catch {}
            return updated;
          }
        }
      } catch (err) {
        console.warn('[profileAtom] Failed to update profile via IPC:', err);
      }
      return null;
    },
    [setProfile]
  );

  const awardXp = useCallback(
    async (xp: number, statKey?: keyof OrchestratorStats) => {
      try {
        const bridge = window.mindAgentics?.profile || (window.api as any)?.profile;
        if (bridge?.awardXp) {
          const res = await bridge.awardXp(xp, statKey);
          if (res?.profile) {
            setProfile(res.profile);
            try {
              localStorage.setItem('mindagentics_cached_profile', JSON.stringify(res.profile));
            } catch {}

            if (res.leveledUp) {
              setToast({
                id: `lvl-${Date.now()}`,
                type: 'level-up',
                title: `Subiu para o Nível ${res.profile.level}!`,
                description: `Título conquistado: ${res.profile.title}`,
                level: res.profile.level,
              });
            } else if (res.unlockedBadges && res.unlockedBadges.length > 0) {
              const b = res.unlockedBadges[0];
              setToast({
                id: `badge-${Date.now()}`,
                type: 'badge-unlocked',
                title: `Conquista Desbloqueada: ${b.name}!`,
                description: b.description,
                badge: b,
              });
            }
            return res;
          }
        }
      } catch (err) {
        console.warn('[profileAtom] Failed to award XP via IPC:', err);
      }
      return null;
    },
    [setProfile, setToast]
  );

  return {
    profile: profile || createDefaultProfile(),
    isLoading: !profile,
    fetchProfile,
    updateProfile,
    awardXp,
  };
}

export function useAwardXp() {
  const { awardXp } = useUserProfile();
  return awardXp;
}
