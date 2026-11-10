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
} from 'lucide-react';

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

  const isAndroid = content.portalKind === 'android';
  const tags: ActionRefTag[] = content.actionTags || [];

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = urlInput.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    setUrlInput(target);
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
    <div className="flex flex-col w-full h-full bg-[#121316] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      {/* Header bar / Browser Chrome */}
      <div className="node-drag-handle flex items-center justify-between px-3 py-2 bg-[#1b1c22] border-b border-white/5 cursor-move">
        <div className="flex items-center gap-1.5 flex-1 mr-2">
          {/* Navigation Controls */}
          <button className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5">
            <ArrowRight className="w-3.5 h-3.5" />
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
            className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 mr-1"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* URL Address Bar */}
          <form onSubmit={handleNavigate} className="flex-1 max-w-[420px]">
            <div className="flex items-center px-2 py-1 bg-[#121316] border border-white/10 rounded-md text-xs text-zinc-300 focus-within:border-blue-500/60">
              <Globe className="w-3 h-3 text-zinc-500 mr-1.5 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter URL..."
                className="w-full bg-transparent outline-none text-xs text-zinc-200"
              />
            </div>
          </form>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          {/* Action Ref Tag Creator */}
          <button
            onClick={() => setIsAddingTag(!isAddingTag)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isAddingTag
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Click to pin interactive @e Action Tag"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono">@ref</span>
          </button>

          {/* Android Simulator Toggle */}
          <button
            onClick={toggleDevice}
            className={`p-1.5 rounded transition-colors ${
              isAndroid
                ? 'text-emerald-400 bg-emerald-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title={isAndroid ? 'Switch to Standard Browser' : 'Switch to Android Frame (390x844)'}
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>

          {/* External browser open */}
          <a
            href={content.url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded"
            title="Open in default browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {/* Close */}
          <button
            onClick={() => onDelete(node.id)}
            className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded"
            title="Close Portal"
          >
            <X className="w-3.5 h-3.5" />
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
        {isAndroid ? (
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
              sandbox="allow-same-origin allow-scripts allow-forms"
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
            sandbox="allow-same-origin allow-scripts allow-forms"
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
