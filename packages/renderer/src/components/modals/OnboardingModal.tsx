import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isOnboardingModalOpenAtom } from '@/atoms/ui';
import {
  useUserProfile,
  AVATAR_OPTIONS,
  getAvatarOption,
} from '@/atoms/profile';
import { AvatarIcon } from '@/components/profile/AvatarIcon';
import {
  Sparkles,
  Upload,
  Camera,
  Trash2,
  Wand2,
  ShieldCheck,
  Zap,
  Terminal,
  Network,
  Command,
  Compass,
  Shield,
  Brain,
  Cpu,
} from 'lucide-react';

export const OnboardingModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isOnboardingModalOpenAtom);
  const { profile, updateProfile, awardXp } = useUserProfile();

  const [name, setName] = useState('Orquestrador');
  const [callsign, setCallsign] = useState('ARCHITECT-01');
  const [selectedAvatarId, setSelectedAvatarId] = useState('avatar-conductor');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open on first run if user has not yet onboarded
  useEffect(() => {
    if (profile) {
      const alreadyOnboarded =
        profile.hasCompletedOnboarding ||
        localStorage.getItem('mindagentics_onboarded') === 'true';

      if (!alreadyOnboarded) {
        setIsOpen(true);
      }
      if (profile.name) setName(profile.name);
      if (profile.callsign) setCallsign(profile.callsign);
      if (profile.avatarId) setSelectedAvatarId(profile.avatarId);
      if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
    }
  }, [profile, setIsOpen]);

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

  const handleStartJourney = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const finalName = name.trim() || 'Orquestrador';
    const finalCallsign = callsign.trim() || 'ARCHITECT-01';

    try {
      await updateProfile({
        name: finalName,
        callsign: finalCallsign,
        avatarId: selectedAvatarId,
        avatarUrl: avatarUrl || '',
        hasCompletedOnboarding: true,
      });

      // Award inaugural 50 XP to the new orchestrator
      await awardXp(50);

      try {
        localStorage.setItem('mindagentics_onboarded', 'true');
      } catch {
        // ignore
      }

      setIsOpen(false);
    } catch (err) {
      console.warn('Failed to complete onboarding:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      <div
        className="w-full max-w-[540px] bg-[#14161A] border border-[#23262C] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Welcome Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-[#181B20] to-[#14161A] border-b border-[#23262C] text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-[#8B93FF]/15 border border-[#8B93FF]/30 flex items-center justify-center text-[#8B93FF] mb-3 shadow-lg shadow-[#8B93FF]/10">
            <Wand2 className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Bem-vindo ao mindAgentics!
          </h2>
          <p className="text-xs text-[#8A8F98] max-w-sm mt-1 leading-relaxed">
            Configure seu Perfil de Orquestrador para liderar sua equipe de agentes autônomos no canvas interativo.
          </p>
        </div>

        {/* Real-time Preview & Customization Form */}
        <form onSubmit={handleStartJourney} className="p-6 space-y-5">
          {/* Real-time Showcase Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#181B20] to-[#121418] border border-[#23262C] flex items-center gap-4 shadow-inner">
            {avatarUrl ? (
              <div className="relative w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-md shrink-0 bg-[#0E0F12]">
                <img
                  src={avatarUrl}
                  alt={name}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div
                className="w-14 h-14 rounded-2xl bg-[#121418] border border-white/[0.08] flex items-center justify-center text-2xl shadow-md ring-1 ring-white/10 shrink-0"
              >
                <AvatarIcon avatarId={selectedAvatarId} className="w-6 h-6 text-[#8B93FF]" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white truncate">
                  {name.trim() || 'Orquestrador'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-[#8B93FF]/15 text-[#8B93FF] border border-[#8B93FF]/30 shrink-0">
                  {callsign.trim() || 'ARCHITECT-01'}
                </span>
              </div>
              <p className="text-xs font-medium text-[#8B93FF] mt-0.5">
                Aprendiz de Orquestrador • Nível 1
              </p>
            </div>

            <div className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold shrink-0">
              +50 XP Inicial
            </div>
          </div>

          {/* Avatar Presets & Photo Upload */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">
                Escolha seu Avatar
              </span>
              <span className="text-[11px] text-[#8A8F98]">
                {avatarUrl ? 'Foto personalizada' : currentAvatar.label}
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />

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
                      className="w-9 h-9 rounded-xl bg-[#0E0F12] border border-white/[0.08] flex items-center justify-center shadow-sm"
                    >
                      <AvatarIcon avatarId={av.id} className="w-4 h-4 text-[#8B93FF]" />
                    </div>
                    <span className="text-[9px] text-[#8A8F98] truncate max-w-full font-medium">
                      {av.label.split(' ')[0]}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all cursor-pointer ${
                  avatarUrl
                    ? 'bg-[#181B20] border-[#8B93FF] ring-2 ring-[#8B93FF]/30 shadow-md scale-105'
                    : 'bg-[#14161A] border-[#23262C] hover:border-[#8A8F98]/50 hover:bg-[#181B20]'
                }`}
                title="Carregar foto do computador"
              >
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-dashed border-white/[0.15] flex items-center justify-center text-[#8A8F98] shadow-sm">
                  <Upload className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <span className="text-[9px] text-[#8A8F98] font-medium truncate max-w-full">
                  Foto
                </span>
              </button>
            </div>

            {avatarUrl && (
              <div className="mt-2.5 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#181B20] border border-[#23262C] text-xs">
                <span className="text-[#8A8F98] flex items-center gap-1.5 text-[11px]">
                  <Camera className="w-3.5 h-3.5 text-[#8B93FF]" strokeWidth={1.75} />
                  Foto personalizada carregada
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

          {/* Name & Callsign Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#8A8F98] block mb-1">
                Nome do Orquestrador
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                required
                className="w-full bg-[#181B20] border border-[#23262C] focus:border-[#8B93FF] rounded-xl px-3 py-2 text-xs text-[#E7E8EA] outline-none transition-colors"
                placeholder="ex.: Victor, Maestro, Alpha"
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
                required
                className="w-full bg-[#181B20] border border-[#23262C] focus:border-[#8B93FF] rounded-xl px-3 py-2 text-xs text-[#E7E8EA] outline-none font-mono uppercase transition-colors"
                placeholder="ex.: ARCHITECT-01"
              />
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#8B93FF] to-indigo-600 hover:from-[#7A82F8] hover:to-indigo-500 text-white font-semibold text-xs tracking-wide transition-all shadow-lg shadow-[#8B93FF]/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-amber-300" strokeWidth={1.75} />
              <span>{isSubmitting ? 'Iniciando...' : 'Começar Jornada no Canvas'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
