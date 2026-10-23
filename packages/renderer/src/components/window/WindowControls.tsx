import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

export const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = window.api?.windowControls || window.mindAgentics?.windowControls || window.maestri?.windowControls;
    if (!controls) return;

    if (controls.state) {
      controls.state().then((res: any) => {
        if (res && typeof res.isMaximized === 'boolean') {
          setIsMaximized(res.isMaximized);
        }
      }).catch(() => {});
    }

    if (controls.onChanged) {
      const unsub = controls.onChanged((payload: any) => {
        if (payload && typeof payload.isMaximized === 'boolean') {
          setIsMaximized(payload.isMaximized);
        }
      });
      return () => {
        if (typeof unsub === 'function') unsub();
      };
    }
  }, []);

  const handleMinimize = () => {
    const controls = window.api?.windowControls || window.mindAgentics?.windowControls || window.maestri?.windowControls;
    controls?.minimize?.();
  };

  const handleToggleMaximize = () => {
    const controls = window.api?.windowControls || window.mindAgentics?.windowControls || window.maestri?.windowControls;
    controls?.toggleMaximize?.();
  };

  const handleClose = () => {
    const controls = window.api?.windowControls || window.mindAgentics?.windowControls || window.maestri?.windowControls;
    controls?.close?.();
  };

  return (
    <div
      className="flex items-center select-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
        title="Minimizar"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={handleToggleMaximize}
        className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
        title={isMaximized ? 'Restaurar' : 'Maximizar'}
      >
        {isMaximized ? (
          <Copy className="w-3 h-3 rotate-180" />
        ) : (
          <Square className="w-3 h-3" />
        )}
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-[#e81123] rounded transition-colors cursor-pointer"
        title="Fechar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
