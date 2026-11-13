import React, { useState } from 'react';
import {
  PortalNode as PortalNodeType,
  PortalContent,
  ActionRefTag,
} from '@mindagentics/shared';
import {
  Globe,
  Smartphone,
  RotateCw,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  Crosshair,
  ExternalLink,
  AppWindow,
  AlertTriangle,
} from 'lucide-react';
import { isTauriEnvironment } from '@/backend';

interface PortalNodeProps {
  node: PortalNodeType;
  onUpdate: (updated: PortalNodeType) => void;
  onDelete: (id: string) => void;
}

export const PortalNode: React.FC<PortalNodeProps> = ({
  node,
  onUpdate,
  onDelete,
}) => {
  const nodeRef = React.useRef(node);
  nodeRef.current = node;

  const content = node.content;
  const [urlInput, setUrlInput] = useState(content.url || 'https://example.com');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isBlockedOrError, setIsBlockedOrError] = useState(false);

  const isTauri = isTauriEnvironment();
  const isAndroid = content.portalKind === 'android';
  const tags: ActionRefTag[] = content.actionTags || [];

  const handleOpenExternal = () => {
    const api = (window as any).api || (window as any).mindAgentics;
    if (api?.app?.openExternal) {
      api.app.openExternal(content.url);
    } else {
      window.open(content.url, '_blank', 'noreferrer');
    }
  };

  const handleOpenNativeWindow = () => {
    const api = (window as any).api || (window as any).mindAgentics;
    if (api?.portal?.openWindow) {
      api.portal.openWindow(content.url, content.url);
    } else if (api?.app?.openExternal) {
      api.app.openExternal(content.url);
    } else {
      window.open(content.url, '_blank', 'noreferrer');
    }
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = urlInput.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    setUrlInput(target);
    setIsBlockedOrError(false);
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        url: target,
      },
    });
  };

  const toggleDevice = () => {
    const nextKind = isAndroid ? 'browser' : 'android';
    const newWidth = nextKind === 'android' ? 380 : 720;
    const newHeight = nextKind === 'android' ? 680 : 480;

    onUpdate({
      ...nodeRef.current,
      width: newWidth,
      height: newHeight,
      content: {
        ...nodeRef.current.content,
        portalKind: nextKind,
      },
    });
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingTag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    const nextTagIndex = tags.length + 1;
    const newTag: ActionRefTag = {
      id: `tag-${Date.now()}`,
      label: `@e${nextTagIndex}`,
      x,
      y,
      selector: `element-${nextTagIndex}`,
    };

    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        actionTags: [...(nodeRef.current.content.actionTags || []), newTag],
      },
    });
    setIsAddingTag(false);
  };

  const removeTag = (tagId: string) => {
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        actionTags: (nodeRef.current.content.actionTags || []).filter((t: any) => t.id !== tagId),
      },
    });
  };

  return (
    <div className="group flex flex-col w-full h-full bg-[#14161A] border border-white/[0.07] rounded-xl overflow-hidden shadow-xl">
      {/* Header bar / Browser Chrome (Standard 36px / h-9 Height) */}
      <div className="node-drag-handle h-9 px-3 bg-[#181B20] border-b border-white/[0.07] flex items-center justify-between cursor-move select-none">
        <div className="flex items-center gap-1.5 flex-1 mr-2">
          {/* Navigation Controls */}
          <button className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/[0.06] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/[0.06] transition-colors">
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => {
              // Reload
              const current = content.url;
              onUpdate({ ...node, content: { ...content, url: '' } });
              setTimeout(() => {
                onUpdate({ ...node, content: { ...content, url: current } });
              }, 10);
            }}
            className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/[0.06] transition-colors mr-1"
          >
            <RotateCw className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* URL Address Bar */}
          <form onSubmit={handleNavigate} className="flex-1 max-w-[420px]">
            <div className="flex items-center px-2 py-0.5 bg-[#0E0F12] border border-white/[0.08] rounded-md text-xs text-zinc-300 focus-within:border-[#8B93FF]">
              <Globe className="w-3 h-3 text-zinc-500 mr-1.5 shrink-0" strokeWidth={1.75} />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter URL..."
                className="w-full bg-transparent outline-none text-xs text-zinc-200 font-mono"
              />
            </div>
          </form>
        </div>

        {/* Action Controls (opacity transition on group-hover) */}
        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
          {/* Action Ref Tag Creator */}
          <button
            onClick={() => setIsAddingTag(!isAddingTag)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-colors ${
              isAddingTag
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
            title="Click to pin interactive @ref Action Tag"
          >
            <Crosshair className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="text-[11px] font-mono">@ref</span>
          </button>

          {/* Android Simulator Toggle */}
          <button
            onClick={toggleDevice}
            className={`p-1 rounded-md transition-colors ${
              isAndroid
                ? 'text-emerald-400 bg-emerald-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
            title={isAndroid ? 'Switch to Standard Browser' : 'Switch to Android Frame (390x844)'}
          >
            <Smartphone className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* Open in dedicated native window */}
          <button
            onClick={handleOpenNativeWindow}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
            title="Abrir em Janela Dedicada"
          >
            <AppWindow className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* External browser open */}
          <button
            onClick={handleOpenExternal}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
            title="Abrir no Navegador Externo"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* Close */}
          <button
            onClick={() => onDelete(node.id)}
            className="p-1 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
            title="Close Portal"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div
        onClick={handleContainerClick}
        className={`flex-1 w-full h-[calc(100%-42px)] relative overflow-hidden bg-[#0A0B0E] flex items-center justify-center ${
          isAndroid ? 'p-2' : ''
        } ${isAddingTag ? 'cursor-crosshair' : ''}`}
      >
        {isBlockedOrError ? (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 bg-[#0E0F12] text-zinc-300 w-full h-full select-none">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-white">Embed Restrito (X-Frame-Options / CSP)</h4>
              <p className="text-xs text-zinc-400 max-w-[340px]">
                {isTauri
                  ? 'Este site restringe exibição em iframe no ambiente Tauri.'
                  : 'Este site restringe exibição incorporada.'}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleOpenNativeWindow}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#8B93FF] hover:bg-[#7a82f8] text-[#0E0F12] transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <AppWindow className="w-3.5 h-3.5" />
                <span>Janela Nativa</span>
              </button>
              <button
                onClick={handleOpenExternal}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white/[0.08] hover:bg-white/[0.15] text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Navegador</span>
              </button>
            </div>
            <button
              onClick={() => setIsBlockedOrError(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 underline pt-1 cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        ) : isAndroid ? (
          /* Android / Mobile Phone Frame Simulation (responsive to container) */
          <div className="w-full h-full max-w-[360px] rounded-[32px] border-[6px] border-[#20222A] shadow-2xl relative overflow-hidden bg-[#0A0A0D] flex flex-col ring-1 ring-white/10">
            {/* Notch / Speaker Bar */}
            <div className="w-full h-7 bg-[#1C1E24] flex items-center justify-between px-5 select-none shrink-0 border-b border-black/20">
              <span className="text-[10px] font-semibold text-zinc-300">9:41</span>
              <div className="w-16 h-3 bg-black rounded-full" />
              <div className="flex items-center gap-1 text-[10px] text-zinc-300 font-mono">
                <span>5G</span>
                <span>100%</span>
              </div>
            </div>

            {/* Inner webview */}
            <iframe
              src={content.url}
              title="Android Portal"
              className="w-full flex-1 border-none bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              onError={() => setIsBlockedOrError(true)}
            />

            {/* Mobile Bottom Home Bar Indicator */}
            <div className="w-full h-4 bg-[#1C1E24] flex items-center justify-center shrink-0 border-t border-black/10">
              <div className="w-24 h-1 bg-white/30 rounded-full" />
            </div>
          </div>
        ) : (
          /* Standard Browser Webview */
          <iframe
            src={content.url}
            title="Browser Portal"
            className="w-full h-full border-none bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            onError={() => setIsBlockedOrError(true)}
          />
        )}

        {/* Action Ref Tags Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="absolute pointer-events-auto flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/90 text-black font-mono font-bold text-[10px] shadow-lg border border-amber-300 -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `${tag.x}px`, top: `${tag.y}px` }}
            >
              <span>{tag.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-red-700 ml-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
