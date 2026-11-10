import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isProfileModalOpenAtom } from '@/atoms/ui';
import {
  useUserProfile,
  AVATAR_OPTIONS,
  getAvatarOption,
} from '@/atoms/profile';
import { AvatarIcon } from '@/components/profile/AvatarIcon';
import type { UserBadge } from '@mindagentics/shared';
import {
  X,
  Send,
  Globe,
  Network,
  Sparkles,
  CheckCircle2,
  Lock,
  Save,
  Upload,
  Camera,
  Trash2,
  User,
  Check,
  Wand2,
  Zap,
  Terminal,
  Command,
  Compass,
  Shield,
  Brain,
  Cpu,
  Activity,
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

  const getBadgeIcon = (iconName: string) => {
    switch (iconName) {
      case 'sparkles':
        return <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
      case 'paperplane':
        return <Send className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
      case 'cpu':
        return <Cpu className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
      case 'globe':
        return <Globe className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
      case 'flame':
        return <Activity className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
      default:
        return <Activity className="w-3.5 h-3.5 text-white" strokeWidth={1.75} />;
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
        className="w-full max-w-[620px] max-h-[820px] h-full bg-[#14161A] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#121418] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#8B93FF]">
              <User className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">
                Identidade do Operador & Capacidades
              </h2>
              <p className="text-[11px] text-[#8A8F98]">
                Configuração de perfil, callsign técnico e auditoria de marcos operacionais
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8A8F98] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Section 1: Operator Identity & Telemetry Showcase */}
          <div className="p-4 rounded-xl bg-[#181B20] border border-white/[0.08] flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                {/* Active Avatar or Custom Photo */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative group/avatar cursor-pointer shrink-0 rounded-xl outline-none"
                  title="Clique para alterar a foto do operador"
                >
                  {avatarUrl ? (
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-sm bg-[#0E0F12]">
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
                    <div className="relative w-12 h-12 rounded-xl bg-[#121418] border border-white/[0.08] flex items-center justify-center text-sm font-mono font-bold text-white shadow-sm ring-1 ring-white/10">
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
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                  </div>
                </div>
              </div>

              {/* Technical Telemetry Badges */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07] flex flex-col items-end">
                  <span className="text-[9px] uppercase tracking-wider text-[#8A8F98] font-mono">
                    Sequência
                  </span>
                  <span className="text-xs font-mono font-semibold text-[#E7E8EA]">
                    {profile?.streakDays || 1}d ativo
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07] flex flex-col items-end">
                  <span className="text-[9px] uppercase tracking-wider text-[#8A8F98] font-mono">
                    Nível / Score
                  </span>
                  <span className="text-xs font-mono font-semibold text-[#8B93FF]">
                    Nv. {profile?.level || 1} · {profile?.currentXp || 0} pts
                  </span>
                </div>
              </div>
            </div>

            {/* Linear Execution Bar */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-white/[0.06]">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-[#8A8F98]">Telemetria de Atividade</span>
                <span className="text-[#8A8F98]">
                  <strong className="text-white font-medium">{profile?.currentXp || 0}</strong> / {xpTotalRequired} pts
                  <span className="text-[#8A8F98]/60 ml-1.5">({xpPercent}%)</span>
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#0E0F12] rounded-full overflow-hidden border border-white/[0.06]">
                <div
                  className="h-full bg-[#8B93FF] rounded-full transition-all duration-300"
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Avatar & Identity Customizer */}
          <form onSubmit={handleSave} className="p-4 rounded-xl bg-[#121418] border border-white/[0.08] space-y-4">
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
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
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
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-white/[0.08] border-white/30 text-white shadow-sm'
                          : 'bg-[#181B20] border-white/[0.06] text-[#8A8F98] hover:border-white/[0.15] hover:text-[#E7E8EA] hover:bg-white/[0.03]'
                      }`}
                      title={av.label}
                    >
                      <div className="w-8 h-8 rounded-md bg-[#0E0F12] border border-white/[0.06] flex items-center justify-center text-[#8B93FF]">
                        <AvatarIcon avatarId={av.id} className="w-4 h-4 text-[#8B93FF]" />
                      </div>
                      <span className="text-[10px] truncate max-w-full font-medium">
                        {av.label}
                      </span>
                    </button>
                  );
                })}

                {/* Upload Custom Photo Option */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all cursor-pointer ${
                    avatarUrl
                      ? 'bg-white/[0.08] border-white/30 text-white shadow-sm'
                      : 'bg-[#181B20] border-white/[0.06] text-[#8A8F98] hover:border-white/[0.15] hover:text-[#E7E8EA] hover:bg-white/[0.03]'
                  }`}
                  title="Carregar imagem ou logo personalizada"
                >
                  <div className="w-8 h-8 rounded-md bg-[#0E0F12] border border-dashed border-white/[0.15] flex items-center justify-center text-[#8A8F98]">
                    <Upload className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </div>
                  <span className="text-[10px] font-medium truncate max-w-full">
                    Upload
                  </span>
                </button>
              </div>

              {/* Custom Photo Management Banner */}
              {avatarUrl && (
                <div className="mt-2.5 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#181B20] border border-white/[0.08] text-xs">
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
                  className="w-full bg-[#0E0F12] border border-white/[0.08] focus:border-[#8B93FF] rounded-lg px-3 py-1.5 text-xs text-[#E7E8EA] outline-none transition-colors"
                  placeholder="Nome do Operador"
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
                  className="w-full bg-[#0E0F12] border border-white/[0.08] focus:border-[#8B93FF] rounded-lg px-3 py-1.5 text-xs text-[#E7E8EA] outline-none font-mono uppercase transition-colors"
                  placeholder="CALLSIGN"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {isSaved && (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium font-mono">
                  <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Alterações salvas
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
          </form>

          {/* Section 3: Capacidades & Marcos Operacionais */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">
                Capacidades & Marcos do Sistema
              </span>
              <span className="text-xs font-mono font-medium text-[#8A8F98]">
                <strong className="text-white">{unlockedBadges.length}</strong> / {badges.length} certificadas
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
                        ? 'bg-[#181B20] border-white/[0.08] shadow-sm'
                        : 'bg-[#121418] border-white/[0.05] opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${
                            isUnlocked
                              ? 'bg-white/[0.05] border-white/[0.1] text-white'
                              : 'bg-[#0E0F12] border-white/[0.06] text-zinc-500'
                          }`}
                        >
                          {isUnlocked ? (
                            getBadgeIcon(b.icon)
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.75} />
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-medium text-white tracking-tight leading-snug">
                            {b.name}
                          </h4>
                          <span className="text-[9px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[#8A8F98] inline-block mt-0.5">
                            {b.tier}
                          </span>
                        </div>
                      </div>

                      {isUnlocked && (
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-emerald-400 font-mono font-medium flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            <Check className="w-3 h-3 text-emerald-400" strokeWidth={2} />
                            Ativo
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
                        <div className="w-full h-1 bg-[#0E0F12] rounded-full overflow-hidden border border-white/[0.06]">
                          <div
                            className="h-full bg-white/40 rounded-full"
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