import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isSidebarOpenAtom } from '@/atoms/ui';
import { WindowControls } from './WindowControls';
import { Menu } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const controls =
      window.api?.windowControls ||
      window.mindAgentics?.windowControls ||
      (window.mindAgentics?.windowControls || window.api?.windowControls?.windowControls);
    if (!controls) return;

    if (controls.state) {
      controls.state().then((res: any) => {
        if (res && typeof res.isFullScreen === 'boolean') {
          setIsFullScreen(res.isFullScreen);
        }
      }).catch(() => {});
    }

    if (controls.onChanged) {
      const unsub = controls.onChanged((payload: any) => {
        if (payload && typeof payload.isFullScreen === 'boolean') {
          setIsFullScreen(payload.isFullScreen);
        }
      });
      return () => {
        if (typeof unsub === 'function') unsub();
      };
    }
  }, []);

  return (
    <header
      data-titlebar-drag="true"
      className={`fixed top-0 right-0 h-14 flex items-center justify-between px-3 z-30 select-none pointer-events-auto transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'left-[248px]' : 'left-0'
      }`}
      style={{
        WebkitAppRegion: isFullScreen ? 'no-drag' : 'drag',
      } as React.CSSProperties}
    >
      {/* Left: Hamburger menu toggle button */}
      <div
        className="flex items-center pointer-events-auto ml-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setIsSidebarOpen((prev: boolean) => !prev)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-300 hover:text-white shadow-lg transition-all duration-200 cursor-pointer hover:bg-white/10"
          style={{
            backgroundColor: 'var(--sidebar-bg, rgba(30, 32, 38, 0.45))',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          title={isSidebarOpen ? 'Esconder barra lateral' : 'Mostrar barra lateral'}
        >
          <Menu className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Right: Window Controls */}
      <div
        className="flex items-center pointer-events-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <WindowControls />
      </div>
    </header>
  );
};
