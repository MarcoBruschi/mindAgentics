import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
}

/**
 * ClaudeIcon: Anthropic's iconic starburst / spark geometry.
 */
export const ClaudeIcon: React.FC<IconProps> = ({ size = 16, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" />
    <path
      d="M12 6.5C12.8 9.2 14.8 11.2 17.5 12C14.8 12.8 12.8 14.8 12 17.5C11.2 14.8 9.2 12.8 6.5 12C9.2 11.2 11.2 9.2 12 6.5Z"
      opacity="0.35"
    />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

/**
 * CodexIcon: OpenAI / Codex hexagonal swirl neural aperture geometry.
 */
export const CodexIcon: React.FC<IconProps> = ({ size = 16, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M22.28 10.42a6.37 6.37 0 0 0-.54-5.2 6.44 6.44 0 0 0-4.32-3.14 6.36 6.36 0 0 0-5.46 1.07 6.4 6.4 0 0 0-4.14-.38 6.45 6.45 0 0 0-3.62 2.66 6.38 6.38 0 0 0-.9 5.37 6.44 6.44 0 0 0 .54 5.2 6.44 6.44 0 0 0 4.32 3.14 6.36 6.36 0 0 0 5.46-1.07 6.4 6.4 0 0 0 4.14.38 6.45 6.45 0 0 0 3.62-2.66 6.38 6.38 0 0 0 .9-5.37zm-8.88 9.38a4.92 4.92 0 0 1-2.92-.12c.04-.08.1-.19.14-.28l2.48-4.29a.76.76 0 0 1 .66-.38h.02a.76.76 0 0 1 .66.38l1.45 2.51a4.95 4.95 0 0 1-2.49 2.18zm-6.6-2.52a4.9 4.9 0 0 1-.95-2.77c.08.03.2.06.31.09l4.94.87a.76.76 0 0 1 .62.61.76.76 0 0 1-.28.72l-2.45 1.56a4.95 4.95 0 0 1-2.19-1.08zm-1.8-6.84a4.9 4.9 0 0 1 1.97-2.22c.04.07.1.18.15.28l2.46 4.3a.76.76 0 0 1 0 .76.76.76 0 0 1-.66.38l-2.89-.02a4.95 4.95 0 0 1-1.03-3.48zm12.2-1.42l-2.48 1.43a.76.76 0 0 1-.76 0 .76.76 0 0 1-.38-.66v-2.9a4.95 4.95 0 0 1 3.52 1.05 4.9 4.9 0 0 1 1.02 2.76c-.08-.03-.2-.07-.31-.1l-.61-.15zm1.8 6.84a4.9 4.9 0 0 1-1.97 2.22c-.04-.07-.1-.18-.15-.28l-2.46-4.3a.76.76 0 0 1 0-.76.76.76 0 0 1 .66-.38l2.89.02a4.95 4.95 0 0 1 1.03 3.48zm-4.78-2.85l-1.45-2.51a.76.76 0 0 1-.02-.76.76.76 0 0 1 .66-.38h2.9a4.95 4.95 0 0 1 1.04 3.48 4.9 4.9 0 0 1-1.98 2.23l-1.15-2.06z" />
  </svg>
);

/**
 * AntigravityIcon: Quantum levitating nucleus with orbital helix rings.
 */
export const AntigravityIcon: React.FC<IconProps> = ({ size = 16, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9" ry="3.75" transform="rotate(-30 12 12)" />
    <ellipse cx="12" cy="12" rx="9" ry="3.75" transform="rotate(30 12 12)" opacity="0.8" />
    <circle cx="4.8" cy="8.2" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="19.2" cy="15.8" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * OpenCodeIcon: Modern geometric developer brackets.
 */
export const OpenCodeIcon: React.FC<IconProps> = ({ size = 16, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
    <line x1="14" y1="4" x2="10" y2="20" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * ShellIcon: Clean terminal shell prompt.
 */
export const ShellIcon: React.FC<IconProps> = ({ size = 16, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="2.5" y="3.5" width="19" height="17" rx="3.5" />
    <polyline points="7 9 10 12 7 15" strokeWidth="2" />
    <line x1="12" y1="15" x2="16.5" y2="15" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
