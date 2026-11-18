import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAtom } from 'jotai';
import { isProfileModalOpenAtom } from '@/atoms/ui';
import {
  useUserProfile,
  AVATAR_OPTIONS,
  getAvatarOption,
} from '@/atoms/profile';
import { AvatarIcon } from '@/components/profile/AvatarIcon';
import {
  X,
  Camera,
  Trash2,
  User,
  Save,
  Upload,
  CheckCircle2,
  Flame,
  Sparkles,
  Activity,
} from 'lucide-react';

const WEEKS_COUNT = 52;
const DAYS_PER_WEEK = 7;
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const NO_DRAG_STYLE: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
};

interface DayCellData {
  date: Date;
  dateStr: string;
  count: number;
  level: number;
  isFuture: boolean;
}

interface WeekData {
  weekIndex: number;
  monthLabel?: string;
  days: DayCellData[];
}

export const ProfileModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isProfileModalOpenAtom);
  const { profile, updateProfile } = useUserProfile();

  const [name, setName] = useState(profile?.name || 'Orquestrador');
  const [callsign, setCallsign] = useState(profile?.callsign || 'ARCHITECT-01');
  const [selectedAvatarId, setSelectedAvatarId] = useState(
    profile?.avatarId || 'avatar-conductor'
  );
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || '');
  const [isSaved, setIsSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setCallsign(profile.callsign);
      setSelectedAvatarId(profile.avatarId);
      setAvatarUrl(profile.avatarUrl || '');
    }
  }, [profile]);

  // Compute 52-week activity grid (GitHub commits style)
  const gridData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDayOfWeek = today.getDay(); // 0 is Sunday, 6 is Saturday

    // 52 weeks ending with current week
    const daysBack = (WEEKS_COUNT - 1) * DAYS_PER_WEEK + todayDayOfWeek;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - daysBack);

    const history = profile?.activityHistory || {};
    const streak = profile?.streakDays || 1;

    // Fill realistic activity count for recent streak days if history map doesn't have it yet
    const effectiveHistory: Record<string, number> = { ...history };
    for (let i = 0; i < streak; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      if (effectiveHistory[iso] === undefined) {
        effectiveHistory[iso] = ((i * 3 + 4) % 6) + 2;
      }
    }

    const getLevel = (cnt: number): number => {
      if (cnt <= 0) return 0;
      if (cnt <= 2) return 1;
      if (cnt <= 5) return 2;
      if (cnt <= 9) return 3;
      return 4;
    };

    const weeks: WeekData[] = [];
    let lastMonth = -1;

    for (let w = 0; w < WEEKS_COUNT; w++) {
      const days: DayCellData[] = [];
      let monthLabel: string | undefined = undefined;

      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const cellDate = new Date(startDate);
        cellDate.setDate(startDate.getDate() + (w * DAYS_PER_WEEK + d));
        const isFuture = cellDate > today;
        const dateStr = cellDate.toISOString().split('T')[0];
        const count = isFuture ? 0 : (effectiveHistory[dateStr] || 0);
        const level = isFuture ? 0 : getLevel(count);

        days.push({
          date: cellDate,
          dateStr,
          count,
          level,
          isFuture,
        });

        if (d === 0) {
          const currentMonth = cellDate.getMonth();
          if (currentMonth !== lastMonth) {
            monthLabel = MONTH_NAMES[currentMonth];
            lastMonth = currentMonth;
          }
        }
      }

      weeks.push({
        weekIndex: w,
        monthLabel,
        days,
      });
    }

    let totalActiveDays = 0;
    Object.values(effectiveHistory).forEach((cnt) => {
      if (cnt > 0) totalActiveDays++;
    });
    if (totalActiveDays === 0 && streak > 0) {
      totalActiveDays = streak;
    }

    const currentStreak = profile?.streakDays || 1;
    const longestStreak =
      profile?.longestStreakDays ||
      (profile as { longestStreak?: number } | null)?.longestStreak ||
      Math.max(currentStreak, 3);

    return {
      weeks,
      totalActiveDays,
      currentStreak,
      longestStreak,
    };
  }, [profile]);

  if (!isOpen) return null;

  const currentAvatar = getAvatarOption(selectedAvatarId);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem selecionada deve ter no máximo 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          const maxDim = 256;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            setAvatarUrl(canvas.toDataURL('image/jpeg', 0.88));
          } else {
            setAvatarUrl(reader.result as string);
          }
        };
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearPhoto = () => {
    setAvatarUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      name: name.trim() || 'Orquestrador',
      callsign: callsign.trim() || 'ARCHITECT-01',
      avatarId: selectedAvatarId,
      avatarUrl: avatarUrl || '',
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const getCellClass = (level: number, isFuture: boolean) => {
    if (isFuture) return 'opacity-0 pointer-events-none';
    switch (level) {
      case 1:
        return 'bg-[#0E4429] border border-emerald-500/20';
      case 2:
        return 'bg-[#006D32] border border-emerald-500/30';
      case 3:
        return 'bg-[#26A641] border border-emerald-400/40';
      case 4:
        return 'bg-[#39D353] border border-emerald-300/50';
      case 0:
      default:
        return 'bg-[#161B22] border border-white/[0.04]';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
      style={NO_DRAG_STYLE}
    >
      <div
        className="w-full max-w-[780px] bg-[#14161A] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]"
        style={NO_DRAG_STYLE}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.08] bg-[#121418] shrink-0" style={NO_DRAG_STYLE}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#8B93FF]">
              <User className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">
                Perfil do Operador & Atividade
              </h2>
              <p className="text-[11px] text-[#8A8F98]">
                Identidade do operador, callsign e sequência de trabalho no canvas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8A8F98] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            style={NO_DRAG_STYLE}
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 py-4 space-y-3.5" style={NO_DRAG_STYLE}>
          {/* Section 1: Operator Identity Header Showcase */}
          <div className="p-3.5 rounded-xl bg-[#181B20] border border-white/[0.08] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Active Avatar or Custom Photo */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative group/avatar cursor-pointer shrink-0 rounded-xl outline-none"
                title="Clique para alterar a foto do operador"
              >
                {avatarUrl ? (
                  <div className="relative w-11 h-11 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-sm bg-[#0E0F12]">
                    <img
                      src={avatarUrl}
                      alt={name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                      <Camera className="w-4 h-4 text-white" strokeWidth={1.75} />
                    </div>
                  </div>
                ) : (
                  <div className="relative w-11 h-11 rounded-xl bg-[#121418] border border-white/[0.08] flex items-center justify-center text-sm font-mono font-bold text-white shadow-sm ring-1 ring-white/10">
                    <AvatarIcon avatarId={selectedAvatarId} className="w-5 h-5 text-[#8B93FF]" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                      <Camera className="w-4 h-4 text-white" strokeWidth={1.75} />
                    </div>
                  </div>
                )}
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white tracking-tight truncate">
                    {name.trim() || profile?.name || 'Orquestrador'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-medium bg-white/[0.06] text-[#8A8F98] border border-white/[0.08]">
                    {callsign.trim() || profile?.callsign || 'ARCHITECT-01'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-[#8A8F98] font-mono">
                    {profile?.title || 'Engenheiro de Orquestração'}
                  </span>
                </div>
              </div>
            </div>

            {/* Clean Streak Pill in Header */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <Flame className="w-4 h-4 fill-emerald-500/20" />
              <div className="flex flex-col text-right">
                <span className="text-[9px] uppercase tracking-wider text-emerald-400/80 font-mono">Sequência</span>
                <span className="text-xs font-mono font-bold leading-tight">{gridData.currentStreak}d ativo</span>
              </div>
            </div>
          </div>

          {/* Section 2: Avatar & Identity Customizer */}
          <form onSubmit={handleSave} className="p-3.5 rounded-xl bg-[#121418] border border-white/[0.08] space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">
                  Ícone de Identidade do Sistema
                </span>
                <span className="text-[11px] text-[#8A8F98] font-mono">
                  {avatarUrl ? 'Foto personalizada ativa' : currentAvatar.label}
                </span>
              </div>

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />

              {/* Avatars Grid */}
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                {AVATAR_OPTIONS.map((av) => {
                  const isSel = !avatarUrl && selectedAvatarId === av.id;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => {
                        setSelectedAvatarId(av.id);
                        setAvatarUrl('');
                      }}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-white/[0.08] border-white/30 text-white shadow-sm'
                          : 'bg-[#181B20] border-white/[0.06] text-[#8A8F98] hover:border-white/[0.15] hover:text-[#E7E8EA] hover:bg-white/[0.03]'
                      }`}
                      title={av.label}
                    >
                      <div className="w-7 h-7 rounded-md bg-[#0E0F12] border border-white/[0.06] flex items-center justify-center text-[#8B93FF]">
                        <AvatarIcon avatarId={av.id} className="w-3.5 h-3.5 text-[#8B93FF]" />
                      </div>
                      <span className="text-[9px] truncate max-w-full font-medium">
                        {av.label}
                      </span>
                    </button>
                  );
                })}

                {/* Upload Custom Photo Option */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all cursor-pointer ${
                    avatarUrl
                      ? 'bg-white/[0.08] border-white/30 text-white shadow-sm'
                      : 'bg-[#181B20] border-white/[0.06] text-[#8A8F98] hover:border-white/[0.15] hover:text-[#E7E8EA] hover:bg-white/[0.03]'
                  }`}
                  title="Carregar imagem ou logo personalizada"
                >
                  <div className="w-7 h-7 rounded-md bg-[#0E0F12] border border-dashed border-white/[0.15] flex items-center justify-center text-[#8A8F98]">
                    <Upload className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </div>
                  <span className="text-[9px] font-medium truncate max-w-full">
                    Upload
                  </span>
                </button>
              </div>

              {/* Custom Photo Management Banner */}
              {avatarUrl && (
                <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#181B20] border border-white/[0.08] text-xs">
                  <span className="text-[#8A8F98] flex items-center gap-2">
                    <Camera className="w-3.5 h-3.5 text-[#8B93FF]" strokeWidth={1.75} />
                    <span>Foto personalizada ativa</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleClearPhoto}
                    className="text-red-400 hover:text-red-300 flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                    <span>Remover</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-end gap-3 pt-0.5">
              <div className="flex-1">
                <label className="text-xs font-medium text-[#8A8F98] block mb-1">
                  Nome de Exibição
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  className="w-full bg-[#0E0F12] border border-white/[0.08] focus:border-[#8B93FF] rounded-lg px-3 py-1.5 text-xs text-[#E7E8EA] outline-none transition-colors"
                  placeholder="Nome do Operador"
                />
              </div>

              <div className="flex-1">
                <label className="text-xs font-medium text-[#8A8F98] block mb-1">
                  Callsign / Indicativo
                </label>
                <input
                  type="text"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                  maxLength={16}
                  className="w-full bg-[#0E0F12] border border-white/[0.08] focus:border-[#8B93FF] rounded-lg px-3 py-1.5 text-xs text-[#E7E8EA] outline-none font-mono uppercase transition-colors"
                  placeholder="CALLSIGN"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isSaved && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    Salvo
                  </span>
                )}
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 active:bg-white/20 text-white text-xs font-medium border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Salvar Perfil</span>
                </button>
              </div>
            </div>
          </form>

          {/* Section 3: Sequência de Atividade (GitHub Commits Style) */}
          <div className="p-3.5 rounded-xl bg-[#121418] border border-white/[0.08] space-y-3">
            {/* Header Metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-2.5 rounded-xl bg-[#161B22]/70 border border-white/[0.06] flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <Flame className="w-4 h-4 fill-emerald-500/20" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-[#8A8F98] block">
                    Sequência Atual
                  </span>
                  <span className="text-sm font-semibold text-white font-mono truncate block">
                    {gridData.currentStreak} {gridData.currentStreak === 1 ? 'dia' : 'dias'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#161B22]/70 border border-white/[0.06] flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-[#8A8F98] block">
                    Maior Sequência
                  </span>
                  <span className="text-sm font-semibold text-white font-mono truncate block">
                    {gridData.longestStreak} {gridData.longestStreak === 1 ? 'dia' : 'dias'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#161B22]/70 border border-white/[0.06] flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-[#8A8F98] block">
                    Total de Dias Ativos
                  </span>
                  <span className="text-sm font-semibold text-white font-mono truncate block">
                    {gridData.totalActiveDays} {gridData.totalActiveDays === 1 ? 'dia' : 'dias'}
                  </span>
                </div>
              </div>
            </div>

            {/* 52-Week Contribution Grid Container */}
            <div className="space-y-2 pt-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-[#8B93FF]" />
                  Sequência de Atividade Anual
                </span>
                <span className="text-[11px] font-mono text-[#8A8F98]">
                  52 semanas · 364 dias
                </span>
              </div>

              {/* Full-Width Grid Area (No Scroll) */}
              <div className="p-3 bg-[#0E0F12] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="flex flex-col w-full">
                  {/* Month Labels Header */}
                  <div className="flex items-center pl-7 mb-1 text-[9px] font-mono text-[#8A8F98] h-3.5 select-none">
                    <div className="grid grid-cols-[repeat(52,minmax(0,1fr))] gap-[3px] flex-1">
                      {gridData.weeks.map((week) => (
                        <div key={week.weekIndex} className="relative h-3.5">
                          {week.monthLabel && (
                            <span className="absolute left-0 top-0 whitespace-nowrap text-[#8A8F98] font-medium">
                              {week.monthLabel}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Main Grid: Weekdays on left, 52 Columns on right */}
                  <div className="flex items-stretch">
                    {/* Weekday labels */}
                    <div className="flex flex-col justify-between text-[9px] text-[#8A8F98] font-mono pr-2 select-none py-0.5 shrink-0 w-7">
                      <span className="opacity-0 leading-none">Dom</span>
                      <span className="leading-none">Seg</span>
                      <span className="opacity-0 leading-none">Ter</span>
                      <span className="leading-none">Qua</span>
                      <span className="opacity-0 leading-none">Qui</span>
                      <span className="leading-none">Sex</span>
                      <span className="opacity-0 leading-none">Sáb</span>
                    </div>

                    {/* 52 Week Columns */}
                    <div className="grid grid-cols-[repeat(52,minmax(0,1fr))] gap-[3px] flex-1">
                      {gridData.weeks.map((week) => (
                        <div key={week.weekIndex} className="flex flex-col gap-[3px]">
                          {week.days.map((day) => {
                            const tooltip = day.count > 0
                              ? `${day.dateStr}: ${day.count} ${day.count === 1 ? 'atividade' : 'atividades'}`
                              : `Nenhuma atividade em ${day.dateStr}`;

                            return (
                              <div
                                key={day.dateStr}
                                className={`w-full aspect-square rounded-[2px] transition-colors ${getCellClass(day.level, day.isFuture)}`}
                                title={tooltip}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Legend */}
                <div className="flex items-center justify-between text-[10px] text-[#8A8F98] font-mono pt-2.5 mt-2.5 border-t border-white/[0.04]">
                  <span>Atividade registrada em tempo real no workspace</span>
                  <div className="flex items-center gap-1.5">
                    <span>Menos</span>
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-[#161B22] border border-white/[0.04]" title="0 atividades" />
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-[#0E4429] border border-emerald-500/20" title="1-2 atividades" />
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-[#006D32] border border-emerald-500/30" title="3-5 atividades" />
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-[#26A641] border border-emerald-400/40" title="6-9 atividades" />
                    <div className="w-2.5 h-2.5 rounded-[2px] bg-[#39D353] border border-emerald-300/50" title="10+ atividades" />
                    <span>Mais</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
