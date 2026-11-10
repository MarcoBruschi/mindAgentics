import React from 'react';
import {
  Wand2,
  Zap,
  Terminal,
  Network,
  Command,
  Compass,
  Shield,
  Brain,
  Cpu,
} from 'lucide-react';

interface AvatarIconProps {
  avatarId?: string;
  className?: string;
  strokeWidth?: number;
}

export const AvatarIcon: React.FC<AvatarIconProps> = ({
  avatarId,
  className = 'w-4 h-4 text-[#8B93FF]',
  strokeWidth = 1.75,
}) => {
  switch (avatarId) {
    case 'avatar-conductor':
      return <Wand2 className={className} strokeWidth={strokeWidth} />;
    case 'avatar-cyberpunk':
      return <Zap className={className} strokeWidth={strokeWidth} />;
    case 'avatar-hacker':
      return <Terminal className={className} strokeWidth={strokeWidth} />;
    case 'avatar-quantum':
      return <Network className={className} strokeWidth={strokeWidth} />;
    case 'avatar-terminal':
      return <Command className={className} strokeWidth={strokeWidth} />;
    case 'avatar-voyager':
      return <Compass className={className} strokeWidth={strokeWidth} />;
    case 'avatar-matrix':
      return <Shield className={className} strokeWidth={strokeWidth} />;
    case 'avatar-neural':
      return <Brain className={className} strokeWidth={strokeWidth} />;
    default:
      return <Cpu className={className} strokeWidth={strokeWidth} />;
  }
};