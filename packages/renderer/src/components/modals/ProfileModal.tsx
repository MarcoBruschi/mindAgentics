import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isProfileModalOpenAtom } from '@/atoms/ui';
import {
  useUserProfile,
  AVATAR_OPTIONS,
  getAvatarOption,
} from '@/atoms/profile';
import type { BadgeTier, UserBadge } from '@mindagentics/shared';
import {
  X,
  Send,
  Globe,
  Network,
  Sparkles,
  Flame,
  Award,
  CheckCircle2,
  Lock,
  Save,
  Upload,
  Camera,
  Trash2,
} from 'lucide-react';

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

  if (!isOpen) return null;

  const currentAvatar = getAvatarOption(selectedAvatarId);
  const xpTotalRequired = (profile?.currentXp || 0) + (profile?.xpToNextLevel || 100);
  const xpPercent = Math.min(
    100,
    Math.max(0, Math.round(((profile?.currentXp || 0) / (xpTotalRequired || 1)) * 100))
  );

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

  const getTierColor = (tier: BadgeTier) => {
    switch (tier) {
      case 'platinum':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case 'gold':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'silver':
        return 'text-slate-300 bg-slate-400/10 border-slate-400/30';
      case 'bronze':
      default:
        return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    }
  };

  const getBadgeIcon = (iconName: string) => {
    switch (iconName) {
      case 'sparkles':
        return <Sparkles className="w-4 h-4 text-amber-400" strokeWidth={1.75} />;
      case 'paperplane':
        return <Send className="w-4 h-4 text-blue-400" strokeWidth={1.75} />;
      case 'cpu':
        return <Network className="w-4 h-4 text-purple-400" strokeWidth={1.75} />;
      case 'globe':
        return <Globe className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />;
      case 'flame':
        return <Flame className="w-4 h-4 text-rose-400" strokeWidth={1.75} />;
      default:
        return <Award className="w-4 h-4 text-[#8B93FF]" strokeWidth={1.75} />;
    }
  };

  const badges = profile?.badges || [];
  const unlockedBadges = badges.filter((b) => b.unlockedAt);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      <div
        className="w-full max-w-[620px] max-h-[820px] h-full bg-[#14161A] border border-[#23262C] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23262C] bg-[#121418] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#8B93FF]/10 flex items-center justify-center border border-[#8B93FF]/20 text-[#8B93FF]">
              <Award className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#E7E8EA] tracking-tight">
                Perfil do Orquestrador
              </h2>
              <p className="text-[12px] text-[#8A8F98]">
                Progresso, títulos e conquistas de gamificação
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors cursor-pointer"
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Section 1: Level & Title Showcase Card (with Real-time Preview) */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-[#181B20] to-[#121418] border border-[#23262C] shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {/* Active Avatar or Custom Photo (Clickable to change) */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative group/avatar cursor-pointer shrink-0 rounded-2xl outline-none"
                  title="Clique para alterar a foto ou carregar uma imagem"
                >
                  {avatarUrl ? (
                    <div className="relative w-14 h-14 rounded-2xl overflow-hidden ring-2 ring-[#8B93FF]/40 shadow-md bg-[#0E0F12]">
                      <img
                        src={avatarUrl}
                        alt={name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity rounded-2xl">
                        <Camera className="w-5 h-5 text-white" strokeWidth={1.75} />
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${currentAvatar.bgGradient} flex items-center justify-center text-2xl shadow-md ring-2 ring-white/10`}
                    >
                      {currentAvatar.icon}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity rounded-2xl">
                        <Camera className="w-5 h-5 text-white" strokeWidth={1.75} />
                      </div>
                    </div>
                  )}
                </button>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white tracking-tight">
                      {name.trim() || profile?.name || 'Orquestrador'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-[#8B93FF]/15 text-[#8B93FF] border border-[#8B93FF]/30">
                      {callsign.trim() || profile?.callsign || 'ARCHITECT-01'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[#8B93FF] mt-0.5">
                    {profile?.title || 'Aprendiz de Orquestrador'}
                  </p>
                </div>
              </div>

              {/* Big Level Pill & Streak */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="px-3.5 py-1.5 rounded-xl bg-[#8B93FF]/10 border border-[#8B93FF]/30 flex items-center gap-1.5 shadow-sm">
                  <span className="text-xs uppercase tracking-wider text-[#8A8F98] font-semibold">
                    Nível
                  </span>
                  <span className="text-lg font-black text-[#8B93FF] leading-none">
                    {profile?.level || 1}
                  </span>
                </div>
                <div
                  className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-lg"
                  title="Dias consecutivos de orquestração ativa"
                >
                  <Flame className="w-3 h-3 text-amber-400" strokeWidth={1.75} />
                  <span>{profile?.streakDays || 1}d Sequência</span>
                </div>
              </div>
            </div>

            {/* XP Linear Progress Bar */}
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#8A8F98] font-medium">Progresso de Experiência</span>
                <span className="font-mono text-[#E7E8EA]">
                  <strong className="text-[#8B93FF]">{profile?.currentXp || 0}</strong> /{' '}
                  {xpTotalRequired} XP
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#0E0F12] rounded-full overflow-hidden p-0.5 border border-[#23262C]">
                <div
                  className="h-full bg-gradient-to-r from-[#8B93FF] via-indigo-500 to-purple-500 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(139,147,255,0.4)]"
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
              <span className="text-[10px] text-[#8A8F98] text-right font-mono">
                Faltam {profile?.xpToNextLevel || 100} XP para o próximo nível
              </span>
            </div>
          </div>

          {/* Section 2: Avatar & Identity Customizer */}
          <form onSubmit={handleSave} className="p-4 rounded-xl bg-[#121418] border border-[#23262C] space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">
                  Avatar do Orquestrador
                </span>
                <span className="text-[11px] text-[#8A8F98]">
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

              {/* Avatars & Photo Upload Grid */}
              <div className="grid grid-cols-5 sm:grid-cols-9 gap-2">
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
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#181B20] border-[#8B93FF] ring-2 ring-[#8B93FF]/30 shadow-md scale-105'
                          : 'bg-[#14161A] border-[#23262C] hover:border-[#8A8F98]/50 hover:bg-[#181B20]'
                      }`}
                      title={av.label}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl bg-gradient-to-br ${av.bgGradient} flex items-center justify-center text-lg shadow-sm`}
                      >
                        {av.icon}
                      </div>
                      <span className="text-[10px] text-[#8A8F98] truncate max-w-full font-medium">
                        {av.label.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}

                {/* Upload Custom Photo Option */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all cursor-pointer ${
                    avatarUrl
                      ? 'bg-[#181B20] border-[#8B93FF] ring-2 ring-[#8B93FF]/30 shadow-md scale-105'
                      : 'bg-[#14161A] border-[#23262C] hover:border-[#8A8F98]/50 hover:bg-[#181B20]'
                  }`}
                  title="Carregar foto personalizada do computador"
                >
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-[#8B93FF]/30 flex items-center justify-center text-[#8B93FF] shadow-sm">
                    <Upload className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <span className="text-[10px] text-[#8B93FF] font-medium truncate max-w-full">
                    Upload
                  </span>
                </button>
              </div>

              {/* Custom Photo Management Banner */}
              {avatarUrl && (
                <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-xl bg-[#181B20] border border-[#23262C] text-xs">
                  <span className="text-[#8A8F98] flex items-center gap-2">
                    <Camera className="w-3.5 h-3.5 text-[#8B93FF]" strokeWidth={1.75} />
                    <span>Foto personalizada selecionada</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleClearPhoto}
                    className="text-rose-400 hover:text-rose-300 flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                    <span>Remover foto</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-[#8A8F98] block mb-1">
                  Nome de Exibição
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  className="w-full bg-[#181B20] border border-[#23262C] focus:border-[#8B93FF] rounded-xl px-3 py-1.5 text-xs text-[#E7E8EA] outline-none transition-colors"
                  placeholder="Nome do Orquestrador"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#8A8F98] block mb-1">
                  Callsign / Indicativo
                </label>
                <input
                  type="text"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                  maxLength={16}
                  className="w-full bg-[#181B20] border border-[#23262C] focus:border-[#8B93FF] rounded-xl px-3 py-1.5 text-xs text-[#E7E8EA] outline-none font-mono uppercase transition-colors"
                  placeholder="CALLSIGN"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {isSaved && (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Alterações salvas!
                </span>
              )}
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-xl bg-[#8B93FF] hover:bg-[#7A82F8] text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Save className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Salvar perfil</span>
              </button>
            </div>
          </form>

          {/* Section 3: Conquistas (Badges Showcase) */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">
                Conquistas do Orquestrador
              </span>
              <span className="text-xs font-mono font-medium text-[#8B93FF]">
                {unlockedBadges.length} / {badges.length} desbloqueadas
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {badges.map((b: UserBadge) => {
                const isUnlocked = Boolean(b.unlockedAt);
                const prog = b.progress || 0;
                const max = b.maxProgress || 1;
                const percent = Math.min(100, Math.round((prog / max) * 100));

                return (
                  <div
                    key={b.id}
                    className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                      isUnlocked
                        ? 'bg-[#181B20]/90 border-amber-500/30 shadow-md ring-1 ring-amber-500/10'
                        : 'bg-[#121418] border-[#23262C] opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${
                            isUnlocked
                              ? 'bg-amber-500/10 border-amber-500/30 shadow-sm'
                              : 'bg-[#0E0F12] border-[#23262C]'
                          }`}
                        >
                          {isUnlocked ? (
                            getBadgeIcon(b.icon)
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-[#8A8F98]" strokeWidth={1.75} />
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-white tracking-tight leading-snug">
                            {b.name}
                          </h4>
                          <span
                            className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded border inline-block mt-0.5 ${getTierColor(
                              b.tier
                            )}`}
                          >
                            {b.tier}
                          </span>
                        </div>
                      </div>

                      {isUnlocked && (
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-amber-400" strokeWidth={1.75} />
                            Desbloqueada
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-[#8A8F98] leading-relaxed">
                      {b.description}
                    </p>

                    {!isUnlocked && (
                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[#8A8F98]">
                          <span>Progresso</span>
                          <span>
                            {prog} / {max}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#0E0F12] rounded-full overflow-hidden border border-[#23262C]">
                          <div
                            className="h-full bg-[#8B93FF] rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
